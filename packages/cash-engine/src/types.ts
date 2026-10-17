import type { LocalDate } from './dates';

export type Schedule =
  | { kind: 'once'; date: LocalDate }
  | { kind: 'monthly'; daysOfMonth: number[]; startDate: LocalDate; endDate?: LocalDate | null };

export interface PaymentHistory {
  /** Pagos observados en los últimos 6 meses. */
  payments: number;
  /** Pagos hechos en o antes del vencimiento. */
  onTime: number;
  /** Promedio de días de atraso de los pagos tardíos (null si no hubo). */
  avgDaysLate: number | null;
}

export interface ReceivableInput {
  id: string;
  counterpartyId: string | null;
  counterpartyName: string;
  pendingAmount: number;
  /** null cuando el saldo no tiene una fecha individual confiable (p. ej. un grupo agregado). */
  dueDate: LocalDate | null;
  dueHint?: string | null;
  /** Saldo agregado de varias contrapartes: no se recomienda como cobro puntual. */
  aggregated?: boolean;
  history: PaymentHistory;
}

export interface PayableInput {
  id: string;
  counterpartyName: string;
  pendingAmount: number;
  dueDate: LocalDate | null;
  negotiable: boolean;
}

export interface CommitmentInput {
  id: string;
  direction: 'inflow' | 'outflow';
  concept: string;
  amount: number;
  schedule: Schedule;
  negotiable: boolean;
}

export interface CashBaseline {
  /** Índice 0 = domingo … 6 = sábado. */
  weekdaySales: number[];
  weekdayExpenses: number[];
}

export interface ReliabilityPolicy {
  minPayments: number;
  minOnTimeRatio: number;
}

export type TodayPolicy = 'fullDay' | 'none';

export interface ForecastInput {
  currency: string;
  timeZone: string;
  /** Fecha de negocio (primer día de la ventana). */
  today: LocalDate;
  horizonDays?: number;
  /**
   * fullDay: corte al inicio del día; incluye la jornada completa de hoy y lo registrado hoy consume la base.
   * none: operación normal; hoy no se estima venta ni gasto restante.
   */
  todayPolicy: TodayPolicy;
  balance: {
    stored: number;
    reconstructed: number | null;
    asOf: string | null;
  };
  /** Lo ya registrado hoy (incluido en el saldo) para no contar dos veces la base. */
  realizedToday: { cashSales: number; cashExpenses: number };
  receivables: ReceivableInput[];
  payables: PayableInput[];
  commitments: CommitmentInput[];
  baseline: CashBaseline | null;
  policy?: Partial<ReliabilityPolicy>;
}

export type FlowKind = 'baseline_sales' | 'baseline_expenses' | 'receivable' | 'payable' | 'commitment';

export interface Flow {
  /** Identificador estable del flujo (fuente + fecha original). */
  key: string;
  kind: FlowKind;
  direction: 'inflow' | 'outflow';
  label: string;
  amount: number;
  date: LocalDate;
  sourceId: string | null;
  negotiable: boolean;
  /** Regla y datos usados para incluirlo. */
  basis: string | null;
}

export interface DayResult {
  date: LocalDate;
  opening: number;
  inflows: Flow[];
  outflows: Flow[];
  totalIn: number;
  totalOut: number;
  closing: number;
  isShortfall: boolean;
  /** Cierre no negativo solo gracias a un cobro del mismo día cuyo horario se desconoce. */
  intradayRisk: boolean;
}

export interface Shortfall {
  date: LocalDate;
  amount: number;
  cause: { label: string; amount: number } | null;
}

export interface ScenarioResult {
  kind: 'expected' | 'conservative';
  days: DayResult[];
  firstShortfall: Shortfall | null;
  minBalance: { date: LocalDate; amount: number };
  endBalance: number;
  removedInflow: { sourceId: string | null; label: string; amount: number; date: LocalDate } | null;
}

export type UnscheduledReason = 'no_due_date' | 'overdue' | 'late_payer' | 'insufficient_history' | 'due_after_window';

export interface ScheduledReceivable {
  receivableId: string;
  counterpartyName: string;
  amount: number;
  date: LocalDate;
  basis: string;
}

export interface UnscheduledReceivable {
  receivableId: string;
  counterpartyName: string;
  pendingAmount: number;
  reason: UnscheduledReason;
  daysOverdue: number;
  dueDate: LocalDate | null;
  dueHint: string | null;
  aggregated: boolean;
  basis: string;
}

export type ActionKind = 'confirm_collection' | 'collect' | 'postpone';

export interface ActionImpact {
  scenario: 'expected' | 'conservative';
  resolves: boolean;
  firstShortfall: Shortfall | null;
  minBalance: number;
}

export interface RecommendedAction {
  id: string;
  kind: ActionKind;
  /** Contraparte o pago sobre el que se actúa (para etiquetas cortas). */
  target: string;
  title: string;
  detail: string;
  /** Fecha del riesgo que mitiga; ordena las acciones. */
  riskDate: LocalDate;
  sourceId: string | null;
  amount: number;
  /** Para aplazamientos: días mínimos de plazo que evitan el faltante, null si no alcanza dentro de la ventana. */
  postponeDays?: number | null;
  impact: ActionImpact;
}

export interface Dependency {
  receivableId: string;
  label: string;
  amount: number;
  date: LocalDate;
  affectedDate: LocalDate;
  affectedCause: string | null;
  shortfallWithout: number;
  text: string;
}

export interface Assumption {
  code: string;
  text: string;
  source: 'user' | 'policy' | 'system';
  missing?: boolean;
}

export type ForecastStatus = 'covered' | 'depends' | 'short';

export interface ForecastResult {
  currency: string;
  window: { start: LocalDate; end: LocalDate; timeZone: string; days: number };
  todayPolicy: TodayPolicy;
  reference: {
    storedBalance: number;
    reconstructedBalance: number | null;
    alignmentDelta: number | null;
    asOf: string | null;
  };
  status: ForecastStatus;
  conclusion: { headline: string; detail: string };
  scenarios: { expected: ScenarioResult; conservative: ScenarioResult };
  scheduledReceivables: ScheduledReceivable[];
  unscheduledReceivables: UnscheduledReceivable[];
  actions: RecommendedAction[];
  dependencies: Dependency[];
  assumptions: Assumption[];
}
