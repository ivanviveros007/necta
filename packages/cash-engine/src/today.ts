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
}

export interface TodayActivity {
  items: TodayItem[];
  sales: { done: number; expected: number };
  expenses: { done: number; expected: number };
}

interface DebtWithPayments {
  counterpartyName: string;
  payments?: { clientMutationId: string; amount: number; paymentDate: string }[];
}

export interface TodayRecords {
  businessDate: LocalDate;
  movements: { id: string; kind: 'income' | 'expense'; amount: number; date: string; description?: string; deletedAt?: string | null }[];
  sales: { id: string; saleDate: string; paidAmount: number; deletedAt?: string | null }[];
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
    items.push({ key: `m:${m.id}`, label: m.description || (m.kind === 'income' ? 'Ingreso' : 'Gasto'), amount: m.kind === 'income' ? m.amount : -m.amount, state: 'confirmed', movementId: m.id });
    if (m.kind === 'income') sales += m.amount;
    else expenses += m.amount;
  }
  for (const s of r.sales) {
    if (s.saleDate !== today || s.deletedAt || s.paidAmount <= 0) continue;
    items.push({ key: `s:${s.id}`, label: 'Venta de contado', amount: s.paidAmount, state: 'confirmed' });
    sales += s.paidAmount;
  }
  for (const d of r.receivables) {
    for (const p of d.payments ?? []) if (p.paymentDate === today) items.push({ key: `rp:${p.clientMutationId}`, label: `Cobro ${d.counterpartyName}`, amount: p.amount, state: 'confirmed' });
  }
  for (const d of r.payables) {
    for (const p of d.payments ?? []) if (p.paymentDate === today) items.push({ key: `pp:${p.clientMutationId}`, label: `Pago ${d.counterpartyName}`, amount: -p.amount, state: 'confirmed' });
  }
  for (const e of extra) {
    items.push(e);
    if (e.state === 'pending' && e.key.startsWith('o:mv:')) {
      if (e.amount > 0) sales += e.amount;
      else expenses += -e.amount;
    }
  }
  const wd = weekday(today);
  return {
    items,
    sales: { done: sales, expected: r.baseline?.weekdaySales[wd] ?? 0 },
    expenses: { done: expenses, expected: r.baseline?.weekdayExpenses[wd] ?? 0 },
  };
}
