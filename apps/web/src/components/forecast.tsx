import {
  formatLongDate,
  formatMoney,
  formatShortDate,
  type Assumption,
  type DayResult,
  type Dependency,
  type ForecastResult,
  type ForecastStatus,
  type RecommendedAction,
  type ScenarioResult,
  type UnscheduledReceivable,
} from '@necta/cash-engine';

type Scenario = 'expected' | 'conservative';

export function Money({ amount, currency = 'COP' }: { amount: number; currency?: string }) {
  return <span className={amount < 0 ? 'money negative' : 'money'}>{formatMoney(amount, currency)}</span>;
}

const STATUS: Record<ForecastStatus, { icon: string; label: string }> = {
  covered: { icon: '✓', label: 'Te alcanza' },
  depends: { icon: '!', label: 'Depende de un cobro' },
  short: { icon: '✕', label: 'Te falta plata' },
};

/** Estado con ícono y texto: nunca solo color. */
export function StatusBadge({ status }: { status: ForecastStatus }) {
  const s = STATUS[status];
  return (
    <span className={`badge badge-${status}`} role="status">
      <span aria-hidden="true">{s.icon}</span> {s.label}
    </span>
  );
}

export function ConclusionCard({ forecast }: { forecast: Pick<ForecastResult, 'status' | 'conclusion'> }) {
  return (
    <section className={`card conclusion conclusion-${forecast.status}`} aria-labelledby="conclusion-title">
      <StatusBadge status={forecast.status} />
      <h1 id="conclusion-title">{forecast.conclusion.headline}</h1>
      <p>{forecast.conclusion.detail}</p>
    </section>
  );
}

export function ShortfallSummary({ expected, conservative, currency }: { expected: ScenarioResult; conservative: ScenarioResult; currency: string }) {
  const row = (label: string, s: ScenarioResult) =>
    s.firstShortfall ? (
      <li>
        <strong>{label}:</strong> faltan <Money amount={s.firstShortfall.amount} currency={currency} /> el {formatLongDate(s.firstShortfall.date)}
        {s.firstShortfall.cause ? ` (${s.firstShortfall.cause.label})` : ''}
      </li>
    ) : (
      <li>
        <strong>{label}:</strong> sin faltante en 14 días
      </li>
    );
  return (
    <section className="card" aria-label="Primer faltante">
      <h2>Primer faltante</h2>
      <ul className="plain">
        {row('Esperado', expected)}
        {row(conservative.removedInflow ? `Si ${conservative.removedInflow.label.replace(/^Cobro /, '')} no paga` : 'Conservador', conservative)}
      </ul>
    </section>
  );
}

const ACTION_ICON: Record<RecommendedAction['kind'], string> = { confirm_collection: '☎', collect: '$', postpone: '⏱' };

export function PriorityAction({ action }: { action: RecommendedAction | undefined }) {
  if (!action) return null;
  return (
    <section className="card priority" aria-label="Qué hacer primero">
      <h2>
        <span aria-hidden="true">{ACTION_ICON[action.kind]} </span>Qué hacer primero
      </h2>
      <p className="action-title">{action.title}</p>
      <p>{action.detail}</p>
    </section>
  );
}

export function ActionsList({ actions }: { actions: RecommendedAction[] }) {
  if (actions.length === 0) return <p>No hay acciones pendientes.</p>;
  return (
    <ol className="actions">
      {actions.map((a) => (
        <li key={a.id}>
          <strong>{a.title}</strong>
          <p>{a.detail}</p>
        </li>
      ))}
    </ol>
  );
}

export function BalanceCard({ reference, currency }: { reference: ForecastResult['reference']; currency: string }) {
  const delta = reference.alignmentDelta ?? 0;
  return (
    <section className="card" aria-label="Saldo">
      <p className="muted">Saldo guardado (caja + banco)</p>
      <p className="big">
        <Money amount={reference.storedBalance} currency={currency} />
      </p>
      {delta !== 0 && reference.reconstructedBalance !== null && (
        <p className="warning" role="note">
          <span aria-hidden="true">⚠ </span>Con tus movimientos registrados da <Money amount={reference.reconstructedBalance} currency={currency} />: diferencia de{' '}
          <Money amount={Math.abs(delta)} currency={currency} />. No la corregimos sola; revisa tu caja.
        </p>
      )}
    </section>
  );
}

/** Gráfico compacto del cierre diario con línea de cero y marcas de pagos importantes. */
export function BalanceChart({ days, currency }: { days: DayResult[]; currency: string }) {
  const W = 320;
  const H = 120;
  const pad = 8;
  const values = days.map((d) => d.closing);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, days.length - 1);
  const y = (v: number) => pad + ((max - v) * (H - 2 * pad)) / span;
  const points = days.map((d, i) => `${x(i)},${y(d.closing)}`).join(' ');
  const big = days
    .map((d, i) => ({ d, i, out: d.outflows.filter((f) => f.kind === 'payable' || f.kind === 'commitment') }))
    .filter((e) => e.out.length > 0);
  const summary = days.map((d) => `${formatShortDate(d.date)}: ${formatMoney(d.closing, currency)}`).join('; ');
  return (
    <figure className="card chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Saldo diario. ${summary}`}>
        <line x1={pad} x2={W - pad} y1={y(0)} y2={y(0)} className="zero" />
        <polyline points={points} className="line" fill="none" />
        {days.map((d, i) => (
          <circle key={d.date} cx={x(i)} cy={y(d.closing)} r={d.isShortfall ? 4 : 2.5} className={d.isShortfall ? 'dot short' : 'dot'} />
        ))}
        {big.map(({ d, i }) => (
          <text key={`m-${d.date}`} x={x(i)} y={H - 1} textAnchor="middle" className="marker">
            ▲
          </text>
        ))}
      </svg>
      <figcaption>
        Línea gris: cero. ▲ pagos importantes:{' '}
        {big.map(({ d, out }) => `${formatShortDate(d.date)} ${out.map((o) => o.label).join(', ')}`).join(' · ') || 'ninguno'}
      </figcaption>
    </figure>
  );
}

export function ScenarioToggle({ value, onChange }: { value: Scenario; onChange: (s: Scenario) => void }) {
  return (
    <div className="toggle" role="group" aria-label="Escenario">
      <button type="button" aria-pressed={value === 'expected'} onClick={() => onChange('expected')}>
        Esperado
      </button>
      <button type="button" aria-pressed={value === 'conservative'} onClick={() => onChange('conservative')}>
        Conservador
      </button>
    </div>
  );
}

export function DayTable({ scenario, currency }: { scenario: ScenarioResult; currency: string }) {
  return (
    <table className="days">
      <caption>
        {scenario.kind === 'expected' ? 'Escenario esperado' : 'Escenario conservador'}
        {scenario.removedInflow ? ` · sin ${scenario.removedInflow.label} (${formatMoney(scenario.removedInflow.amount, currency)})` : ''}
      </caption>
      <thead>
        <tr>
          <th scope="col">Día</th>
          <th scope="col">Entra</th>
          <th scope="col">Sale</th>
          <th scope="col">Cierre</th>
        </tr>
      </thead>
      <tbody>
        {scenario.days.map((d) => (
          <tr key={d.date} className={d.isShortfall ? 'row-short' : undefined}>
            <th scope="row">
              {formatLongDate(d.date)}
              {d.intradayRisk && <span className="note"> · depende del horario del cobro</span>}
            </th>
            <td>
              <Money amount={d.totalIn} currency={currency} />
              <ul className="flows">
                {d.inflows.map((f) => (
                  <li key={f.key}>{f.label}</li>
                ))}
              </ul>
            </td>
            <td>
              <Money amount={d.totalOut} currency={currency} />
              <ul className="flows">
                {d.outflows.map((f) => (
                  <li key={f.key}>{f.label}</li>
                ))}
              </ul>
            </td>
            <td>
              <Money amount={d.closing} currency={currency} />
              {d.isShortfall && <span className="sr-only"> (faltante)</span>}
              {d.isShortfall && <span aria-hidden="true"> ✕</span>}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function AssumptionsList({ assumptions }: { assumptions: Assumption[] }) {
  return (
    <ul className="assumptions">
      {assumptions.map((a) => (
        <li key={a.code} className={a.missing ? 'missing' : undefined}>
          {a.missing && <strong>Falta: </strong>}
          {a.text}
        </li>
      ))}
    </ul>
  );
}

export function DependenciesList({ dependencies }: { dependencies: Dependency[] }) {
  if (dependencies.length === 0) return <p>Ningún pago depende de un solo cobro.</p>;
  return (
    <ul className="plain">
      {dependencies.map((d) => (
        <li key={d.receivableId}>{d.text}</li>
      ))}
    </ul>
  );
}

const REASON: Record<UnscheduledReceivable['reason'], string> = {
  overdue: 'vencido',
  late_payer: 'suele pagar tarde',
  insufficient_history: 'poco historial',
  no_due_date: 'sin fecha individual',
  due_after_window: 'vence después',
};

export function UnscheduledList({ items, currency }: { items: UnscheduledReceivable[]; currency: string }) {
  const visible = items.filter((u) => u.reason !== 'due_after_window');
  if (visible.length === 0) return <p>Todos tus cobros tienen fecha confiable.</p>;
  return (
    <ul className="plain">
      {visible.map((u) => (
        <li key={u.receivableId}>
          <strong>{u.counterpartyName}</strong>: <Money amount={u.pendingAmount} currency={currency} /> · {REASON[u.reason]}
          {u.reason === 'overdue' ? ` hace ${u.daysOverdue} días` : ''}
          {u.dueHint ? ` (${u.dueHint})` : ''}
        </li>
      ))}
    </ul>
  );
}
