import { weekday, type LocalDate } from './dates';

export interface TodayItem {
  key: string;
  label: string;
  /** Con signo: + entra a caja, − sale. 0 si no mueve plata (p. ej. nueva fecha). */
  amount: number;
  /** pending: guardado en el dispositivo, aún no confirmado por el servidor. */
  state: 'confirmed' | 'pending' | 'problem';
  /** Ingreso o gasto editable: id del movimiento (y operación local si aún no se envió). */
  movementId?: string;
  pendingClientMutationId?: string;
  /** Instante de registro (ISO); ordena la lista. null en datos anteriores al campo. */
  at?: string | null;
  /** Cobro/pago de una deuda (anulable). */
  payment?: { kind: 'receivable' | 'payable'; debtId: string; clientMutationId: string; amount: number; bankId: string; paymentDate: string };
}

export interface TodayActivity {
  items: TodayItem[];
  sales: { done: number; expected: number };
  expenses: { done: number; expected: number };
}

interface DebtWithPayments {
  id?: string;
  counterpartyName: string;
  payments?: { clientMutationId: string; amount: number; paymentDate: string; bankId?: string; voidedAt?: string | null; recordedAt?: string | null }[];
}

export interface TodayRecords {
  businessDate: LocalDate;
  movements: { id: string; kind: 'income' | 'expense'; amount: number; date: string; description?: string; deletedAt?: string | null; createdAt?: string | null; updatedAt?: string }[];
  sales: { id: string; saleDate: string; paidAmount: number; deletedAt?: string | null; updatedAt?: string }[];
  receivables: DebtWithPayments[];
  payables: DebtWithPayments[];
  baseline: { weekdaySales: number[]; weekdayExpenses: number[] } | null;
}

/**
 * Lo registrado hoy y el avance de ventas/gastos contra lo habitual del día.
 * Lo usan web (todo confirmado) y móvil (que agrega sus operaciones pendientes).
 */
export function todayActivity(r: TodayRecords, extra: TodayItem[] = []): TodayActivity {
  const today = r.businessDate;
  const items: TodayItem[] = [];
  let sales = 0;
  let expenses = 0;
  for (const m of r.movements) {
    if (m.date !== today || m.deletedAt) continue;
    items.push({ key: `m:${m.id}`, label: m.description || (m.kind === 'income' ? 'Ingreso' : 'Gasto'), amount: m.kind === 'income' ? m.amount : -m.amount, state: 'confirmed', movementId: m.id, at: m.createdAt ?? m.updatedAt ?? null });
    if (m.kind === 'income') sales += m.amount;
    else expenses += m.amount;
  }
  for (const s of r.sales) {
    if (s.saleDate !== today || s.deletedAt || s.paidAmount <= 0) continue;
    items.push({ key: `s:${s.id}`, label: 'Venta de contado', amount: s.paidAmount, state: 'confirmed', at: s.updatedAt ?? null });
    sales += s.paidAmount;
  }
  const debtItems = (kind: 'receivable' | 'payable', list: DebtWithPayments[]) => {
    for (const d of list) {
      for (const p of d.payments ?? []) {
        if (p.paymentDate !== today || p.voidedAt) continue;
        items.push({
          key: `${kind === 'receivable' ? 'rp' : 'pp'}:${p.clientMutationId}`,
          label: `${kind === 'receivable' ? 'Cobro' : 'Pago'} ${d.counterpartyName}`,
          amount: kind === 'receivable' ? p.amount : -p.amount,
          state: 'confirmed',
          at: p.recordedAt ?? null,
          payment: d.id ? { kind, debtId: d.id, clientMutationId: p.clientMutationId, amount: p.amount, bankId: p.bankId ?? '', paymentDate: p.paymentDate } : undefined,
        });
      }
    }
  };
  debtItems('receivable', r.receivables);
  debtItems('payable', r.payables);
  for (const e of extra) {
    items.push(e);
    if (e.state === 'pending' && e.key.startsWith('o:mv:')) {
      if (e.amount > 0) sales += e.amount;
      else expenses += -e.amount;
    }
  }
  // Mismo orden en web y móvil: lo más reciente primero; sin hora (datos viejos) al final; desempate estable.
  items.sort((a, b) => {
    const x = a.at ?? '';
    const y = b.at ?? '';
    if (x !== y) return x < y ? 1 : -1;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  const wd = weekday(today);
  return {
    items,
    sales: { done: sales, expected: r.baseline?.weekdaySales[wd] ?? 0 },
    expenses: { done: expenses, expected: r.baseline?.weekdayExpenses[wd] ?? 0 },
  };
}
