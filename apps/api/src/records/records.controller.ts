import { Body, Controller, Delete, Get, HttpStatus, Param, Patch, Post, Put, Query, Res } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import {
  BankAdjustmentRequestSchema,
  BaselineUpdateRequestSchema,
  CommitmentCreateRequestSchema,
  CommitmentUpdateRequestSchema,
  DebtPaymentRequestSchema,
  DeleteRequestSchema,
  MovementCreateRequestSchema,
  MovementUpdateRequestSchema,
  RescheduleRequestSchema,
  VoidPaymentRequestSchema,
  SaleBatchRequestSchema,
  type BankProjection,
  type SyncOperation,
} from '@necta/contracts';
import type { Response } from 'express';
import type { Model } from 'mongoose';
import { Auth, Store, StoreScoped, type AuthContext, type StoreContext } from '../auth/auth.types';
import { AppError, parseBody } from '../common/errors';
import {
  toBank,
  toBaseline,
  toCommitment,
  toCounterparty,
  toMovement,
  toPayable,
  toReceivable,
  toSale,
  type Doc,
} from '../db/mappers';
import { MODELS } from '../db/schemas';
import { OperationsService, payloadHash, type OperationContext } from '../operations/operations.service';
import { sendOperationResult } from './http-result';

const live = (storeId: string) => ({ storeId, deletedAt: null });

@StoreScoped()
@Controller('v2')
export class RecordsController {
  constructor(
    private readonly ops: OperationsService,
    @InjectModel(MODELS.Bank) private readonly banks: Model<Doc>,
    @InjectModel(MODELS.Counterparty) private readonly counterparties: Model<Doc>,
    @InjectModel(MODELS.Receivable) private readonly receivables: Model<Doc>,
    @InjectModel(MODELS.Payable) private readonly payables: Model<Doc>,
    @InjectModel(MODELS.Movement) private readonly movements: Model<Doc>,
    @InjectModel(MODELS.Commitment) private readonly commitments: Model<Doc>,
    @InjectModel(MODELS.Sale) private readonly sales: Model<Doc>,
    @InjectModel(MODELS.Baseline) private readonly baselines: Model<Doc>,
  ) {}

  private ctx(auth: AuthContext, store: StoreContext): OperationContext {
    return { storeId: store.id, userId: auth.userId, platform: auth.platform, timeZone: store.timeZone };
  }

  private async run(auth: AuthContext, store: StoreContext, op: SyncOperation, res: Response) {
    return sendOperationResult(await this.ops.apply(this.ctx(auth, store), op), res);
  }

  // ---------- Bolsillos ----------

  @Get('banks')
  async listBanks(@Store() store: StoreContext) {
    return (await this.banks.find(live(store.id)).sort({ _id: 1 }).lean<Doc[]>()).map(toBank);
  }

  /** Contrato existente: reconstruye el saldo de hoy desde los movimientos (no proyecta el futuro). */
  @Get('banks/:id/projection')
  async projection(@Store() store: StoreContext, @Param('id') id: string): Promise<BankProjection> {
    const bank = await this.banks.findOne({ _id: id, ...live(store.id) }).lean<Doc>();
    if (!bank) throw new AppError('NOT_FOUND', 'Bolsillo inexistente', HttpStatus.NOT_FOUND);
    const [movs, sales, recs, pays] = await Promise.all([
      this.movements.find({ ...live(store.id), bankId: id }).lean<Doc[]>(),
      this.sales.find({ ...live(store.id), 'payments.bankId': id }).lean<Doc[]>(),
      this.receivables.find({ storeId: store.id, 'payments.bankId': id }).lean<Doc[]>(),
      this.payables.find({ storeId: store.id, 'payments.bankId': id }).lean<Doc[]>(),
    ]);
    const sumPayments = (docs: Doc[]) =>
      docs.flatMap((d) => (d.payments as Doc[]).filter((p) => p.bankId === id && !p.voidedAt)).reduce((a, p) => a + p.amount, 0);
    const projected =
      bank.openingBalance +
      movs.reduce((a, m) => a + (m.kind === 'income' ? m.amount : -m.amount), 0) +
      sumPayments(sales) +
      sumPayments(recs) -
      sumPayments(pays);
    return {
      storedLedgerBalance: bank.storedLedgerBalance,
      projectedBalance: projected,
      alignmentDelta: bank.storedLedgerBalance - projected,
    };
  }

  @Post('banks/:id/adjustments')
  async adjust(@Auth() auth: AuthContext, @Store() store: StoreContext, @Param('id') id: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const b = parseBody(BankAdjustmentRequestSchema, body);
    return this.run(auth, store, { type: 'bank.adjustment', clientMutationId: b.clientMutationId, dependsOn: [], entityId: id, payload: { newBalance: b.newBalance, reason: b.reason } }, res);
  }

  @Get('counterparties')
  async listCounterparties(@Store() store: StoreContext) {
    return (await this.counterparties.find(live(store.id)).sort({ name: 1 }).lean<Doc[]>()).map(toCounterparty);
  }

  // ---------- Ventas (contrato existente) ----------

  @Post('sale/batch')
  async saleBatch(@Auth() auth: AuthContext, @Store() store: StoreContext, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const batch = parseBody(SaleBatchRequestSchema, body);
    const ops: SyncOperation[] = batch.sales.map(({ clientMutationId, sale }) => ({
      type: 'sale.create',
      clientMutationId,
      dependsOn: [],
      // Sin id del cliente, se deriva del clientMutationId: un reintento produce la misma venta.
      payload: { sale: { ...sale, id: sale.id ?? `sale_${clientMutationId}`, expiresAt: sale.expiresAt ?? null } },
    }));
    // Contrato: mismo clientMutationId con datos distintos → 409 sin aplicar nada del lote.
    const mismatches: string[] = [];
    for (const op of ops) {
      const existing = await this.ops.findExisting(store.id, op.clientMutationId);
      if (existing && existing.payloadHash !== payloadHash(op)) mismatches.push(op.clientMutationId);
    }
    if (mismatches.length > 0) {
      throw new AppError('IDEMPOTENCY_PAYLOAD_MISMATCH', 'Ventas repetidas con datos distintos', HttpStatus.CONFLICT, { clientMutationIds: mismatches });
    }
    const results = await this.ops.applyMany(this.ctx(auth, store), ops);
    res.status(HttpStatus.OK);
    return { batchId: batch.batchId, results };
  }

  @Get('sales')
  async listSales(@Store() store: StoreContext, @Query('from') from?: string) {
    const filter: Doc = live(store.id);
    if (from) filter.saleDate = { $gte: from };
    return (await this.sales.find(filter).sort({ saleDate: -1 }).limit(200).lean<Doc[]>()).map(toSale);
  }

  // ---------- Cuentas por cobrar / pagar ----------

  @Get('receivables')
  async listReceivables(@Store() store: StoreContext, @Query('status') status?: string) {
    const filter: Doc = live(store.id);
    if (status === 'open') filter.pendingAmount = { $gt: 0 };
    return (await this.receivables.find(filter).sort({ creditDueBy: 1 }).lean<Doc[]>()).map(toReceivable);
  }

  @Get('receivables/:id')
  async getReceivable(@Store() store: StoreContext, @Param('id') id: string) {
    const doc = await this.receivables.findOne({ _id: id, ...live(store.id) }).lean<Doc>();
    if (!doc) throw new AppError('NOT_FOUND', 'Cuenta inexistente', HttpStatus.NOT_FOUND);
    return toReceivable(doc);
  }

  @Post('receivables/:id/payments')
  async payReceivable(@Auth() auth: AuthContext, @Store() store: StoreContext, @Param('id') id: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { clientMutationId, ...payload } = parseBody(DebtPaymentRequestSchema, body);
    return this.run(auth, store, { type: 'receivable.payment', clientMutationId, dependsOn: [], entityId: id, payload }, res);
  }

  /** Extensión: anular un cobro mal cargado. El servidor toma monto, bolsillo y fecha del pago guardado. */
  @Post('receivables/:id/payments/:paymentId/void')
  voidReceivablePayment(@Auth() auth: AuthContext, @Store() store: StoreContext, @Param('id') id: string, @Param('paymentId') paymentId: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    return this.voidPayment('receivable', auth, store, id, paymentId, body, res);
  }

  /** Extensión: anular un pago mal cargado. */
  @Post('payables/:id/payments/:paymentId/void')
  voidPayablePayment(@Auth() auth: AuthContext, @Store() store: StoreContext, @Param('id') id: string, @Param('paymentId') paymentId: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    return this.voidPayment('payable', auth, store, id, paymentId, body, res);
  }

  private async voidPayment(kind: 'receivable' | 'payable', auth: AuthContext, store: StoreContext, id: string, paymentId: string, body: unknown, res: Response) {
    const { clientMutationId } = parseBody(VoidPaymentRequestSchema, body);
    const model = kind === 'receivable' ? this.receivables : this.payables;
    const doc = await model.findOne({ _id: id, ...live(store.id) }).lean<Doc>();
    const payment = (doc?.payments as Doc[] | undefined)?.find((p) => p.clientMutationId === paymentId);
    if (!doc || !payment) throw new AppError('NOT_FOUND', 'Pago inexistente', HttpStatus.NOT_FOUND);
    return this.run(
      auth,
      store,
      {
        type: kind === 'receivable' ? 'receivable.payment.void' : 'payable.payment.void',
        clientMutationId,
        dependsOn: [],
        entityId: id,
        payload: { paymentClientMutationId: paymentId, amount: payment.amount, bankId: payment.bankId, paymentDate: payment.paymentDate },
      },
      res,
    );
  }

  /** Extensión: la clienta paga otro día. Escritura condicional por versión. */
  @Post('receivables/:id/reschedule')
  async reschedule(@Auth() auth: AuthContext, @Store() store: StoreContext, @Param('id') id: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const b = parseBody(RescheduleRequestSchema, body);
    return this.run(auth, store, { type: 'receivable.reschedule', clientMutationId: b.clientMutationId, dependsOn: [], entityId: id, baseVersion: b.baseVersion, payload: { newDueDate: b.newDueDate } }, res);
  }

  @Get('payables')
  async listPayables(@Store() store: StoreContext, @Query('status') status?: string) {
    const filter: Doc = live(store.id);
    if (status === 'open') filter.pendingAmount = { $gt: 0 };
    return (await this.payables.find(filter).sort({ creditDueBy: 1 }).lean<Doc[]>()).map(toPayable);
  }

  @Post('payables/:id/payments')
  async payPayable(@Auth() auth: AuthContext, @Store() store: StoreContext, @Param('id') id: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const { clientMutationId, ...payload } = parseBody(DebtPaymentRequestSchema, body);
    return this.run(auth, store, { type: 'payable.payment', clientMutationId, dependsOn: [], entityId: id, payload }, res);
  }

  // ---------- Ingresos y gastos ----------

  @Get('movements')
  async listMovements(@Store() store: StoreContext, @Query('from') from?: string) {
    const filter: Doc = live(store.id);
    if (from) filter.date = { $gte: from };
    return (await this.movements.find(filter).sort({ date: -1, updatedAt: -1 }).limit(200).lean<Doc[]>()).map(toMovement);
  }

  @Post('movements')
  async createMovement(@Auth() auth: AuthContext, @Store() store: StoreContext, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const b = parseBody(MovementCreateRequestSchema, body);
    return this.run(auth, store, { type: 'movement.create', clientMutationId: b.clientMutationId, dependsOn: [], payload: { movement: b.movement } }, res);
  }

  @Patch('movements/:id')
  async updateMovement(@Auth() auth: AuthContext, @Store() store: StoreContext, @Param('id') id: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const b = parseBody(MovementUpdateRequestSchema, body);
    return this.run(auth, store, { type: 'movement.update', clientMutationId: b.clientMutationId, dependsOn: [], entityId: id, baseVersion: b.baseVersion, payload: { changes: b.changes } }, res);
  }

  @Delete('movements/:id')
  async deleteMovement(@Auth() auth: AuthContext, @Store() store: StoreContext, @Param('id') id: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const b = parseBody(DeleteRequestSchema, body);
    return this.run(auth, store, { type: 'movement.delete', clientMutationId: b.clientMutationId, dependsOn: [], entityId: id, baseVersion: b.baseVersion, payload: {} }, res);
  }

  // ---------- Compromisos y base de contado ----------

  @Get('commitments')
  async listCommitments(@Store() store: StoreContext) {
    return (await this.commitments.find(live(store.id)).sort({ concept: 1 }).lean<Doc[]>()).map(toCommitment);
  }

  @Post('commitments')
  async createCommitment(@Auth() auth: AuthContext, @Store() store: StoreContext, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const b = parseBody(CommitmentCreateRequestSchema, body);
    return this.run(auth, store, { type: 'commitment.create', clientMutationId: b.clientMutationId, dependsOn: [], payload: { commitment: b.commitment } }, res);
  }

  @Patch('commitments/:id')
  async updateCommitment(@Auth() auth: AuthContext, @Store() store: StoreContext, @Param('id') id: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const b = parseBody(CommitmentUpdateRequestSchema, body);
    return this.run(auth, store, { type: 'commitment.update', clientMutationId: b.clientMutationId, dependsOn: [], entityId: id, baseVersion: b.baseVersion, payload: { changes: b.changes } }, res);
  }

  @Delete('commitments/:id')
  async deleteCommitment(@Auth() auth: AuthContext, @Store() store: StoreContext, @Param('id') id: string, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const b = parseBody(DeleteRequestSchema, body);
    return this.run(auth, store, { type: 'commitment.delete', clientMutationId: b.clientMutationId, dependsOn: [], entityId: id, baseVersion: b.baseVersion, payload: {} }, res);
  }

  @Get('cash-baseline')
  async getBaseline(@Store() store: StoreContext) {
    const doc = await this.baselines.findOne(live(store.id)).lean<Doc>();
    return doc ? toBaseline(doc) : null;
  }

  @Put('cash-baseline')
  async putBaseline(@Auth() auth: AuthContext, @Store() store: StoreContext, @Body() body: unknown, @Res({ passthrough: true }) res: Response) {
    const b = parseBody(BaselineUpdateRequestSchema, body);
    return this.run(auth, store, { type: 'baseline.update', clientMutationId: b.clientMutationId, dependsOn: [], baseVersion: b.baseVersion, payload: b.baseline }, res);
  }
}
