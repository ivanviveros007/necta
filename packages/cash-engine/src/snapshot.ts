import { addDays, localDateInZone, type LocalDate } from './dates';
import type {
  CashBaseline,
  CommitmentInput,
  ForecastInput,
  PaymentHistory,
  ReliabilityPolicy,
  Schedule,
  TodayPolicy,
} from './types';

/**
 * Estado de una tienda tal como lo guardan el servidor (MongoDB) y el móvil (SQLite).
 * `buildForecastInput` es el único armado de entrada, para que servidor y teléfono calculen igual.
 */
export interface SnapshotBank {
  id: string;
  name: string;
  storedLedgerBalance: number;
  reconstructedBalance: number | null;
  /** Instante desde el cual los movimientos afectan el saldo guardado. */
  balanceAsOf: string | null;
  deletedAt?: string | null;
}

export interface SnapshotCounterparty {
  id: string;
  name: string;
  aggregated?: boolean;
  history: PaymentHistory;
  deletedAt?: string | null;
}

export interface SnapshotReceivable {
  id: string;
  counterpartyId: string | null;
  counterpartyName: string;
  totalAmount: number;
  pendingAmount: number;
  creditDueBy: LocalDate | null;
  dueHint?: string | null;
  deletedAt?: string | null;
}

export interface SnapshotPayable {
  id: string;
  counterpartyName: string;
  totalAmount: number;
  pendingAmount: number;
  creditDueBy: LocalDate | null;
  negotiable: boolean;
  deletedAt?: string | null;
}

export interface SnapshotCommitment {
  id: string;
  direction: 'inflow' | 'outflow';
  concept: string;
  amount: number;
  schedule: Schedule;
  negotiable: boolean;
  deletedAt?: string | null;
}

export interface SnapshotMovement {
  id: string;
  kind: 'income' | 'expense';
  amount: number;
  bankId: string;
  date: LocalDate;
  affectsBalance: boolean;
  deletedAt?: string | null;
}

export interface SnapshotSale {
  id: string;
  saleDate: LocalDate;
  /** Parte cobrada al momento de la venta (contado). */
  paidAmount: number;
  deletedAt?: string | null;
}

export interface StoreSnapshot {
  currency: string;
  timeZone: string;
  businessDate: LocalDate;
  todayPolicy: TodayPolicy;
  banks: SnapshotBank[];
  counterparties: SnapshotCounterparty[];
  receivables: SnapshotReceivable[];
  payables: SnapshotPayable[];
  commitments: SnapshotCommitment[];
  movements: SnapshotMovement[];
  sales: SnapshotSale[];
  baseline: CashBaseline | null;
  policy?: Partial<ReliabilityPolicy>;
}

const live = <T extends { deletedAt?: string | null }>(items: readonly T[]): T[] => items.filter((i) => !i.deletedAt);

export function buildForecastInput(snapshot: StoreSnapshot): ForecastInput {
  const banks = live(snapshot.banks);
  const counterparties = new Map(live(snapshot.counterparties).map((c) => [c.id, c]));
  const today = snapshot.businessDate;
  const stored = banks.reduce((acc, b) => acc + b.storedLedgerBalance, 0);
  const reconstructed = banks.every((b) => b.reconstructedBalance !== null)
    ? banks.reduce((acc, b) => acc + (b.reconstructedBalance ?? 0), 0)
    : null;
  const asOf = banks
    .map((b) => b.balanceAsOf)
    .filter((v): v is string => Boolean(v))
    .sort()
    .at(-1) ?? null;

  const movementsToday = live(snapshot.movements).filter((m) => m.date === today);
  const salesToday = live(snapshot.sales).filter((s) => s.saleDate === today);

  return {
    currency: snapshot.currency,
    timeZone: snapshot.timeZone,
    today,
    todayPolicy: snapshot.todayPolicy,
    balance: { stored, reconstructed, asOf },
    realizedToday: {
      cashSales:
        movementsToday.filter((m) => m.kind === 'income').reduce((a, m) => a + m.amount, 0) +
        salesToday.reduce((a, s) => a + s.paidAmount, 0),
      cashExpenses: movementsToday.filter((m) => m.kind === 'expense').reduce((a, m) => a + m.amount, 0),
    },
    receivables: live(snapshot.receivables).map((r) => {
      const cp = r.counterpartyId ? counterparties.get(r.counterpartyId) : undefined;
      return {
        id: r.id,
        counterpartyId: r.counterpartyId,
        counterpartyName: r.counterpartyName,
        pendingAmount: r.pendingAmount,
        dueDate: r.creditDueBy,
        dueHint: r.dueHint ?? null,
        aggregated: cp?.aggregated ?? false,
        history: cp?.history ?? { payments: 0, onTime: 0, avgDaysLate: null },
      };
    }),
    payables: live(snapshot.payables).map((p) => ({
      id: p.id,
      counterpartyName: p.counterpartyName,
      pendingAmount: p.pendingAmount,
      dueDate: p.creditDueBy,
      negotiable: p.negotiable,
    })),
    commitments: live(snapshot.commitments).map(
      (c): CommitmentInput => ({
        id: c.id,
        direction: c.direction,
        concept: c.concept,
        amount: c.amount,
        schedule: c.schedule,
        negotiable: c.negotiable,
      }),
    ),
    baseline: snapshot.baseline,
    policy: snapshot.policy,
  };
}

/** ¿Un movimiento con esta fecha afecta el saldo guardado del bolsillo? (si no, es carga histórica) */
export function affectsStoredBalance(date: LocalDate, balanceAsOf: string | null, timeZone: string): boolean {
  if (!balanceAsOf) return true;
  return date >= localDateInZone(balanceAsOf, timeZone);
}

export function defaultCreditDueBy(saleDate: LocalDate): LocalDate {
  return addDays(saleDate, 30);
}
