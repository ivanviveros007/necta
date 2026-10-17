import type {
  BankEntity,
  BaselineEntity,
  CommitmentEntity,
  CounterpartyEntity,
  EntityType,
  MovementEntity,
  PayableEntity,
  ReceivableEntity,
  SaleEntity,
} from '@necta/contracts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Doc = Record<string, any>;

const iso = (d: Date | string | null | undefined): string | null =>
  d === null || d === undefined ? null : d instanceof Date ? d.toISOString() : new Date(d).toISOString();

function meta(d: Doc) {
  return {
    id: d._id as string,
    version: d.version as number,
    seq: d.seq as number,
    updatedAt: iso(d.updatedAt) ?? new Date(0).toISOString(),
    deletedAt: iso(d.deletedAt),
  };
}

export const toBank = (d: Doc): BankEntity => ({
  ...meta(d),
  name: d.name,
  storedLedgerBalance: d.storedLedgerBalance,
  reconstructedBalance: d.reconstructedBalance,
  balanceAsOf: iso(d.balanceAsOf),
});

export const toCounterparty = (d: Doc): CounterpartyEntity => ({
  ...meta(d),
  name: d.name,
  kind: d.kind,
  aggregated: Boolean(d.aggregated),
  history: {
    payments: d.history?.payments ?? 0,
    onTime: d.history?.onTime ?? 0,
    avgDaysLate: d.history?.avgDaysLate ?? null,
  },
});

const payments = (list: Doc[] | undefined) =>
  (list ?? []).map((p) => ({
    clientMutationId: p.clientMutationId,
    bankId: p.bankId,
    amount: p.amount,
    method: p.method,
    paymentDate: p.paymentDate,
    voidedAt: iso(p.voidedAt),
    recordedAt: iso(p.recordedAt),
  }));

export const toReceivable = (d: Doc): ReceivableEntity => ({
  ...meta(d),
  counterpartyId: d.counterpartyId ?? null,
  counterpartyName: d.counterpartyName,
  totalAmount: d.totalAmount,
  pendingAmount: d.pendingAmount,
  creditDueBy: d.creditDueBy ?? null,
  originalDueBy: d.originalDueBy ?? null,
  dueHint: d.dueHint ?? null,
  payments: payments(d.payments),
});

export const toPayable = (d: Doc): PayableEntity => ({ ...toReceivable(d), negotiable: Boolean(d.negotiable) });

export const toMovement = (d: Doc): MovementEntity => ({
  ...meta(d),
  kind: d.kind,
  amount: d.amount,
  bankId: d.bankId,
  date: d.date,
  description: d.description ?? '',
  affectsBalance: Boolean(d.affectsBalance),
  createdAt: iso(d.createdAt),
});

export const toCommitment = (d: Doc): CommitmentEntity => ({
  ...meta(d),
  direction: d.direction,
  concept: d.concept,
  amount: d.amount,
  schedule: d.schedule,
  negotiable: Boolean(d.negotiable),
});

export const toSale = (d: Doc): SaleEntity => ({
  ...meta(d),
  customerId: d.customerId,
  totalAmount: d.totalAmount,
  paidAmount: d.paidAmount,
  saleDate: d.saleDate,
  expiresAt: d.expiresAt ?? null,
});

export const toBaseline = (d: Doc): BaselineEntity => ({
  ...meta(d),
  weekdaySales: d.weekdaySales,
  weekdayExpenses: d.weekdayExpenses,
});

export const MAPPERS: Record<EntityType, (d: Doc) => unknown> = {
  bank: toBank,
  counterparty: toCounterparty,
  receivable: toReceivable,
  payable: toPayable,
  movement: toMovement,
  commitment: toCommitment,
  sale: toSale,
  baseline: toBaseline,
};
