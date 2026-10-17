import { addDays, formatShortDate, weekday, type LocalDate } from './dates';
import { formatMoney, sum } from './money';
import type { ForecastResult, ForecastStatus } from './types';

const WEEKDAY_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** «jue 28 may» */
export function formatDayShort(date: LocalDate): string {
  return `${WEEKDAY_SHORT[weekday(date)]} ${formatShortDate(date)}`;
}

export interface UpcomingItem {
  key: string;
  date: LocalDate;
  label: string;
  /** Con signo: + entra, − sale. */
  amount: number;
  kind: 'receivable' | 'payable' | 'commitment';
}

export interface PaymentCoverage {
  key: string;
  date: LocalDate;
  label: string;
  amount: number;
  /** covered: alcanza; depends: alcanza solo si entra el cobro más grande; short: con lo esperado, falta. */
  status: 'covered' | 'depends' | 'short';
  /** Parte del pago que no se cubre con lo esperado. */
  shortBy: number;
  dependsOn: string | null;
}

export interface HomeSummary {
  /** «¿Me alcanza para lo que tengo que pagar?» en una frase. */
  answer: string;
  answerDetail: string;
  payments: PaymentCoverage[];
  coveredCount: number;
  status: ForecastStatus;
  /** Una sola línea que responde «¿me alcanza?». */
  statusLine: string;
  balanceToday: number;
  balanceDelta: number | null;
  totals: { inflow: number; outflow: number; unscheduled: number };
  upcoming: UpcomingItem[];
  primaryAction: { title: string; kind: string; target: string; amount: number; postponeDays: number | null } | null;
  minBalance: { date: LocalDate; amount: number };
}

/**
 * Resumen compacto para la home de app y web. Genérico para cualquier tienda: sale de los datos
 * de cada una, sin textos armados para un caso particular.
 */
export function summarizeForecast(f: ForecastResult, upcomingLimit = 5): HomeSummary {
  const expected = f.scenarios.expected;
  const exp = expected.firstShortfall;
  const cons = f.scenarios.conservative.firstShortfall;
  const removed = f.scenarios.conservative.removedInflow;
  const money = (n: number) => formatMoney(n, f.currency);

  let statusLine: string;
  if (f.status === 'short' && exp) {
    statusLine =
      exp.date === f.window.start
        ? `Faltan ${money(exp.amount)} hoy`
        : `Alcanza hasta el ${formatDayShort(addDays(exp.date, -1))} · faltan ${money(exp.amount)} el ${formatDayShort(exp.date)}`;
  } else if (f.status === 'depends' && cons && removed) {
    statusLine = `Alcanza si ${removed.label.replace(/^Cobro /, '')} paga el ${formatDayShort(removed.date)}`;
  } else {
    statusLine = 'Alcanza las próximas dos semanas';
  }

  const upcoming: UpcomingItem[] = expected.days
    .flatMap((d) =>
      [...d.inflows, ...d.outflows]
        .filter((fl) => fl.kind === 'receivable' || fl.kind === 'payable' || fl.kind === 'commitment')
        .map((fl) => ({
          key: fl.key,
          date: d.date,
          label: fl.label,
          amount: fl.direction === 'inflow' ? fl.amount : -fl.amount,
          kind: fl.kind as UpcomingItem['kind'],
        })),
    )
    .slice(0, upcomingLimit);

  const payments = paymentCoverage(f);
  const coveredCount = payments.filter((p) => p.status !== 'short').length;
  const firstShort = payments.find((p) => p.status === 'short');
  const firstDepends = payments.find((p) => p.status === 'depends');
  let answer: string;
  let answerDetail: string;
  if (payments.length === 0) {
    answer = 'No tienes pagos cargados en estas dos semanas';
    answerDetail = 'Carga arriendo, sueldos o cuotas para saber si te alcanza.';
  } else if (firstShort) {
    answer = `Cubres ${coveredCount} de ${payments.length} pagos`;
    const depending = payments.filter((p) => p.status === 'depends').length;
    answerDetail = `Faltan ${money(firstShort.shortBy)} para ${firstShort.label} el ${formatDayShort(firstShort.date)}.`;
    if (firstDepends) answerDetail += ` ${depending === 1 ? 'Otro depende' : `Otros ${depending} dependen`} de que ${firstDepends.dependsOn} te pague.`;
  } else if (firstDepends) {
    answer = `Cubres tus ${payments.length} pagos si ${firstDepends.dependsOn} te paga`;
    answerDetail = `Sin ese cobro no alcanza para ${firstDepends.label} el ${formatDayShort(firstDepends.date)}.`;
  } else {
    answer = `Te alcanza para tus ${payments.length} pagos`;
    answerDetail = `El saldo más bajo sería ${money(expected.minBalance.amount)} el ${formatDayShort(expected.minBalance.date)}.`;
  }

  const action = f.actions[0];
  return {
    answer,
    answerDetail,
    payments,
    coveredCount,
    status: f.status,
    statusLine,
    balanceToday: f.reference.storedBalance,
    balanceDelta: f.reference.alignmentDelta,
    totals: {
      inflow: sum(expected.days.map((d) => d.totalIn)),
      outflow: sum(expected.days.map((d) => d.totalOut)),
      unscheduled: sum(f.unscheduledReceivables.filter((u) => u.reason !== 'due_after_window').map((u) => u.pendingAmount)),
    },
    upcoming,
    primaryAction: action ? { title: action.title, kind: action.kind, target: action.target, amount: action.amount, postponeDays: action.postponeDays ?? null } : null,
    minBalance: expected.minBalance,
  };
}

/**
 * Cobertura de cada pago (cuentas por pagar y compromisos) con el escenario esperado. Si el cierre del
 * día queda negativo, el faltante se asigna primero al pago más grande de ese día.
 */
export function paymentCoverage(f: ForecastResult): PaymentCoverage[] {
  const conservative = new Map(f.scenarios.conservative.days.map((d) => [d.date, d.closing]));
  const removed = f.scenarios.conservative.removedInflow;
  const who = removed ? removed.label.replace(/^Cobro /, '') : null;
  const result: PaymentCoverage[] = [];
  for (const day of f.scenarios.expected.days) {
    const outs = day.outflows.filter((o) => o.kind === 'payable' || o.kind === 'commitment').sort((a, b) => b.amount - a.amount);
    let missing = Math.max(0, -day.closing);
    const consNegative = (conservative.get(day.date) ?? 0) < 0;
    const items = outs.map((o) => {
      const shortBy = Math.min(o.amount, missing);
      missing -= shortBy;
      const status: PaymentCoverage['status'] = shortBy > 0 ? 'short' : consNegative && who ? 'depends' : 'covered';
      return { key: o.key, date: day.date, label: o.label, amount: o.amount, status, shortBy, dependsOn: status === 'depends' ? who : null };
    });
    result.push(...items.sort((a, b) => a.label.localeCompare(b.label)));
  }
  return result;
}
