import { describeSchedule, formatMoney, formatMoneyCompact, summarizeForecast, todayActivity } from '@necta/cash-engine';
import { useMemo, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { errorMessage } from '../api/client';
import { MovementEditSheet, ReceivableSheet } from '../components/collect';
import { ActionsTable, AssumptionsToggle, DayTable, ScenarioToggle, UnscheduledTable } from '../components/detail';
import { ActionChip, BalanceHeader, CashChart, CollectionsTable, KpiRow, PaymentsTable, SectionLink, SectionTitle, TodaySection } from '../components/home';
import { CollectionForm, CommitmentForm, PaymentForm, SaleForm } from '../components/forms';
import { useCommitments, useForecast, useTodayData } from '../hooks/queries';
import { useOnline } from '../hooks/useOnline';
import { useAuthenticated, useSession } from '../session/SessionProvider';

function Loading({ error }: { error: unknown }) {
  if (error) return <p className="error" role="alert">{errorMessage(error)}</p>;
  return <p role="status">Calculando tu caja…</p>;
}

export function LoginPage() {
  const { login, session } = useSession();
  const online = useOnline();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [pending, setPending] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setPending(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(err);
    } finally {
      setPending(false);
    }
  };

  return (
    <main className="login">
      <h1>Necta</h1>
      <p>Caja a 14 días</p>
      {session.status === 'anonymous' && session.expired && <p className="warning">Tu sesión venció. Vuelve a ingresar.</p>}
      <form onSubmit={submit} aria-label="Ingresar">
        <label htmlFor="email">Email</label>
        <input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <label htmlFor="password">Contraseña</label>
        <input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        {error ? <p className="error" role="alert">{(error as { status?: number }).status === 401 ? 'Email o contraseña incorrectos.' : errorMessage(error)}</p> : null}
        {!online && <p className="warning">Necesitas conexión para ingresar.</p>}
        <button type="submit" className="primary" disabled={pending || !online}>
          {pending ? 'Ingresando…' : 'Ingresar'}
        </button>
      </form>
    </main>
  );
}

export function HomePage() {
  const { store } = useAuthenticated();
  const online = useOnline();
  const forecast = useForecast();
  const today = useTodayData(store.businessDate);
  const [receivableId, setReceivableId] = useState<string | null>(null);
  const [movementId, setMovementId] = useState<string | null>(null);
  const editing = movementId ? (today.data?.movements.find((m) => m.id === movementId) ?? null) : null;
  const summary = useMemo(() => (forecast.data ? summarizeForecast(forecast.data, 30) : null), [forecast.data]);
  const activity = useMemo(() => (today.data ? todayActivity({ businessDate: store.businessDate, ...today.data }) : null), [today.data, store.businessDate]);
  if (!forecast.data || !summary) return <Loading error={forecast.error} />;
  const f = forecast.data;
  return (
    <>
      <BalanceHeader summary={summary} />
      <SectionLink title="Próximos 14 días" to="/detalle" link="Día por día" />
      <CashChart days={f.scenarios.expected.days} />
      <KpiRow totals={summary.totals} />
      <ActionChip
        action={summary.primaryAction}
        onPress={() => {
          const a = summary.primaryAction;
          if (a && (a.kind === 'confirm_collection' || a.kind === 'collect') && a.sourceId) setReceivableId(a.sourceId);
        }}
      />
      <PaymentsTable payments={summary.payments} covered={summary.coveredCount} />
      <CollectionsTable items={summary.upcoming} onPress={setReceivableId} />
      {activity ? <TodaySection activity={activity} onEdit={(item) => setMovementId(item.movementId ?? null)} /> : null}
      <MovementEditSheet movement={editing} businessDate={store.businessDate} online={online} onClose={() => setMovementId(null)} />
      <ReceivableSheet receivableId={receivableId} businessDate={store.businessDate} online={online} onClose={() => setReceivableId(null)} />
    </>
  );
}

export function DetailPage() {
  const { store } = useAuthenticated();
  const online = useOnline();
  const forecast = useForecast();
  const [scenario, setScenario] = useState<'expected' | 'conservative'>('expected');
  const [receivableId, setReceivableId] = useState<string | null>(null);
  if (!forecast.data) return <Loading error={forecast.error} />;
  const f = forecast.data;
  const removed = f.scenarios.conservative.removedInflow;
  return (
    <>
      <h1>Día por día</h1>
      <ScenarioToggle value={scenario} onChange={setScenario} />
      {scenario === 'conservative' && removed ? (
        <span className="pill pill-bad">
          Sin {removed.label.replace(/^Cobro /, '')} (−{formatMoneyCompact(removed.amount).replace('$ ', '')})
        </span>
      ) : null}
      <DayTable scenario={f.scenarios[scenario]} />
      <SectionTitle>Acciones</SectionTitle>
      <ActionsTable actions={f.actions} onReceivable={setReceivableId} />
      <SectionTitle>Por cobrar sin fecha (no suma)</SectionTitle>
      <UnscheduledTable items={f.unscheduledReceivables} onReceivable={setReceivableId} />
      <AssumptionsToggle assumptions={f.assumptions} />
      <ReceivableSheet receivableId={receivableId} businessDate={store.businessDate} online={online} onClose={() => setReceivableId(null)} />
    </>
  );
}

const RECORD_TABS = [
  { id: 'venta', label: 'Venta' },
  { id: 'cobro', label: 'Cobro' },
  { id: 'pago', label: 'Pago' },
  { id: 'compromiso', label: 'Pago fijo o futuro' },
] as const;

export function RecordPage() {
  const { store } = useAuthenticated();
  const online = useOnline();
  const navigate = useNavigate();
  const { tipo = 'venta' } = useParams();
  const props = { online, businessDate: store.businessDate };
  return (
    <>
      <h1>Registrar</h1>
      <div className="tabs" role="tablist" aria-label="Qué registrar">
        {RECORD_TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tipo === t.id} onClick={() => navigate(`/registrar/${t.id}`)}>
            {t.label}
          </button>
        ))}
      </div>
      <section className="card" role="tabpanel">
        {tipo === 'venta' && <SaleForm {...props} />}
        {tipo === 'cobro' && <CollectionForm {...props} />}
        {tipo === 'pago' && <PaymentForm {...props} />}
        {tipo === 'compromiso' && <CommitmentForm {...props} />}
      </section>
    </>
  );
}

export function CommitmentsPage() {
  const { store } = useAuthenticated();
  const commitments = useCommitments();
  return (
    <>
      <h1>Pagos fijos y futuros</h1>
      <p>Necta no los conoce si no los cargas. Entran en la proyección en sus fechas.</p>
      {commitments.data ? (
        <ul className="plain">
          {commitments.data.map((c) => (
            <li key={c.id}>
              <strong>{c.concept}</strong>: {formatMoney(c.amount, store.currency)} {describeSchedule(c.schedule)}
              {c.negotiable ? ' · se puede pedir plazo' : ''}
            </li>
          ))}
        </ul>
      ) : (
        <Loading error={commitments.error} />
      )}
      <p>
        <Link to="/registrar/compromiso">Agregar un pago fijo o futuro</Link>
      </p>
    </>
  );
}
