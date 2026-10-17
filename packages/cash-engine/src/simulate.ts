import { addDays, dateRange, type LocalDate } from './dates';
import { sum } from './money';
import { occurrencesBetween } from './schedule';
import type { DayResult, Flow, ForecastInput, ScenarioResult, ScheduledReceivable } from './types';

export interface Window {
  start: LocalDate;
  end: LocalDate;
  dates: LocalDate[];
}

export function buildWindow(today: LocalDate, horizonDays = 14): Window {
  const dates = dateRange(today, horizonDays);
  return { start: today, end: dates[dates.length - 1]!, dates };
}

/** Flujos base del escenario esperado (sin aplicar escenario conservador ni acciones). */
export function buildFlows(input: ForecastInput, window: Window, scheduled: readonly ScheduledReceivable[]): Flow[] {
  const flows: Flow[] = [];

  if (input.baseline) {
    for (const date of window.dates) {
      const wd = new Date(`${date}T00:00:00Z`).getUTCDay();
      let sales = input.baseline.weekdaySales[wd] ?? 0;
      let expenses = input.baseline.weekdayExpenses[wd] ?? 0;
      if (date === input.today) {
        if (input.todayPolicy === 'none') {
          sales = 0;
          expenses = 0;
        } else {
          // Lo registrado hoy ya está en el saldo: consume la base para no contar dos veces.
          sales = Math.max(0, sales - input.realizedToday.cashSales);
          expenses = Math.max(0, expenses - input.realizedToday.cashExpenses);
        }
      }
      if (sales > 0) {
        flows.push({
          key: `baseline_sales:${date}`,
          kind: 'baseline_sales',
          direction: 'inflow',
          label: 'Ventas de contado habituales',
          amount: sales,
          date,
          sourceId: null,
          negotiable: false,
          basis: 'Base semanal confirmada por la dueña',
        });
      }
      if (expenses > 0) {
        flows.push({
          key: `baseline_expenses:${date}`,
          kind: 'baseline_expenses',
          direction: 'outflow',
          label: 'Gastos de contado habituales',
          amount: expenses,
          date,
          sourceId: null,
          negotiable: false,
          basis: 'Base semanal confirmada por la dueña',
        });
      }
    }
  }

  for (const r of scheduled) {
    flows.push({
      key: `receivable:${r.receivableId}`,
      kind: 'receivable',
      direction: 'inflow',
      label: `Cobro ${r.counterpartyName}`,
      amount: r.amount,
      date: r.date,
      sourceId: r.receivableId,
      negotiable: false,
      basis: r.basis,
    });
  }

  for (const p of input.payables) {
    if (p.pendingAmount <= 0 || p.dueDate === null || p.dueDate > window.end) continue;
    // Una cuenta por pagar vencida se considera exigible hoy.
    const date = p.dueDate < window.start ? window.start : p.dueDate;
    flows.push({
      key: `payable:${p.id}`,
      kind: 'payable',
      direction: 'outflow',
      label: p.counterpartyName,
      amount: p.pendingAmount,
      date,
      sourceId: p.id,
      negotiable: p.negotiable,
      basis: p.dueDate < window.start ? 'Cuenta por pagar vencida: exigible hoy' : 'Cuenta por pagar registrada',
    });
  }

  for (const c of input.commitments) {
    if (c.amount <= 0) continue;
    for (const date of occurrencesBetween(c.schedule, window.start, window.end)) {
      flows.push({
        key: `commitment:${c.id}:${date}`,
        kind: 'commitment',
        direction: c.direction,
        label: c.concept,
        amount: c.amount,
        date,
        sourceId: c.id,
        negotiable: c.negotiable,
        basis: 'Compromiso cargado por la dueña',
      });
    }
  }

  return flows;
}

/** Aplica flujos día a día desde un saldo de apertura. */
export function runScenario(
  kind: ScenarioResult['kind'],
  opening: number,
  flows: readonly Flow[],
  window: Window,
  removedInflow: ScenarioResult['removedInflow'] = null,
): ScenarioResult {
  const byDate = new Map<LocalDate, Flow[]>();
  for (const f of flows) {
    if (f.date < window.start || f.date > window.end) continue;
    const list = byDate.get(f.date) ?? [];
    list.push(f);
    byDate.set(f.date, list);
  }

  const days: DayResult[] = [];
  let balance = opening;
  for (const date of window.dates) {
    const list = byDate.get(date) ?? [];
    const inflows = list.filter((f) => f.direction === 'inflow');
    const outflows = list.filter((f) => f.direction === 'outflow');
    const totalIn = sum(inflows.map((f) => f.amount));
    const totalOut = sum(outflows.map((f) => f.amount));
    const closing = balance + totalIn - totalOut;
    const collections = sum(inflows.filter((f) => f.kind === 'receivable').map((f) => f.amount));
    const baselineNet =
      sum(inflows.filter((f) => f.kind === 'baseline_sales').map((f) => f.amount)) -
      sum(outflows.filter((f) => f.kind === 'baseline_expenses').map((f) => f.amount));
    const committedOut = sum(outflows.filter((f) => f.kind !== 'baseline_expenses').map((f) => f.amount));
    const intradayRisk = collections > 0 && committedOut > 0 && closing >= 0 && balance + baselineNet < committedOut;
    days.push({
      date,
      opening: balance,
      inflows,
      outflows,
      totalIn,
      totalOut,
      closing,
      isShortfall: closing < 0,
      intradayRisk,
    });
    balance = closing;
  }

  const firstDay = days.find((d) => d.isShortfall);
  const firstShortfall = firstDay
    ? {
        date: firstDay.date,
        amount: -firstDay.closing,
        cause: biggestOutflow(firstDay),
      }
    : null;
  const min = days.reduce((acc, d) => (d.closing < acc.closing ? d : acc), days[0]!);

  return {
    kind,
    days,
    firstShortfall,
    minBalance: { date: min.date, amount: min.closing },
    endBalance: days[days.length - 1]!.closing,
    removedInflow,
  };
}

function biggestOutflow(day: DayResult): { label: string; amount: number } | null {
  const candidates = day.outflows.filter((f) => f.kind !== 'baseline_expenses');
  const pool = candidates.length > 0 ? candidates : day.outflows;
  if (pool.length === 0) return null;
  const top = pool.reduce((a, b) => (b.amount > a.amount ? b : a));
  return { label: top.label, amount: top.amount };
}

export function moveFlow(flows: readonly Flow[], key: string, days: number): Flow[] {
  return flows.map((f) => (f.key === key ? { ...f, date: addDays(f.date, days) } : f));
}

export function withoutFlow(flows: readonly Flow[], key: string): Flow[] {
  return flows.filter((f) => f.key !== key);
}
