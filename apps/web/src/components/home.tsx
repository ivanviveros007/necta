import {
  formatDayShort,
  formatMoney,
  formatMoneyCompact,
  type DayResult,
  type HomeSummary,
  type PaymentCoverage,
  type TodayActivity,
  type TodayItem,
} from '@necta/cash-engine';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';

const bare = (n: number) => formatMoneyCompact(n).replace('$ ', '');
const dayShort = (date: string) => formatDayShort(date).split(' ').slice(0, 2).join(' ');

export function SectionTitle({ children, right }: { children: string; right?: ReactNode }) {
  return (
    <div className="section-title">
      <h2>{children}</h2>
      {right ? <span>{right}</span> : null}
    </div>
  );
}

/** Saldo actual y mínimo proyectado: las dos cifras que responden «¿me alcanza?». */
export function BalanceHeader({ summary }: { summary: Pick<HomeSummary, 'balanceToday' | 'balanceDelta' | 'minBalance'> }) {
  const [showDelta, setShowDelta] = useState(false);
  const negative = summary.minBalance.amount < 0;
  return (
    <section aria-label="Saldo">
      <div className="kpi-label">
        Saldo
        {summary.balanceDelta ? (
          <button type="button" className="icon-button" aria-label="Diferencia con lo registrado" aria-expanded={showDelta} onClick={() => setShowDelta((v) => !v)}>
            ⓘ
          </button>
        ) : null}
      </div>
      <p className="balance">{formatMoney(summary.balanceToday)}</p>
      {showDelta && summary.balanceDelta ? (
        <p className="delta" role="note">
          Registrado {formatMoney(summary.balanceToday - summary.balanceDelta)} · dif. {formatMoney(summary.balanceDelta)}
        </p>
      ) : null}
      <span className={`pill ${negative ? 'pill-bad' : 'pill-ok'}`}>
        <span aria-hidden="true">{negative ? '▼' : '▲'}</span> Mínimo 14 d {formatMoneyCompact(summary.minBalance.amount)} · {formatDayShort(summary.minBalance.date)}
      </span>
    </section>
  );
}

export function SectionLink({ title, to, link }: { title: string; to: string; link: string }) {
  return <SectionTitle right={<Link to={to}>{link} ›</Link>}>{title}</SectionTitle>;
}

/** Saldo al cierre por día; al pasar o tocar un punto, tooltip con cifras del día. */
export function CashChart({ days }: { days: DayResult[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const W = 640;
  const H = 200;
  const pad = 14;
  const values = days.map((d) => d.closing);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (W - 2 * pad)) / Math.max(1, days.length - 1);
  const y = (v: number) => pad + ((max - v) * (H - 2 * pad)) / span;
  const day = selected !== null ? days[selected] : undefined;
  return (
    <figure className="chart">
      <div className="chart-box">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Saldo de los próximos días. Mínimo ${formatMoney(Math.min(...values))}.`} preserveAspectRatio="none">
          {min < 0 ? <rect x={0} y={y(0)} width={W} height={H - y(0)} className="neg-zone" /> : null}
          <line x1={0} x2={W} y1={y(0)} y2={y(0)} className="zero" />
          <polyline points={days.map((d, i) => `${x(i)},${y(d.closing)}`).join(' ')} className="line" fill="none" />
          {selected !== null ? <line x1={x(selected)} x2={x(selected)} y1={0} y2={H} className="cursor" /> : null}
          {days.map((d, i) => (
            <circle key={d.date} cx={x(i)} cy={y(d.closing)} r={i === selected ? 7 : d.isShortfall ? 5 : 3.5} className={d.isShortfall ? 'dot short' : 'dot'} />
          ))}
        </svg>
        <div className="chart-hit" onMouseLeave={() => setSelected(null)}>
          {days.map((d, i) => (
            <button
              key={d.date}
              type="button"
              aria-label={`${formatDayShort(d.date)} saldo ${formatMoney(d.closing)}`}
              aria-pressed={i === selected}
              onMouseEnter={() => setSelected(i)}
              onFocus={() => setSelected(i)}
              onClick={() => setSelected(i)}
            />
          ))}
        </div>
        {day ? (
          <div className="tooltip" role="status" style={{ left: `clamp(0px, calc(${(x(selected!) / W) * 100}% - 90px), calc(100% - 180px))` }}>
            <strong>{formatDayShort(day.date)}</strong>
            <dl>
              <dt>Saldo</dt>
              <dd className={day.closing < 0 ? 'neg' : 'pos'}>{formatMoney(day.closing)}</dd>
              <dt>Entra</dt>
              <dd>+{bare(day.totalIn)}</dd>
              <dt>Sale</dt>
              <dd>−{bare(day.totalOut)}</dd>
            </dl>
          </div>
        ) : null}
      </div>
      <figcaption>
        <span>{days[0] ? formatDayShort(days[0].date) : ''}</span>
        <span>
          <span className="swatch brand" aria-hidden="true">●</span> saldo <span className="swatch bad" aria-hidden="true">●</span> negativo - - $ 0
        </span>
        <span>{days.length ? formatDayShort(days[days.length - 1]!.date) : ''}</span>
      </figcaption>
    </figure>
  );
}

export function KpiRow({ totals }: { totals: HomeSummary['totals'] }) {
  const tile = (title: string, value: number, tone?: string) => (
    <div className="kpi" aria-label={`${title} ${formatMoney(value)}`}>
      <span className="kpi-label">{title}</span>
      <strong className={tone}>{formatMoneyCompact(value)}</strong>
    </div>
  );
  return (
    <div className="kpis">
      {tile('Entra', totals.inflow, 'pos')}
      {tile('Sale', totals.outflow, 'neg')}
      {tile('Sin fecha', totals.unscheduled)}
    </div>
  );
}

const VERB: Record<string, string> = { confirm_collection: 'Confirmar cobro', collect: 'Cobrar', postpone: 'Aplazar' };

export function ActionChip({ action, onPress }: { action: HomeSummary['primaryAction']; onPress: () => void }) {
  if (!action) return null;
  return (
    <button type="button" className="action-chip" aria-label={`Acción sugerida: ${action.title}`} onClick={onPress}>
      <span className="tag">Sugerido</span>
      <span className="grow">
        {VERB[action.kind] ?? 'Acción'} · {action.target}
      </span>
      <span aria-hidden="true">›</span>
    </button>
  );
}

const STATUS = { covered: { icon: '✓', cls: 'ok' }, depends: { icon: '!', cls: 'warn' }, short: { icon: '✕', cls: 'bad' } } as const;

function StatusPill({ p }: { p: PaymentCoverage }) {
  const s = STATUS[p.status];
  const text = p.status === 'short' ? `−${bare(p.shortBy)}` : p.status === 'depends' ? 'depende' : 'ok';
  return (
    <span className={`pill pill-${s.cls}`}>
      <span aria-hidden="true">{s.icon}</span> {text}
    </span>
  );
}

/** Pagos de la ventana con su estado: ✓ cubierto · ! depende de un cobro · ✕ faltante. */
export function PaymentsTable({ payments, covered }: { payments: PaymentCoverage[]; covered: number }) {
  return (
    <section>
      <SectionTitle right={payments.length ? `${covered}/${payments.length} cubiertos` : undefined}>Pagos</SectionTitle>
      {payments.length === 0 ? <p className="muted">Sin pagos cargados</p> : null}
      <ul className="rows">
        {payments.map((p) => (
          <li key={p.key} aria-label={`${formatDayShort(p.date)} ${p.label} ${formatMoney(p.amount)} ${p.status === 'short' ? `faltan ${formatMoney(p.shortBy)}` : p.status === 'depends' ? `depende de ${p.dependsOn}` : 'cubierto'}`}>
            <span className="date">{dayShort(p.date)}</span>
            <span className="name">{p.label}</span>
            <span className="amount">{formatMoneyCompact(p.amount)}</span>
            <StatusPill p={p} />
          </li>
        ))}
      </ul>
    </section>
  );
}

export function CollectionsTable({ items, onPress }: { items: HomeSummary['upcoming']; onPress?: (receivableId: string) => void }) {
  const incoming = items.filter((i) => i.amount > 0);
  return (
    <section>
      <SectionTitle>Cobros</SectionTitle>
      {incoming.length === 0 ? <p className="muted">Sin cobros con fecha</p> : null}
      <ul className="rows">
        {incoming.map((i) => {
          const content = (
            <>
              <span className="date">{dayShort(i.date)}</span>
              <span className="name">{i.label.replace(/^Cobro /, '')}</span>
              <span className="amount pos">+{bare(i.amount)}</span>
            </>
          );
          return (
            <li key={i.key}>
              {onPress && i.kind === 'receivable' && i.sourceId ? (
                <button type="button" className="row-button" aria-label={`${formatDayShort(i.date)} ${i.label} ${formatMoney(i.amount)}`} onClick={() => onPress(i.sourceId!)}>
                  {content}
                  <span aria-hidden="true">›</span>
                </button>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function Progress({ title, done, expected, tone }: { title: string; done: number; expected: number; tone: string }) {
  const ratio = expected > 0 ? Math.min(1, done / expected) : done > 0 ? 1 : 0;
  return (
    <div className="progress">
      <div className="progress-head">
        <span className="kpi-label">{title}</span>
        <span>
          {bare(done)}/{bare(expected)}
        </span>
      </div>
      <div className="bar" role="progressbar" aria-label={title} aria-valuenow={Math.round(ratio * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className={tone} style={{ width: `${ratio * 100}%` }} />
      </div>
    </div>
  );
}

/** Lo registrado hoy y avance contra lo habitual del día. */
export function TodaySection({ activity, onEdit }: { activity: TodayActivity; onEdit?: (item: TodayItem) => void }) {
  return (
    <section>
      <SectionTitle>Hoy</SectionTitle>
      <div className="progress-row">
        <Progress title="Ventas" done={activity.sales.done} expected={activity.sales.expected} tone="fill-ok" />
        <Progress title="Gastos" done={activity.expenses.done} expected={activity.expenses.expected} tone="fill-bad" />
      </div>
      {activity.items.length === 0 ? <p className="muted">Sin registros hoy</p> : null}
      <ul className="rows">
        {activity.items.map((i) => {
          const content = (
            <>
              <span className="date" aria-label={i.state === 'confirmed' ? 'confirmado' : i.state === 'pending' ? 'pendiente' : 'con problema'}>
                {i.state === 'confirmed' ? '✓' : i.state === 'pending' ? '⏳' : '✕'}
              </span>
              <span className="name">{i.label}</span>
              {i.amount !== 0 ? <span className={`amount ${i.amount > 0 ? 'pos' : 'neg'}`}>{i.amount > 0 ? '+' : '−'}{bare(Math.abs(i.amount))}</span> : null}
            </>
          );
          return (
            <li key={i.key}>
              {onEdit && i.movementId ? (
                <button type="button" className="row-button" aria-label={`Editar ${i.label} ${formatMoney(i.amount)}`} onClick={() => onEdit(i)}>
                  {content}
                  <span aria-hidden="true">›</span>
                </button>
              ) : (
                content
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
