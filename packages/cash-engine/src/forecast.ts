import { computeActions, computeDependencies } from './actions';
import { buildAssumptions, buildConclusion } from './explain';
import { classifyReceivables, DEFAULT_POLICY } from './receivables';
import { buildFlows, buildWindow, runScenario, withoutFlow } from './simulate';
import type { ForecastInput, ForecastResult, ForecastStatus, ReliabilityPolicy } from './types';

export const DEFAULT_HORIZON_DAYS = 14;

/**
 * Proyección de caja a 14 días. Función pura: misma entrada → mismo resultado,
 * sin red, base de datos ni reloj.
 */
export function computeForecast(input: ForecastInput): ForecastResult {
  const policy: ReliabilityPolicy = { ...DEFAULT_POLICY, ...input.policy };
  const window = buildWindow(input.today, input.horizonDays ?? DEFAULT_HORIZON_DAYS);
  const opening = input.balance.stored;
  const ctx = { opening, window, currency: input.currency };

  const { scheduled, unscheduled } = classifyReceivables(input.receivables, window.start, window.end, policy);
  const expectedFlows = buildFlows(input, window, scheduled);
  const expected = runScenario('expected', opening, expectedFlows, window);

  // Conservador: el esperado sin el cobro programado de mayor monto (prueba de estrés explícita).
  const largest = [...scheduled].sort((a, b) => b.amount - a.amount || (a.date < b.date ? -1 : 1))[0];
  const conservativeFlows = largest ? withoutFlow(expectedFlows, `receivable:${largest.receivableId}`) : expectedFlows;
  const conservative = runScenario(
    'conservative',
    opening,
    conservativeFlows,
    window,
    largest
      ? { sourceId: largest.receivableId, label: `Cobro ${largest.counterpartyName}`, amount: largest.amount, date: largest.date }
      : null,
  );

  const status: ForecastStatus = expected.firstShortfall ? 'short' : conservative.firstShortfall ? 'depends' : 'covered';
  const dependencies = computeDependencies(ctx, expectedFlows, expected);
  const actions = computeActions(ctx, {
    expected,
    conservative,
    expectedFlows,
    conservativeFlows,
    dependencies,
    unscheduled,
  });

  const reconstructed = input.balance.reconstructed;
  return {
    currency: input.currency,
    window: { start: window.start, end: window.end, timeZone: input.timeZone, days: window.dates.length },
    todayPolicy: input.todayPolicy,
    reference: {
      storedBalance: input.balance.stored,
      reconstructedBalance: reconstructed,
      alignmentDelta: reconstructed === null ? null : input.balance.stored - reconstructed,
      asOf: input.balance.asOf,
    },
    status,
    conclusion: buildConclusion(status, expected, conservative, dependencies, input.currency),
    scenarios: { expected, conservative },
    scheduledReceivables: scheduled,
    unscheduledReceivables: unscheduled,
    actions,
    dependencies,
    assumptions: buildAssumptions(input, policy, unscheduled),
  };
}
