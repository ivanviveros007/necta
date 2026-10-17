import { addDays, daysBetween, formatLongDate } from './dates';
import { formatMoney } from './money';
import { moveFlow, runScenario, withoutFlow, type Window } from './simulate';
import type {
  ActionKind,
  Dependency,
  Flow,
  RecommendedAction,
  ScenarioResult,
  UnscheduledReceivable,
} from './types';

interface Context {
  opening: number;
  window: Window;
  currency: string;
}

const KIND_ORDER: Record<ActionKind, number> = { confirm_collection: 0, collect: 1, postpone: 2 };

/** Cobros programados cuya ausencia crea o adelanta un faltante. */
export function computeDependencies(ctx: Context, flows: readonly Flow[], expected: ScenarioResult): Dependency[] {
  const deps: Dependency[] = [];
  for (const flow of flows) {
    if (flow.kind !== 'receivable') continue;
    const without = runScenario('expected', ctx.opening, withoutFlow(flows, flow.key), ctx.window);
    const s = without.firstShortfall;
    if (!s) continue;
    const base = expected.firstShortfall;
    if (base && s.date >= base.date) continue;
    const cause = s.cause?.label ?? null;
    deps.push({
      receivableId: flow.sourceId ?? flow.key,
      label: flow.label.replace(/^Cobro /, ''),
      amount: flow.amount,
      date: flow.date,
      affectedDate: s.date,
      affectedCause: cause,
      shortfallWithout: s.amount,
      text:
        `El ${formatLongDate(s.date)}, ${cause ? `para pagar «${cause}»` : 'para no quedar en negativo'} dependes de que ` +
        `${flow.label.replace(/^Cobro /, '')} pague ${formatMoney(flow.amount, ctx.currency)} el ${formatLongDate(flow.date)}.`,
    });
  }
  return deps.sort((a, b) => (a.affectedDate < b.affectedDate ? -1 : a.affectedDate > b.affectedDate ? 1 : b.amount - a.amount));
}

function impactOf(scenario: ScenarioResult['kind'], result: ScenarioResult): RecommendedAction['impact'] {
  return {
    scenario,
    resolves: result.firstShortfall === null,
    firstShortfall: result.firstShortfall,
    minBalance: result.minBalance.amount,
  };
}

function collectActions(
  ctx: Context,
  target: ScenarioResult,
  targetFlows: readonly Flow[],
  unscheduled: readonly UnscheduledReceivable[],
): RecommendedAction[] {
  const shortfall = target.firstShortfall;
  if (!shortfall) return [];
  const collectBy = shortfall.date > ctx.window.start ? addDays(shortfall.date, -1) : ctx.window.start;
  const candidates = unscheduled.filter(
    (u) => !u.aggregated && u.pendingAmount > 0 && u.reason !== 'due_after_window' && u.reason !== 'no_due_date',
  );
  const scored = candidates.map((u) => {
    const extra: Flow = {
      key: `collect:${u.receivableId}`,
      kind: 'receivable',
      direction: 'inflow',
      label: `Cobro ${u.counterpartyName}`,
      amount: u.pendingAmount,
      date: collectBy,
      sourceId: u.receivableId,
      negotiable: false,
      basis: 'Simulación: cobrado antes del faltante',
    };
    const result = runScenario(target.kind, ctx.opening, [...targetFlows, extra], ctx.window);
    const owed = formatMoney(u.pendingAmount, ctx.currency);
    const why =
      u.reason === 'overdue'
        ? `Te debe ${owed} desde hace ${u.daysOverdue} días.`
        : u.reason === 'late_payer'
          ? `Te debe ${owed}${u.dueDate ? ` (vence el ${formatLongDate(u.dueDate)})` : ''} y suele pagar tarde.`
          : `Te debe ${owed} y no hay historial suficiente para contar con ese cobro.`;
    const effect = result.firstShortfall
      ? result.firstShortfall.date === shortfall.date
        ? `Si te paga antes del ${formatLongDate(shortfall.date)}, el faltante baja a ${formatMoney(result.firstShortfall.amount, ctx.currency)}.`
        : `Si te paga antes del ${formatLongDate(shortfall.date)}, el primer faltante pasa al ${formatLongDate(result.firstShortfall.date)}.`
      : `Si te paga antes del ${formatLongDate(shortfall.date)}, cubres el faltante.`;
    const action: RecommendedAction = {
      id: `collect:${u.receivableId}`,
      kind: 'collect',
      target: u.counterpartyName,
      title: `Cóbrale a ${u.counterpartyName}`,
      detail: `${why} ${effect}`,
      riskDate: shortfall.date,
      sourceId: u.receivableId,
      amount: u.pendingAmount,
      impact: impactOf(target.kind, result),
    };
    return { action, overdue: u.daysOverdue };
  });
  scored.sort(
    (a, b) =>
      Number(b.action.impact.resolves) - Number(a.action.impact.resolves) ||
      b.overdue - a.overdue ||
      b.action.amount - a.action.amount,
  );
  return scored.map((s) => s.action);
}

function postponeActions(ctx: Context, target: ScenarioResult, targetFlows: readonly Flow[]): RecommendedAction[] {
  const shortfall = target.firstShortfall;
  if (!shortfall) return [];
  const candidates = targetFlows.filter(
    (f) =>
      f.direction === 'outflow' &&
      f.negotiable &&
      (f.kind === 'payable' || f.kind === 'commitment') &&
      f.date <= shortfall.date,
  );
  const actions = candidates.map((flow) => {
    const maxDays = daysBetween(flow.date, ctx.window.end) + 1;
    let found: number | null = null;
    let result = runScenario(target.kind, ctx.opening, moveFlow(targetFlows, flow.key, maxDays), ctx.window);
    for (let k = 1; k <= maxDays; k++) {
      const attempt = runScenario(target.kind, ctx.opening, moveFlow(targetFlows, flow.key, k), ctx.window);
      if (!attempt.firstShortfall) {
        found = k;
        result = attempt;
        break;
      }
    }
    const newDate = found ? addDays(flow.date, found) : null;
    const detail =
      found && newDate && newDate <= ctx.window.end
        ? `Si lo pagas ${found} ${found === 1 ? 'día' : 'días'} después (el ${formatLongDate(newDate)}), evitas el faltante del ${formatLongDate(shortfall.date)}.`
        : found
          ? `Tendrías que pagarlo después del ${formatLongDate(ctx.window.end)} para evitar el faltante del ${formatLongDate(shortfall.date)}.`
          : `Aun aplazándolo después del ${formatLongDate(ctx.window.end)}, faltarían ${formatMoney(result.firstShortfall?.amount ?? 0, ctx.currency)} el ${formatLongDate(result.firstShortfall?.date ?? shortfall.date)}.`;
    const action: RecommendedAction = {
      id: `postpone:${flow.key}`,
      kind: 'postpone',
      target: flow.label,
      title: `Pide plazo para ${flow.label} (${formatMoney(flow.amount, ctx.currency)}, ${formatLongDate(flow.date)})`,
      detail,
      riskDate: shortfall.date,
      sourceId: flow.sourceId,
      amount: flow.amount,
      postponeDays: found,
      impact: impactOf(target.kind, result),
    };
    return action;
  });
  actions.sort(
    (a, b) =>
      Number(b.impact.resolves) - Number(a.impact.resolves) ||
      (a.postponeDays ?? Infinity) - (b.postponeDays ?? Infinity) ||
      b.amount - a.amount,
  );
  return actions;
}

export interface ActionInputs {
  expected: ScenarioResult;
  conservative: ScenarioResult;
  expectedFlows: readonly Flow[];
  conservativeFlows: readonly Flow[];
  dependencies: readonly Dependency[];
  unscheduled: readonly UnscheduledReceivable[];
}

/**
 * Acciones con impacto simulado, ordenadas por la fecha del riesgo que mitigan.
 * A igual fecha: confirmar → cobrar → aplazar. Nunca contacta a terceros.
 */
export function computeActions(ctx: Context, inputs: ActionInputs): RecommendedAction[] {
  const { expected, conservative, expectedFlows, conservativeFlows, dependencies, unscheduled } = inputs;
  const actions: RecommendedAction[] = [];

  for (const dep of dependencies) {
    const without = runScenario(
      'expected',
      ctx.opening,
      withoutFlow(expectedFlows, `receivable:${dep.receivableId}`),
      ctx.window,
    );
    const remedy = [
      ...collectActions(ctx, without, withoutFlow(expectedFlows, `receivable:${dep.receivableId}`), unscheduled),
      ...postponeActions(ctx, without, withoutFlow(expectedFlows, `receivable:${dep.receivableId}`)),
    ].find((a) => a.impact.firstShortfall === null || a.impact.firstShortfall.date > dep.affectedDate);
    const fallback = remedy ? ` Si no te lo confirma: ${remedy.title.charAt(0).toLowerCase()}${remedy.title.slice(1)}.` : '';
    actions.push({
      id: `confirm_collection:${dep.receivableId}`,
      kind: 'confirm_collection',
      target: dep.label,
      title: `Confirma el pago de ${dep.label}`,
      detail:
        `Te debe ${formatMoney(dep.amount, ctx.currency)} para el ${formatLongDate(dep.date)}. ` +
        `Si no paga, el ${formatLongDate(dep.affectedDate)} te faltan ${formatMoney(dep.shortfallWithout, ctx.currency)}` +
        `${dep.affectedCause ? ` para ${dep.affectedCause}` : ''}.${fallback}`,
      riskDate: dep.affectedDate,
      sourceId: dep.receivableId,
      amount: dep.amount,
      impact: impactOf('expected', expected),
    });
  }

  const [target, targetFlows] = expected.firstShortfall
    ? [expected, expectedFlows]
    : conservative.firstShortfall
      ? [conservative, conservativeFlows]
      : [null, null];
  if (target && targetFlows) {
    actions.push(...collectActions(ctx, target, targetFlows, unscheduled));
    actions.push(...postponeActions(ctx, target, targetFlows));
  }

  return actions
    .map((a, index) => ({ a, index }))
    .sort(
      (x, y) =>
        (x.a.riskDate < y.a.riskDate ? -1 : x.a.riskDate > y.a.riskDate ? 1 : 0) ||
        KIND_ORDER[x.a.kind] - KIND_ORDER[y.a.kind] ||
        x.index - y.index,
    )
    .map((x) => x.a);
}

