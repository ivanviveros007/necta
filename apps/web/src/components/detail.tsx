import {
  formatDayShort,
  formatMoney,
  formatMoneyCompact,
  type Assumption,
  type RecommendedAction,
  type ScenarioResult,
  type UnscheduledReceivable,
} from '@necta/cash-engine';
import { Fragment, useState } from 'react';
import { SectionTitle } from './home';

const bare = (n: number) => formatMoneyCompact(n).replace('$ ', '');

export function ScenarioToggle({ value, onChange }: { value: 'expected' | 'conservative'; onChange: (s: 'expected' | 'conservative') => void }) {
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

/** Tabla de los 14 días: Día · Entra · Sale · Saldo. Una fila se despliega con sus movimientos. */
export function DayTable({ scenario }: { scenario: ScenarioResult }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <table className="days">
      <thead>
        <tr>
          <th scope="col">Día</th>
          <th scope="col">Entra</th>
          <th scope="col">Sale</th>
          <th scope="col">Saldo</th>
        </tr>
      </thead>
      <tbody>
        {scenario.days.map((d) => (
          <Fragment key={d.date}>
            <tr className={d.isShortfall ? 'row-short' : undefined}>
              <th scope="row">
                <button type="button" className="row-toggle" aria-expanded={open === d.date} onClick={() => setOpen(open === d.date ? null : d.date)}>
                  {formatDayShort(d.date)}
                  {d.intradayRisk ? <span title="Depende del horario del cobro"> ⏱</span> : null}
                </button>
              </th>
              <td className={d.totalIn ? 'pos' : 'muted'}>{d.totalIn ? `+${bare(d.totalIn)}` : '—'}</td>
              <td className={d.totalOut ? 'neg' : 'muted'}>{d.totalOut ? `−${bare(d.totalOut)}` : '—'}</td>
              <td className={d.closing < 0 ? 'neg strong' : 'strong'}>
                {formatMoneyCompact(d.closing)}
                {d.isShortfall ? <span className="sr-only"> (faltante)</span> : null}
              </td>
            </tr>
            {open === d.date ? (
              <tr className="flows-row">
                <td colSpan={4}>
                  <ul className="flows" aria-label={`Movimientos del ${formatDayShort(d.date)}`}>
                    {[...d.inflows, ...d.outflows].map((f) => (
                      <li key={f.key}>
                        <span>{f.label}</span>
                        <span className={f.direction === 'inflow' ? 'pos' : 'neg'}>
                          {f.direction === 'inflow' ? '+' : '−'}
                          {formatMoney(f.amount).replace('$ ', '')}
                        </span>
                      </li>
                    ))}
                    {d.inflows.length + d.outflows.length === 0 ? <li className="muted">Sin movimientos</li> : null}
                  </ul>
                </td>
              </tr>
            ) : null}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

const VERB: Record<RecommendedAction['kind'], { text: string; cls: string }> = {
  confirm_collection: { text: 'Confirmar', cls: 'verb-brand' },
  collect: { text: 'Cobrar', cls: 'verb-ok' },
  postpone: { text: 'Aplazar', cls: 'verb-warn' },
};

const actsOnReceivable = (a: RecommendedAction) => (a.kind === 'confirm_collection' || a.kind === 'collect') && Boolean(a.sourceId);

/** Acciones: verbo · contraparte · monto · efecto. Las de cobro abren la hoja del cobro. */
export function ActionsTable({ actions, onReceivable }: { actions: RecommendedAction[]; onReceivable?: (id: string) => void }) {
  if (actions.length === 0) return <p className="muted">Sin acciones</p>;
  return (
    <ul className="rows">
      {actions.map((a) => {
        const effect =
          a.kind === 'postpone' && a.postponeDays ? `+${a.postponeDays} d` : a.kind === 'confirm_collection' ? formatDayShort(a.riskDate).split(' ').slice(0, 2).join(' ') : a.impact.resolves ? '✓' : '—';
        const content = (
          <>
            <span className={`verb ${VERB[a.kind].cls}`}>{VERB[a.kind].text}</span>
            <span className="name">{a.target}</span>
            <span className="amount">{formatMoneyCompact(a.amount)}</span>
            <span className={`effect ${a.impact.resolves ? 'pos' : 'muted'}`}>{effect}</span>
          </>
        );
        return (
          <li key={a.id} title={a.detail}>
            {actsOnReceivable(a) && onReceivable ? (
              <button type="button" className="row-button" aria-label={a.title} onClick={() => onReceivable(a.sourceId!)}>
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
  );
}

const REASON: Record<UnscheduledReceivable['reason'], string> = {
  overdue: 'vencido',
  late_payer: 'paga tarde',
  insufficient_history: 'poco historial',
  no_due_date: 'sin fecha',
  due_after_window: 'vence después',
};

export function UnscheduledTable({ items, onReceivable }: { items: UnscheduledReceivable[]; onReceivable?: (id: string) => void }) {
  const visible = items.filter((u) => u.reason !== 'due_after_window');
  if (visible.length === 0) return <p className="muted">Ninguno</p>;
  return (
    <ul className="rows">
      {visible.map((u) => {
        const content = (
          <>
            <span className="name">{u.counterpartyName}</span>
            <span className="tag-warn">
              {REASON[u.reason]}
              {u.reason === 'overdue' ? ` ${u.daysOverdue} d` : ''}
            </span>
            <span className="amount">{formatMoneyCompact(u.pendingAmount)}</span>
          </>
        );
        return (
          <li key={u.receivableId} title={u.basis}>
            {onReceivable ? (
              <button type="button" className="row-button" aria-label={`${u.counterpartyName} ${formatMoney(u.pendingAmount)}`} onClick={() => onReceivable(u.receivableId)}>
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
  );
}

/** Supuestos plegados (details/summary nativo). */
export function AssumptionsToggle({ assumptions }: { assumptions: Assumption[] }) {
  const missing = assumptions.filter((a) => a.missing).length;
  return (
    <details className="assumptions">
      <summary>
        <SectionTitle right={missing ? `${missing} faltan` : undefined}>{`Supuestos (${assumptions.length})`}</SectionTitle>
      </summary>
      <ul>
        {assumptions.map((a) => (
          <li key={a.code} className={a.missing ? 'missing' : undefined}>
            {a.missing ? '⚠ ' : ''}
            {a.text}
          </li>
        ))}
      </ul>
    </details>
  );
}
