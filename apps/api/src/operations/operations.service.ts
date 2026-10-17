import { Injectable, Logger } from '@nestjs/common';
import { InjectConnection, InjectModel } from '@nestjs/mongoose';
import { addDays, affectsStoredBalance, daysBetween } from '@necta/cash-engine';
import type { ClientPlatform, EntityType, OperationResult, OperationStatus, SyncOperation } from '@necta/contracts';
import { createHash, randomUUID } from 'node:crypto';
import type { ClientSession, Connection, Model } from 'mongoose';
import { ClockService } from '../common/clock.service';
import { AppError, BusinessError, VersionConflictError } from '../common/errors';
import { MAPPERS, type Doc } from '../db/mappers';
import { MODELS } from '../db/schemas';
import { StoreEvents } from '../events/store-events';

export interface OperationContext {
  storeId: string;
  userId: string;
  platform: ClientPlatform | null;
  timeZone: string;
}

interface HandlerResult {
  entityType: EntityType;
  entity: unknown;
}

type Handler<T extends SyncOperation['type']> = (
  ctx: OperationContext,
  op: Extract<SyncOperation, { type: T }>,
  seq: number,
  session: ClientSession,
) => Promise<HandlerResult>;

/** JSON con claves ordenadas: el hash no depende del orden de los campos. */
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

export function payloadHash(op: SyncOperation): string {
  const { type, payload } = op;
  const entityId = 'entityId' in op ? op.entityId : null;
  const baseVersion = 'baseVersion' in op ? op.baseVersion : null;
  return createHash('sha256').update(stableStringify({ type, entityId, baseVersion, payload })).digest('hex');
}

/** Índice único de idempotencia violado por un reintento concurrente (no otro índice). */
function isOperationDuplicate(error: unknown): boolean {
  const e = error as { code?: number; keyPattern?: Record<string, unknown> } | null;
  return e?.code === 11000 && Boolean(e.keyPattern && 'clientMutationId' in e.keyPattern);
}

/**
 * Aplica operaciones financieras de forma idempotente y atómica:
 * registro (storeId, clientMutationId) + efectos + seq de la tienda en una sola transacción.
 */
@Injectable()
export class OperationsService {
  private readonly logger = new Logger('OperationsService');

  constructor(
    @InjectConnection() private readonly connection: Connection,
    @InjectModel(MODELS.Operation) private readonly operations: Model<Doc>,
    @InjectModel(MODELS.Counter) private readonly counters: Model<Doc>,
    @InjectModel(MODELS.Bank) private readonly banks: Model<Doc>,
    @InjectModel(MODELS.Counterparty) private readonly counterparties: Model<Doc>,
    @InjectModel(MODELS.Receivable) private readonly receivables: Model<Doc>,
    @InjectModel(MODELS.Payable) private readonly payables: Model<Doc>,
    @InjectModel(MODELS.Movement) private readonly movements: Model<Doc>,
    @InjectModel(MODELS.Commitment) private readonly commitments: Model<Doc>,
    @InjectModel(MODELS.Sale) private readonly sales: Model<Doc>,
    @InjectModel(MODELS.Baseline) private readonly baselines: Model<Doc>,
    @InjectModel(MODELS.BankAdjustment) private readonly adjustments: Model<Doc>,
    private readonly clock: ClockService,
    private readonly events: StoreEvents,
  ) {}

  async findExisting(storeId: string, clientMutationId: string): Promise<Doc | null> {
    return this.operations.findOne({ storeId, clientMutationId }).lean<Doc>();
  }

  /** Aplica operaciones en orden respetando `dependsOn`. */
  async applyMany(ctx: OperationContext, ops: SyncOperation[]): Promise<OperationResult[]> {
    const outcome = new Map<string, OperationStatus>();
    const results: OperationResult[] = [];
    for (const op of ops) {
      const existing = await this.findExisting(ctx.storeId, op.clientMutationId);
      if (!existing) {
        const failed = await this.failedDependency(ctx.storeId, op.dependsOn, outcome);
        if (failed) {
          const r: OperationResult = {
            clientMutationId: op.clientMutationId,
            status: 'blocked',
            error: { code: 'DEPENDENCY_FAILED', message: `Depende de una operación no aplicada (${failed})` },
          };
          outcome.set(op.clientMutationId, r.status);
          results.push(r);
          continue;
        }
      }
      const r = await this.apply(ctx, op);
      outcome.set(op.clientMutationId, r.status);
      results.push(r);
    }
    return results;
  }

  private async failedDependency(storeId: string, deps: string[], outcome: Map<string, OperationStatus>): Promise<string | null> {
    for (const dep of deps) {
      const status = outcome.get(dep);
      if (status) {
        if (status !== 'applied' && status !== 'duplicate') return dep;
        continue;
      }
      if (!(await this.findExisting(storeId, dep))) return dep;
    }
    return null;
  }

  async apply(ctx: OperationContext, op: SyncOperation): Promise<OperationResult> {
    const hash = payloadHash(op);
    let result: OperationResult;
    try {
      result = await this.transaction(async (session) => {
        const existing = await this.operations.findOne({ storeId: ctx.storeId, clientMutationId: op.clientMutationId }).session(session).lean<Doc>();
        if (existing) return this.replay(existing, hash);
        const seq = await this.nextSeq(ctx.storeId, session);
        const handled = await this.dispatch(ctx, op, seq, session);
        const applied: OperationResult = { clientMutationId: op.clientMutationId, status: 'applied', seq, ...handled };
        await this.operations.create(
          [
            {
              storeId: ctx.storeId,
              clientMutationId: op.clientMutationId,
              type: op.type,
              payloadHash: hash,
              seq,
              result: applied,
              userId: ctx.userId,
              platform: ctx.platform,
              createdAt: this.clock.now(),
            },
          ],
          { session },
        );
        return applied;
      });
    } catch (error) {
      if (isOperationDuplicate(error)) {
        // Carrera entre reintentos concurrentes: la otra transacción ganó; devolver su resultado.
        const existing = await this.findExisting(ctx.storeId, op.clientMutationId);
        if (existing) return this.replay(existing, hash);
      }
      if (error instanceof VersionConflictError) {
        return {
          clientMutationId: op.clientMutationId,
          status: 'conflict',
          error: { code: 'VERSION_CONFLICT', message: error.message },
          remote: error.remote,
        };
      }
      if (error instanceof AppError) {
        return { clientMutationId: op.clientMutationId, status: 'rejected', error: { code: error.code, message: error.message } };
      }
      throw error;
    }
    if (result.status === 'applied' && result.seq !== undefined) {
      this.events.emitChanged({ storeId: ctx.storeId, seq: result.seq, type: op.type });
    }
    return result;
  }

  private replay(existing: Doc, hash: string): OperationResult {
    if (existing.payloadHash !== hash) {
      return {
        clientMutationId: existing.clientMutationId,
        status: 'rejected',
        error: { code: 'IDEMPOTENCY_PAYLOAD_MISMATCH', message: 'El mismo clientMutationId llegó con otros datos' },
      };
    }
    return { ...(existing.result as OperationResult), status: 'duplicate' };
  }

  private async transaction<T>(fn: (session: ClientSession) => Promise<T>): Promise<T> {
    const session = await this.connection.startSession();
    try {
      return await session.withTransaction(() => fn(session), {
        readConcern: { level: 'snapshot' },
        writeConcern: { w: 'majority' },
      });
    } finally {
      await session.endSession();
    }
  }

  /** $inc del contador de la tienda: serializa los commits por tienda y ordena el log de cambios. */
  private async nextSeq(storeId: string, session: ClientSession): Promise<number> {
    const doc = await this.counters
      .findOneAndUpdate({ _id: storeId }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session })
      .lean<Doc>();
    return doc!.seq as number;
  }

  private dispatch(ctx: OperationContext, op: SyncOperation, seq: number, s: ClientSession): Promise<HandlerResult> {
    const handlers: { [K in SyncOperation['type']]: Handler<K> } = {
      'movement.create': this.createMovement,
      'movement.update': this.updateMovement,
      'movement.delete': this.deleteMovement,
      'sale.create': this.createSale,
      'receivable.payment': this.receivablePayment,
      'payable.payment': this.payablePayment,
      'receivable.reschedule': this.rescheduleReceivable,
      'receivable.payment.void': this.voidReceivablePayment,
      'payable.payment.void': this.voidPayablePayment,
      'commitment.create': this.createCommitment,
      'commitment.update': this.updateCommitment,
      'commitment.delete': this.deleteCommitment,
      'baseline.update': this.updateBaseline,
      'bank.adjustment': this.adjustBank,
    };
    const handler = handlers[op.type] as Handler<typeof op.type>;
    return handler.call(this, ctx, op as never, seq, s);
  }

  // ---------- helpers ----------

  private stamp(seq: number) {
    return { seq, updatedAt: this.clock.now() };
  }

  private assertNotFuture(ctx: OperationContext, date: string): void {
    if (date > this.clock.businessDate(ctx.timeZone)) {
      throw new BusinessError('FUTURE_DATE_NOT_ALLOWED', 'Un movimiento realizado no puede tener fecha futura');
    }
  }

  private async bank(ctx: OperationContext, bankId: string, s: ClientSession): Promise<Doc> {
    const bank = await this.banks.findOne({ _id: bankId, storeId: ctx.storeId, deletedAt: null }).session(s).lean<Doc>();
    if (!bank) throw new BusinessError('BANK_NOT_FOUND', 'Bolsillo inexistente');
    return bank;
  }

  private affects(ctx: OperationContext, bank: Doc, date: string): boolean {
    const asOf = bank.balanceAsOf ? new Date(bank.balanceAsOf).toISOString() : null;
    return affectsStoredBalance(date, asOf, ctx.timeZone);
  }

  private async moveBank(ctx: OperationContext, bankId: string, delta: number, affects: boolean, seq: number, s: ClientSession) {
    await this.banks.updateOne(
      { _id: bankId, storeId: ctx.storeId },
      { $inc: { storedLedgerBalance: affects ? delta : 0, reconstructedBalance: delta, version: 1 }, $set: this.stamp(seq) },
      { session: s },
    );
  }

  private async assertNewId(model: Model<Doc>, id: string, s: ClientSession): Promise<void> {
    if (await model.exists({ _id: id }).session(s)) {
      throw new BusinessError('VALIDATION_ERROR', `El identificador ${id} ya existe`);
    }
  }

  /** Lee la entidad y lanza conflicto/404 si la versión no coincide. */
  private async loadVersioned(model: Model<Doc>, type: EntityType, ctx: OperationContext, id: string, baseVersion: number, s: ClientSession): Promise<Doc> {
    const doc = await model.findOne({ _id: id, storeId: ctx.storeId }).session(s).lean<Doc>();
    if (!doc) throw new BusinessError('NOT_FOUND', 'No existe');
    if (doc.version !== baseVersion) throw new VersionConflictError({ entityType: type, entity: MAPPERS[type](doc) });
    if (doc.deletedAt) throw new BusinessError('ENTITY_DELETED', 'Ya fue borrado');
    return doc;
  }

  private async conditionalUpdate(model: Model<Doc>, type: EntityType, ctx: OperationContext, id: string, baseVersion: number, update: Doc, s: ClientSession): Promise<Doc> {
    const updated = await model
      .findOneAndUpdate({ _id: id, storeId: ctx.storeId, version: baseVersion, deletedAt: null }, { ...update, $inc: { version: 1 } }, { returnDocument: 'after', session: s })
      .lean<Doc>();
    if (!updated) {
      const current = await model.findOne({ _id: id, storeId: ctx.storeId }).session(s).lean<Doc>();
      throw new VersionConflictError(current ? { entityType: type, entity: MAPPERS[type](current) } : null);
    }
    return updated;
  }

  // ---------- handlers ----------

  private createMovement: Handler<'movement.create'> = async (ctx, op, seq, s) => {
    const m = op.payload.movement;
    this.assertNotFuture(ctx, m.date);
    const bank = await this.bank(ctx, m.bankId, s);
    await this.assertNewId(this.movements, m.id, s);
    const affectsBalance = this.affects(ctx, bank, m.date);
    const [doc] = await this.movements.create(
      [{ _id: m.id, storeId: ctx.storeId, kind: m.kind, amount: m.amount, bankId: m.bankId, date: m.date, description: m.description, affectsBalance, clientMutationId: op.clientMutationId, createdAt: this.clock.now(), version: 1, ...this.stamp(seq) }],
      { session: s },
    );
    await this.moveBank(ctx, m.bankId, m.kind === 'income' ? m.amount : -m.amount, affectsBalance, seq, s);
    return { entityType: 'movement', entity: MAPPERS.movement(doc!.toObject()) };
  };

  private updateMovement: Handler<'movement.update'> = async (ctx, op, seq, s) => {
    const current = await this.loadVersioned(this.movements, 'movement', ctx, op.entityId, op.baseVersion, s);
    const { changes } = op.payload;
    if (changes.date) this.assertNotFuture(ctx, changes.date);
    const updated = await this.conditionalUpdate(this.movements, 'movement', ctx, op.entityId, op.baseVersion, { $set: { ...changes, ...this.stamp(seq) } }, s);
    if (changes.amount !== undefined && changes.amount !== current.amount) {
      const sign = current.kind === 'income' ? 1 : -1;
      await this.moveBank(ctx, current.bankId, sign * (changes.amount - current.amount), current.affectsBalance, seq, s);
    }
    return { entityType: 'movement', entity: MAPPERS.movement(updated) };
  };

  private deleteMovement: Handler<'movement.delete'> = async (ctx, op, seq, s) => {
    const current = await this.loadVersioned(this.movements, 'movement', ctx, op.entityId, op.baseVersion, s);
    const updated = await this.conditionalUpdate(this.movements, 'movement', ctx, op.entityId, op.baseVersion, { $set: { deletedAt: this.clock.now(), ...this.stamp(seq) } }, s);
    const sign = current.kind === 'income' ? -1 : 1;
    await this.moveBank(ctx, current.bankId, sign * current.amount, current.affectsBalance, seq, s);
    return { entityType: 'movement', entity: MAPPERS.movement(updated) };
  };

  private createSale: Handler<'sale.create'> = async (ctx, op, seq, s) => {
    const sale = op.payload.sale;
    this.assertNotFuture(ctx, sale.saleDate);
    const total = Math.round(sale.items.reduce((acc, i) => acc + i.quantitiesSold * i.finalPrice, 0));
    const paid = sale.payments.reduce((acc, p) => acc + p.amount, 0);
    if (paid > total) throw new BusinessError('PAYMENT_EXCEEDS_PENDING', 'Los pagos superan el total de la venta');
    const customer = await this.counterparties.findOne({ _id: sale.customerId, storeId: ctx.storeId, deletedAt: null }).session(s).lean<Doc>();
    if (!customer) throw new BusinessError('NOT_FOUND', 'Clienta inexistente');
    await this.assertNewId(this.sales, sale.id, s);
    if (total - paid > 0) await this.assertNewId(this.receivables, sale.id, s);
    for (const p of sale.payments) {
      this.assertNotFuture(ctx, p.paymentDate);
      const bank = await this.bank(ctx, p.bankId, s);
      await this.moveBank(ctx, p.bankId, p.amount, this.affects(ctx, bank, p.paymentDate), seq, s);
    }
    const [doc] = await this.sales.create(
      [{ _id: sale.id, storeId: ctx.storeId, customerId: sale.customerId, items: sale.items, payments: sale.payments, totalAmount: total, paidAmount: paid, saleDate: sale.saleDate, expiresAt: sale.expiresAt ?? null, clientMutationId: op.clientMutationId, version: 1, ...this.stamp(seq) }],
      { session: s },
    );
    if (total - paid > 0) {
      await this.receivables.create(
        [{ _id: sale.id, storeId: ctx.storeId, counterpartyId: customer._id, counterpartyName: customer.name, totalAmount: total - paid, pendingAmount: total - paid, creditDueBy: sale.expiresAt ?? addDays(sale.saleDate, 30), sourceSaleId: sale.id, payments: [], version: 1, ...this.stamp(seq) }],
        { session: s },
      );
    }
    return { entityType: 'sale', entity: MAPPERS.sale(doc!.toObject()) };
  };

  private async debtPayment(
    model: Model<Doc>,
    type: 'receivable' | 'payable',
    ctx: OperationContext,
    op: Extract<SyncOperation, { type: 'receivable.payment' | 'payable.payment' }>,
    seq: number,
    s: ClientSession,
  ): Promise<Doc> {
    const p = op.payload;
    this.assertNotFuture(ctx, p.paymentDate);
    const bank = await this.bank(ctx, p.bankId, s);
    const updated = await model
      .findOneAndUpdate(
        { _id: op.entityId, storeId: ctx.storeId, deletedAt: null, pendingAmount: { $gte: p.amount } },
        {
          $inc: { pendingAmount: -p.amount, version: 1 },
          $push: { payments: { clientMutationId: op.clientMutationId, bankId: p.bankId, amount: p.amount, method: p.method, paymentDate: p.paymentDate, recordedAt: this.clock.now() } },
          $set: this.stamp(seq),
        },
        { returnDocument: 'after', session: s },
      )
      .lean<Doc>();
    if (!updated) {
      const current = await model.findOne({ _id: op.entityId, storeId: ctx.storeId }).session(s).lean<Doc>();
      if (!current || current.deletedAt) throw new BusinessError('NOT_FOUND', 'Cuenta inexistente');
      if (current.pendingAmount <= 0) throw new BusinessError('DEBT_ALREADY_SETTLED', 'Esta cuenta ya está pagada');
      throw new BusinessError('PAYMENT_EXCEEDS_PENDING', `El pago supera el pendiente (${current.pendingAmount})`, { pendingAmount: current.pendingAmount });
    }
    const sign = type === 'receivable' ? 1 : -1;
    await this.moveBank(ctx, p.bankId, sign * p.amount, this.affects(ctx, bank, p.paymentDate), seq, s);
    return updated;
  }

  private receivablePayment: Handler<'receivable.payment'> = async (ctx, op, seq, s) => {
    const updated = await this.debtPayment(this.receivables, 'receivable', ctx, op, seq, s);
    // La puntualidad se mide contra el vencimiento original, aunque se haya reprogramado.
    const dueForHistory = updated.originalDueBy ?? updated.creditDueBy;
    if (updated.counterpartyId && dueForHistory) {
      // Puntualidad incremental: cada pago cuenta; a tiempo si llega en o antes del vencimiento.
      const cp = await this.counterparties.findOne({ _id: updated.counterpartyId, storeId: ctx.storeId }).session(s).lean<Doc>();
      if (cp) {
        const h = cp.history ?? { payments: 0, onTime: 0, avgDaysLate: null };
        const daysLate = daysBetween(dueForHistory, op.payload.paymentDate);
        const late = daysLate > 0;
        const lateBefore = h.payments - h.onTime;
        const avgDaysLate = late ? ((h.avgDaysLate ?? 0) * lateBefore + daysLate) / (lateBefore + 1) : h.avgDaysLate;
        await this.counterparties.updateOne(
          { _id: cp._id },
          { $set: { history: { payments: h.payments + 1, onTime: h.onTime + (late ? 0 : 1), avgDaysLate }, ...this.stamp(seq) }, $inc: { version: 1 } },
          { session: s },
        );
      }
    }
    return { entityType: 'receivable', entity: MAPPERS.receivable(updated) };
  };

  /**
   * Anula un pago: queda marcado (rastro), la deuda recupera el monto y el bolsillo lo revierte,
   * todo en la misma transacción. Monto, bolsillo y fecha deben coincidir con lo guardado.
   */
  private async voidPayment(
    model: Model<Doc>,
    kind: 'receivable' | 'payable',
    ctx: OperationContext,
    op: Extract<SyncOperation, { type: 'receivable.payment.void' | 'payable.payment.void' }>,
    seq: number,
    s: ClientSession,
  ): Promise<Doc> {
    const p = op.payload;
    const doc = await model.findOne({ _id: op.entityId, storeId: ctx.storeId }).session(s).lean<Doc>();
    if (!doc || doc.deletedAt) throw new BusinessError('NOT_FOUND', 'Cuenta inexistente');
    const payment = (doc.payments as Doc[]).find((x) => x.clientMutationId === p.paymentClientMutationId);
    if (!payment) throw new BusinessError('NOT_FOUND', 'Pago inexistente');
    if (payment.voidedAt) throw new BusinessError('PAYMENT_ALREADY_VOIDED', 'Ese pago ya fue anulado');
    if (payment.amount !== p.amount || payment.bankId !== p.bankId || payment.paymentDate !== p.paymentDate) {
      throw new BusinessError('VALIDATION_ERROR', 'Los datos no coinciden con el pago registrado');
    }
    const updated = await model
      .findOneAndUpdate(
        { _id: op.entityId, storeId: ctx.storeId },
        { $set: { 'payments.$[p].voidedAt': this.clock.now(), ...this.stamp(seq) }, $inc: { pendingAmount: p.amount, version: 1 } },
        { returnDocument: 'after', session: s, arrayFilters: [{ 'p.clientMutationId': p.paymentClientMutationId, 'p.voidedAt': null }] },
      )
      .lean<Doc>();
    const bank = await this.bank(ctx, p.bankId, s);
    await this.moveBank(ctx, p.bankId, (kind === 'receivable' ? -1 : 1) * p.amount, this.affects(ctx, bank, p.paymentDate), seq, s);
    return updated!;
  }

  private voidReceivablePayment: Handler<'receivable.payment.void'> = async (ctx, op, seq, s) => {
    const updated = await this.voidPayment(this.receivables, 'receivable', ctx, op, seq, s);
    // La puntualidad deja de contar ese pago.
    const due = updated.originalDueBy ?? updated.creditDueBy;
    if (updated.counterpartyId && due) {
      const cp = await this.counterparties.findOne({ _id: updated.counterpartyId, storeId: ctx.storeId }).session(s).lean<Doc>();
      if (cp && cp.history?.payments > 0) {
        const h = cp.history;
        const daysLate = daysBetween(due, op.payload.paymentDate);
        const late = daysLate > 0;
        const lateBefore = h.payments - h.onTime;
        const avgDaysLate = late ? (lateBefore > 1 ? ((h.avgDaysLate ?? 0) * lateBefore - daysLate) / (lateBefore - 1) : null) : h.avgDaysLate;
        await this.counterparties.updateOne(
          { _id: cp._id },
          { $set: { history: { payments: h.payments - 1, onTime: Math.max(0, h.onTime - (late ? 0 : 1)), avgDaysLate }, ...this.stamp(seq) }, $inc: { version: 1 } },
          { session: s },
        );
      }
    }
    return { entityType: 'receivable', entity: MAPPERS.receivable(updated) };
  };

  private voidPayablePayment: Handler<'payable.payment.void'> = async (ctx, op, seq, s) => {
    const updated = await this.voidPayment(this.payables, 'payable', ctx, op, seq, s);
    return { entityType: 'payable', entity: MAPPERS.payable(updated) };
  };

  private rescheduleReceivable: Handler<'receivable.reschedule'> = async (ctx, op, seq, s) => {
    const current = await this.loadVersioned(this.receivables, 'receivable', ctx, op.entityId, op.baseVersion, s);
    if (current.pendingAmount <= 0) throw new BusinessError('DEBT_ALREADY_SETTLED', 'Esta cuenta ya está pagada');
    if (op.payload.newDueDate < this.clock.businessDate(ctx.timeZone)) {
      throw new BusinessError('VALIDATION_ERROR', 'La nueva fecha no puede ser anterior a hoy');
    }
    const updated = await this.conditionalUpdate(
      this.receivables,
      'receivable',
      ctx,
      op.entityId,
      op.baseVersion,
      { $set: { creditDueBy: op.payload.newDueDate, originalDueBy: current.originalDueBy ?? current.creditDueBy, ...this.stamp(seq) } },
      s,
    );
    return { entityType: 'receivable', entity: MAPPERS.receivable(updated) };
  };

  private payablePayment: Handler<'payable.payment'> = async (ctx, op, seq, s) => {
    const updated = await this.debtPayment(this.payables, 'payable', ctx, op, seq, s);
    return { entityType: 'payable', entity: MAPPERS.payable(updated) };
  };

  private createCommitment: Handler<'commitment.create'> = async (ctx, op, seq, s) => {
    const c = op.payload.commitment;
    await this.assertNewId(this.commitments, c.id, s);
    const [doc] = await this.commitments.create(
      [{ _id: c.id, storeId: ctx.storeId, direction: c.direction, concept: c.concept, amount: c.amount, schedule: c.schedule, negotiable: c.negotiable, version: 1, ...this.stamp(seq) }],
      { session: s },
    );
    return { entityType: 'commitment', entity: MAPPERS.commitment(doc!.toObject()) };
  };

  private updateCommitment: Handler<'commitment.update'> = async (ctx, op, seq, s) => {
    await this.loadVersioned(this.commitments, 'commitment', ctx, op.entityId, op.baseVersion, s);
    const updated = await this.conditionalUpdate(this.commitments, 'commitment', ctx, op.entityId, op.baseVersion, { $set: { ...op.payload.changes, ...this.stamp(seq) } }, s);
    return { entityType: 'commitment', entity: MAPPERS.commitment(updated) };
  };

  private deleteCommitment: Handler<'commitment.delete'> = async (ctx, op, seq, s) => {
    await this.loadVersioned(this.commitments, 'commitment', ctx, op.entityId, op.baseVersion, s);
    const updated = await this.conditionalUpdate(this.commitments, 'commitment', ctx, op.entityId, op.baseVersion, { $set: { deletedAt: this.clock.now(), ...this.stamp(seq) } }, s);
    return { entityType: 'commitment', entity: MAPPERS.commitment(updated) };
  };

  private updateBaseline: Handler<'baseline.update'> = async (ctx, op, seq, s) => {
    const id = `baseline_${ctx.storeId}`;
    const current = await this.baselines.findOne({ _id: id, storeId: ctx.storeId }).session(s).lean<Doc>();
    if (!current) {
      if (op.baseVersion !== 0) throw new VersionConflictError(null);
      const [doc] = await this.baselines.create([{ _id: id, storeId: ctx.storeId, ...op.payload, version: 1, ...this.stamp(seq) }], { session: s });
      return { entityType: 'baseline', entity: MAPPERS.baseline(doc!.toObject()) };
    }
    if (current.version !== op.baseVersion) throw new VersionConflictError({ entityType: 'baseline', entity: MAPPERS.baseline(current) });
    const updated = await this.conditionalUpdate(this.baselines, 'baseline', ctx, id, op.baseVersion, { $set: { ...op.payload, ...this.stamp(seq) } }, s);
    return { entityType: 'baseline', entity: MAPPERS.baseline(updated) };
  };

  private adjustBank: Handler<'bank.adjustment'> = async (ctx, op, seq, s) => {
    const bank = await this.bank(ctx, op.entityId, s);
    const now = this.clock.now();
    await this.adjustments.create(
      [{ _id: randomUUID(), storeId: ctx.storeId, bankId: bank._id, userId: ctx.userId, previousBalance: bank.storedLedgerBalance, newBalance: op.payload.newBalance, reason: op.payload.reason, createdAt: now }],
      { session: s },
    );
    const updated = await this.banks
      .findOneAndUpdate(
        { _id: bank._id, storeId: ctx.storeId },
        { $set: { storedLedgerBalance: op.payload.newBalance, balanceAsOf: now, ...this.stamp(seq) }, $inc: { version: 1 } },
        { returnDocument: 'after', session: s },
      )
      .lean<Doc>();
    return { entityType: 'bank', entity: MAPPERS.bank(updated!) };
  };
}
