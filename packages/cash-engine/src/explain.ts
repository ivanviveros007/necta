import { formatLongDate } from './dates';
import { formatMoney, sum } from './money';
import { describeSchedule } from './schedule';
import type {
  Assumption,
  CashBaseline,
  Dependency,
  ForecastInput,
  ForecastStatus,
  ReliabilityPolicy,
  ScenarioResult,
  UnscheduledReceivable,
} from './types';

const SHORT_DAYS = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'];

/** Agrupa días consecutivos con el mismo monto: «lun–jue $ 260.000, vie–sáb $ 520.000». */
export function describeWeekly(values: readonly number[], currency: string): string {
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups: { from: number; to: number; amount: number }[] = [];
  for (const d of order) {
    const amount = values[d] ?? 0;
    const last = groups[groups.length - 1];
    if (last && last.amount === amount) last.to = d;
    else groups.push({ from: d, to: d, amount });
  }
  return groups
    .map((g) => {
      const days = g.from === g.to ? SHORT_DAYS[g.from] : `${SHORT_DAYS[g.from]}–${SHORT_DAYS[g.to]}`;
      return g.amount === 0 ? `${days} sin movimiento` : `${days} ${formatMoney(g.amount, currency)}`;
    })
    .join(', ');
}

export function buildAssumptions(
  input: ForecastInput,
  policy: ReliabilityPolicy,
  unscheduled: readonly UnscheduledReceivable[],
): Assumption[] {
  const { currency } = input;
  const list: Assumption[] = [];
  const reconstructed = input.balance.reconstructed;
  list.push({
    code: 'reference_balance',
    source: 'system',
    text:
      reconstructed !== null && reconstructed !== input.balance.stored
        ? `Partimos del saldo guardado (${formatMoney(input.balance.stored, currency)}). Con los movimientos registrados da ${formatMoney(reconstructed, currency)}: diferencia de ${formatMoney(input.balance.stored - reconstructed, currency)} sin corregir.`
        : `Partimos del saldo guardado (${formatMoney(input.balance.stored, currency)}).`,
  });

  const baseline: CashBaseline | null = input.baseline;
  if (baseline && sum(baseline.weekdaySales) > 0) {
    list.push({
      code: 'baseline_sales',
      source: 'user',
      text: `Ventas de contado habituales confirmadas por ti: ${describeWeekly(baseline.weekdaySales, currency)}.`,
    });
  } else {
    list.push({ code: 'baseline_sales_missing', source: 'user', missing: true, text: 'Carga tus ventas de contado habituales para estimar lo que entra cada día.' });
  }
  if (baseline && sum(baseline.weekdayExpenses) > 0) {
    list.push({
      code: 'baseline_expenses',
      source: 'user',
      text: `Gastos de contado habituales: ${describeWeekly(baseline.weekdayExpenses, currency)}.`,
    });
  }
  list.push({
    code: 'today_policy',
    source: 'policy',
    text:
      input.todayPolicy === 'fullDay'
        ? 'Incluye la jornada completa de hoy; lo que registres hoy reemplaza esa estimación.'
        : 'No estima lo que falta vender hoy: solo cuenta lo registrado.',
  });
  list.push({ code: 'no_payday_uplift', source: 'policy', text: 'No incluye el aumento de ventas en semanas de quincena.' });

  const recurring = input.commitments.filter((c) => c.schedule.kind === 'monthly');
  for (const c of input.commitments) {
    list.push({
      code: `commitment:${c.id}`,
      source: 'user',
      text: `${c.concept}: ${formatMoney(c.amount, currency)} ${describeSchedule(c.schedule)} (cargado por ti).`,
    });
  }
  if (recurring.length === 0) {
    list.push({ code: 'recurring_missing', source: 'user', missing: true, text: 'No cargaste pagos fijos (arriendo, sueldos, cuotas). Si los tienes, agrégalos.' });
  }

  list.push({
    code: 'reliability_rule',
    source: 'policy',
    text: `Solo contamos cobros que vencen en estos 14 días de clientas con ${policy.minPayments} o más pagos y ${Math.round(policy.minOnTimeRatio * 100)} % o más a tiempo.`,
  });
  const pending = sum(unscheduled.filter((u) => u.reason !== 'due_after_window').map((u) => u.pendingAmount));
  if (pending > 0) {
    list.push({
      code: 'unscheduled_total',
      source: 'policy',
      text: `No sumamos ${formatMoney(pending, currency)} de cobros sin fecha confiable: si entran, mejoran el resultado.`,
    });
  }
  list.push({ code: 'intraday', source: 'policy', text: 'Cada día muestra el cierre estimado; no garantiza el orden de cobros y pagos dentro del día.' });
  return list;
}

export function buildConclusion(
  status: ForecastStatus,
  expected: ScenarioResult,
  conservative: ScenarioResult,
  dependencies: readonly Dependency[],
  currency: string,
): { headline: string; detail: string } {
  const exp = expected.firstShortfall;
  const cons = conservative.firstShortfall;
  const removed = conservative.removedInflow;
  const firstDep = dependencies[0];

  if (status === 'short' && exp) {
    const headline = `Te faltan ${formatMoney(exp.amount, currency)} el ${formatLongDate(exp.date)}`;
    let detail = `Con lo esperado, ${exp.cause ? `${exp.cause.label} (${formatMoney(exp.cause.amount, currency)})` : 'las salidas'} deja la caja en ${formatMoney(-exp.amount, currency)}.`;
    if (firstDep && firstDep.affectedDate < exp.date) {
      detail += ` Antes: ${firstDep.text.charAt(0).toLowerCase()}${firstDep.text.slice(1)}`;
    } else if (cons && cons.date < exp.date && removed) {
      detail += ` Si ${removed.label.replace(/^Cobro /, '')} no paga, el faltante llega el ${formatLongDate(cons.date)}.`;
    }
    return { headline, detail };
  }
  if (status === 'depends' && cons && removed) {
    const who = removed.label.replace(/^Cobro /, '');
    return {
      headline: `Te alcanza si ${who} paga el ${formatLongDate(removed.date)}`,
      detail: `Sin ese cobro, el ${formatLongDate(cons.date)} te faltan ${formatMoney(cons.amount, currency)}${cons.cause ? ` para ${cons.cause.label}` : ''}.`,
    };
  }
  return {
    headline: 'Te alcanza para los próximos 14 días',
    detail: `El saldo más bajo sería ${formatMoney(expected.minBalance.amount, currency)} el ${formatLongDate(expected.minBalance.date)}, aun sin el cobro más grande.`,
  };
}
