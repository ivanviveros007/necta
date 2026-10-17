import { affectsStoredBalance, defaultCreditDueBy, type SnapshotCommitment, type StoreSnapshot } from './snapshot';
import type { CashBaseline, Schedule } from './types';

/**
 * Operaciones locales aún no reconciliadas con el servidor. La forma coincide con
 * `SyncOperation` de @necta/contracts (estructuralmente), sin depender de ese paquete.
 */
export type PendingOperation =
  | {
      type: 'movement.create';
      payload: { movement: { id: string; kind: 'income' | 'expense'; amount: number; bankId: string; date: string } };
    }
  | { type: 'movement.update'; entityId: string; payload: { changes: { amount?: number; date?: string; description?: string } } }
  | { type: 'movement.delete'; entityId: string; payload?: unknown }
  | {
      type: 'sale.create';
      payload: {
        sale: {
          id: string;
          customerId: string;
          items: { quantitiesSold: number; finalPrice: number }[];
          payments: { bankId: string; amount: number; paymentDate: string }[];
          saleDate: string;
          expiresAt?: string | null;
        };
      };
    }
  | { type: 'receivable.payment'; entityId: string; payload: { bankId: string; amount: number; paymentDate: string } }
  | { type: 'payable.payment'; entityId: string; payload: { bankId: string; amount: number; paymentDate: string } }
  | { type: 'receivable.reschedule'; entityId: string; payload: { newDueDate: string } }
  | { type: 'receivable.payment.void' | 'payable.payment.void'; entityId: string; payload: { paymentClientMutationId: string; amount: number; bankId: string; paymentDate: string } }
  | {
      type: 'commitment.create';
      payload: {
        commitment: {
          id: string;
          direction: 'inflow' | 'outflow';
          concept: string;
          amount: number;
          schedule: Schedule;
          negotiable: boolean;
        };
      };
    }
  | { type: 'commitment.update'; entityId: string; payload: { changes: Partial<Omit<SnapshotCommitment, 'id'>> } }
  | { type: 'commitment.delete'; entityId: string; payload?: unknown }
  | { type: 'baseline.update'; payload: CashBaseline }
  | { type: 'bank.adjustment'; entityId: string; payload: { newBalance: number }; createdAt: string };

function adjustBank(snapshot: StoreSnapshot, bankId: string, delta: number, date: string): void {
  const bank = snapshot.banks.find((b) => b.id === bankId);
  if (!bank) return;
  if (affectsStoredBalance(date, bank.balanceAsOf, snapshot.timeZone)) bank.storedLedgerBalance += delta;
  if (bank.reconstructedBalance !== null) bank.reconstructedBalance += delta;
}

/**
 * Aplica una vez los efectos de las operaciones pendientes sobre el último estado confirmado.
 * Devuelve una copia: el estado confirmado no se modifica.
 */
export function applyPendingOperations(base: StoreSnapshot, operations: readonly PendingOperation[]): StoreSnapshot {
  const s: StoreSnapshot = structuredCloneSnapshot(base);
  for (const op of operations) {
    switch (op.type) {
      case 'movement.create': {
        const m = op.payload.movement;
        if (s.movements.some((x) => x.id === m.id)) break; // ya confirmado: no se aplica dos veces
        const bank = s.banks.find((b) => b.id === m.bankId);
        const affects = affectsStoredBalance(m.date, bank?.balanceAsOf ?? null, s.timeZone);
        s.movements.push({ id: m.id, kind: m.kind, amount: m.amount, bankId: m.bankId, date: m.date, affectsBalance: affects });
        adjustBank(s, m.bankId, m.kind === 'income' ? m.amount : -m.amount, m.date);
        break;
      }
      case 'movement.update': {
        const m = s.movements.find((x) => x.id === op.entityId && !x.deletedAt);
        if (!m) break;
        const sign = m.kind === 'income' ? 1 : -1;
        const newAmount = op.payload.changes.amount ?? m.amount;
        const bank = s.banks.find((b) => b.id === m.bankId);
        if (bank) {
          const delta = sign * (newAmount - m.amount);
          if (m.affectsBalance) bank.storedLedgerBalance += delta;
          if (bank.reconstructedBalance !== null) bank.reconstructedBalance += delta;
        }
        m.amount = newAmount;
        if (op.payload.changes.date) m.date = op.payload.changes.date;
        if (op.payload.changes.description !== undefined) (m as { description?: string }).description = op.payload.changes.description;
        break;
      }
      case 'movement.delete': {
        const m = s.movements.find((x) => x.id === op.entityId && !x.deletedAt);
        if (!m) break;
        const bank = s.banks.find((b) => b.id === m.bankId);
        if (bank) {
          const delta = (m.kind === 'income' ? -1 : 1) * m.amount;
          if (m.affectsBalance) bank.storedLedgerBalance += delta;
          if (bank.reconstructedBalance !== null) bank.reconstructedBalance += delta;
        }
        m.deletedAt = 'pending';
        break;
      }
      case 'sale.create': {
        const sale = op.payload.sale;
        if (s.sales.some((x) => x.id === sale.id)) break;
        const total = sale.items.reduce((acc, i) => acc + i.quantitiesSold * i.finalPrice, 0);
        const paid = sale.payments.reduce((acc, p) => acc + p.amount, 0);
        for (const p of sale.payments) adjustBank(s, p.bankId, p.amount, p.paymentDate);
        s.sales.push({ id: sale.id, saleDate: sale.saleDate, paidAmount: paid });
        if (total - paid > 0) {
          const cp = s.counterparties.find((c) => c.id === sale.customerId);
          s.receivables.push({
            id: sale.id,
            counterpartyId: sale.customerId,
            counterpartyName: cp?.name ?? 'Clienta',
            totalAmount: total,
            pendingAmount: total - paid,
            creditDueBy: sale.expiresAt ?? defaultCreditDueBy(sale.saleDate),
          });
        }
        break;
      }
      case 'receivable.payment': {
        const r = s.receivables.find((x) => x.id === op.entityId);
        if (!r) break;
        const amount = Math.min(op.payload.amount, r.pendingAmount);
        r.pendingAmount -= amount;
        adjustBank(s, op.payload.bankId, amount, op.payload.paymentDate);
        break;
      }
      case 'receivable.payment.void':
      case 'payable.payment.void': {
        const list = op.type === 'receivable.payment.void' ? s.receivables : s.payables;
        const d = list.find((x) => x.id === op.entityId) as (typeof list)[number] & { payments?: { clientMutationId: string; voidedAt?: string | null }[] } | undefined;
        const p = d?.payments?.find((x) => x.clientMutationId === op.payload.paymentClientMutationId);
        if (!d || (p && p.voidedAt)) break;
        d.pendingAmount += op.payload.amount;
        if (p) p.voidedAt = 'pending';
        adjustBank(s, op.payload.bankId, op.type === 'receivable.payment.void' ? -op.payload.amount : op.payload.amount, op.payload.paymentDate);
        break;
      }
      case 'receivable.reschedule': {
        const r = s.receivables.find((x) => x.id === op.entityId);
        if (r) r.creditDueBy = op.payload.newDueDate;
        break;
      }
      case 'payable.payment': {
        const p = s.payables.find((x) => x.id === op.entityId);
        if (!p) break;
        const amount = Math.min(op.payload.amount, p.pendingAmount);
        p.pendingAmount -= amount;
        adjustBank(s, op.payload.bankId, -amount, op.payload.paymentDate);
        break;
      }
      case 'commitment.create': {
        const c = op.payload.commitment;
        if (s.commitments.some((x) => x.id === c.id)) break;
        s.commitments.push({ ...c });
        break;
      }
      case 'commitment.update': {
        const c = s.commitments.find((x) => x.id === op.entityId);
        if (c) Object.assign(c, op.payload.changes);
        break;
      }
      case 'commitment.delete': {
        const c = s.commitments.find((x) => x.id === op.entityId);
        if (c) c.deletedAt = 'pending';
        break;
      }
      case 'baseline.update':
        s.baseline = { weekdaySales: [...op.payload.weekdaySales], weekdayExpenses: [...op.payload.weekdayExpenses] };
        break;
      case 'bank.adjustment': {
        const bank = s.banks.find((b) => b.id === op.entityId);
        if (bank) {
          bank.storedLedgerBalance = op.payload.newBalance;
          bank.balanceAsOf = op.createdAt;
        }
        break;
      }
    }
  }
  return s;
}

function structuredCloneSnapshot(s: StoreSnapshot): StoreSnapshot {
  return JSON.parse(JSON.stringify(s)) as StoreSnapshot;
}
