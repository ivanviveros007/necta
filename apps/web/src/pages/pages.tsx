import { formatMoney, describeSchedule } from '@necta/cash-engine';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { errorMessage } from '../api/client';
import {
  ActionsList,
  AssumptionsList,
  BalanceCard,
  BalanceChart,
  ConclusionCard,
  DayTable,
  DependenciesList,
  PriorityAction,
  ScenarioToggle,
  ShortfallSummary,
  UnscheduledList,
} from '../components/forecast';
import { CollectionForm, CommitmentForm, PaymentForm, SaleForm } from '../components/forms';
import { useCommitments, useForecast } from '../hooks/queries';
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
  const forecast = useForecast();
  if (!forecast.data) return <Loading error={forecast.error} />;
  const f = forecast.data;
  return (
    <>
      <ConclusionCard forecast={f} />
      <ShortfallSummary expected={f.scenarios.expected} conservative={f.scenarios.conservative} currency={store.currency} />
      <PriorityAction action={f.actions[0]} />
      <BalanceCard reference={f.reference} currency={store.currency} />
      <BalanceChart days={f.scenarios.expected.days} currency={store.currency} />
      <p>
        <Link to="/detalle">Ver día por día, supuestos y qué más puedes hacer</Link>
      </p>
      <p className="muted small">Calculado {new Date(f.computedAt).toLocaleString('es-CO')} · datos v{f.dataVersion}</p>
    </>
  );
}

export function DetailPage() {
  const { store } = useAuthenticated();
  const forecast = useForecast();
  const [scenario, setScenario] = useState<'expected' | 'conservative'>('expected');
  if (!forecast.data) return <Loading error={forecast.error} />;
  const f = forecast.data;
  return (
    <>
      <h1>Día por día</h1>
      <ScenarioToggle value={scenario} onChange={setScenario} />
      {scenario === 'conservative' && f.scenarios.conservative.removedInflow && (
        <p className="note">
          Prueba de estrés: igual al esperado pero sin {f.scenarios.conservative.removedInflow.label} ({formatMoney(f.scenarios.conservative.removedInflow.amount, store.currency)}). No es el peor caso posible.
        </p>
      )}
      <DayTable scenario={f.scenarios[scenario]} currency={store.currency} />
      <section className="card">
        <h2>Qué puedes hacer</h2>
        <ActionsList actions={f.actions} />
      </section>
      <section className="card">
        <h2>De qué depende</h2>
        <DependenciesList dependencies={f.dependencies} />
      </section>
      <section className="card">
        <h2>Cobros sin fecha confiable (no sumados)</h2>
        <UnscheduledList items={f.unscheduledReceivables} currency={store.currency} />
      </section>
      <section className="card">
        <h2>Supuestos</h2>
        <AssumptionsList assumptions={f.assumptions} />
      </section>
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
