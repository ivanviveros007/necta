import { daysBetween, type LocalDate } from './dates';
import type {
  PaymentHistory,
  ReceivableInput,
  ReliabilityPolicy,
  ScheduledReceivable,
  UnscheduledReceivable,
} from './types';

export const DEFAULT_POLICY: ReliabilityPolicy = { minPayments: 3, minOnTimeRatio: 0.8 };

export function describeHistory(history: PaymentHistory): string {
  if (history.payments === 0) return 'sin pagos en 6 meses';
  const base = `${history.onTime} de ${history.payments} a tiempo`;
  return history.avgDaysLate && history.onTime < history.payments
    ? `${base}, en promedio ${Math.round(history.avgDaysLate)} días tarde`
    : base;
}

export function isReliable(history: PaymentHistory, policy: ReliabilityPolicy): boolean {
  if (history.payments < policy.minPayments) return false;
  return history.onTime / history.payments >= policy.minOnTimeRatio;
}

export interface ReceivableClassification {
  scheduled: ScheduledReceivable[];
  unscheduled: UnscheduledReceivable[];
}

/**
 * Regla de inclusión: pendiente > 0, vence dentro de la ventana, no está vencida
 * y la contraparte es puntual. El resto queda visible como cobro sin fecha confiable.
 */
export function classifyReceivables(
  receivables: readonly ReceivableInput[],
  today: LocalDate,
  end: LocalDate,
  policy: ReliabilityPolicy,
): ReceivableClassification {
  const scheduled: ScheduledReceivable[] = [];
  const unscheduled: UnscheduledReceivable[] = [];
  const ratioText = `${policy.minPayments} o más pagos y ${Math.round(policy.minOnTimeRatio * 100)} % o más a tiempo`;

  for (const r of receivables) {
    if (r.pendingAmount <= 0) continue;
    const history = describeHistory(r.history);
    const unscheduledBase = {
      receivableId: r.id,
      counterpartyName: r.counterpartyName,
      pendingAmount: r.pendingAmount,
      dueDate: r.dueDate,
      dueHint: r.dueHint ?? null,
      aggregated: r.aggregated ?? false,
    };
    if (r.dueDate === null) {
      unscheduled.push({
        ...unscheduledBase,
        reason: 'no_due_date',
        daysOverdue: 0,
        basis: r.dueHint ? `Sin fecha individual (${r.dueHint}); ${history}` : `Sin fecha individual; ${history}`,
      });
      continue;
    }
    if (r.dueDate < today) {
      unscheduled.push({
        ...unscheduledBase,
        reason: 'overdue',
        daysOverdue: daysBetween(r.dueDate, today),
        basis: `Venció hace ${daysBetween(r.dueDate, today)} días; ${history}`,
      });
      continue;
    }
    if (r.dueDate > end) {
      unscheduled.push({ ...unscheduledBase, reason: 'due_after_window', daysOverdue: 0, basis: `Vence después de la ventana; ${history}` });
      continue;
    }
    if (r.history.payments < policy.minPayments) {
      unscheduled.push({
        ...unscheduledBase,
        reason: 'insufficient_history',
        daysOverdue: 0,
        basis: `Historial insuficiente (${history}); se cuenta con ${ratioText}`,
      });
      continue;
    }
    if (!isReliable(r.history, policy)) {
      unscheduled.push({
        ...unscheduledBase,
        reason: 'late_payer',
        daysOverdue: 0,
        basis: `Suele pagar tarde (${history}); se cuenta con ${ratioText}`,
      });
      continue;
    }
    scheduled.push({
      receivableId: r.id,
      counterpartyName: r.counterpartyName,
      amount: r.pendingAmount,
      date: r.dueDate,
      basis: `Vence en la ventana y paga a tiempo (${history})`,
    });
  }
  return { scheduled, unscheduled };
}
