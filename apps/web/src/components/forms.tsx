import { formatMoney } from '@necta/cash-engine';
import { useId, type FormEvent, type ReactNode } from 'react';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useDraft } from '../hooks/useDraft';
import { useBanks, useCounterparties, useMutationId, usePayables, useReceivables, useRecord } from '../hooks/queries';

/** «45.000» → 45000. Solo dígitos: montos enteros en COP. */
export function parseAmount(text: string): number {
  const digits = text.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

export function Field({ label, children, hint }: { label: string; children: (id: string) => ReactNode; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {children(id)}
      {hint && <small>{hint}</small>}
    </div>
  );
}

function AmountField({ value, onChange, label = 'Monto (COP)' }: { value: string; onChange: (v: string) => void; label?: string }) {
  return (
    <Field label={label} hint={parseAmount(value) > 0 ? formatMoney(parseAmount(value)) : undefined}>
      {(id) => <input id={id} inputMode="numeric" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />}
    </Field>
  );
}

function BankField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const banks = useBanks();
  return (
    <Field label="Bolsillo">
      {(id) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
          {(banks.data ?? []).map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

function SubmitBar({ online, pending, label, error, success }: { online: boolean; pending: boolean; label: string; error: unknown; success: string | null }) {
  return (
    <div className="submit">
      {!online && (
        <p className="warning" role="alert">
          Sin conexión: no se puede guardar. Lo que escribiste se conserva.
        </p>
      )}
      {error ? (
        <p className="error" role="alert">
          {errorMessage(error)}
        </p>
      ) : null}
      {success && (
        <p className="success" role="status">
          {success}
        </p>
      )}
      <button type="submit" className="primary" disabled={!online || pending}>
        {pending ? 'Guardando…' : label}
      </button>
    </div>
  );
}

interface FormProps {
  online: boolean;
  businessDate: string;
  onDone?: () => void;
}

// ---------- Ingreso / gasto ----------

export function MovementForm({ online, businessDate, onDone, onIsCollection }: FormProps & { onIsCollection?: () => void }) {
  const init = () => ({ kind: 'expense' as 'income' | 'expense', amount: '', bankId: 'bank_caja', description: '', date: businessDate });
  const [form, setForm, clear] = useDraft('movement', init);
  const [mutationId, renew] = useMutationId();
  const mutation = useRecord(() =>
    api.createMovement(mutationId, {
      id: `mv_${mutationId}`,
      kind: form.kind,
      amount: parseAmount(form.amount),
      bankId: form.bankId,
      date: form.date,
      description: form.description,
    }),
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (parseAmount(form.amount) <= 0) return;
    mutation.mutate(undefined, {
      onSuccess: () => {
        clear();
        renew();
        onDone?.();
      },
    });
  };

  return (
    <form onSubmit={submit} aria-label="Ingreso o gasto">
      <div className="toggle" role="group" aria-label="Tipo">
        <button type="button" aria-pressed={form.kind === 'income'} onClick={() => setForm((f) => ({ ...f, kind: 'income' }))}>
          Ingreso
        </button>
        <button type="button" aria-pressed={form.kind === 'expense'} onClick={() => setForm((f) => ({ ...f, kind: 'expense' }))}>
          Gasto
        </button>
      </div>
      {form.kind === 'income' && onIsCollection && (
        <p>
          ¿Es el pago de una clienta que te debía?{' '}
          <button type="button" className="link" onClick={onIsCollection}>
            Regístralo como cobro
          </button>
          , así no se cuenta dos veces.
        </p>
      )}
      <AmountField value={form.amount} onChange={(amount) => setForm((f) => ({ ...f, amount }))} />
      <BankField value={form.bankId} onChange={(bankId) => setForm((f) => ({ ...f, bankId }))} />
      <Field label="Descripción">{(id) => <input id={id} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />}</Field>
      <Field label="Fecha" hint="Un movimiento ya hecho no puede tener fecha futura.">
        {(id) => <input id={id} type="date" max={businessDate} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />}
      </Field>
      <SubmitBar online={online} pending={mutation.isPending} label="Guardar" error={mutation.error} success={mutation.isSuccess ? 'Guardado.' : null} />
    </form>
  );
}

// ---------- Cobro / pago de una deuda ----------

function DebtPaymentForm({ online, businessDate, onDone, kind }: FormProps & { kind: 'collect' | 'pay' }) {
  const receivables = useReceivables();
  const payables = usePayables();
  const debts = kind === 'collect' ? (receivables.data ?? []) : (payables.data ?? []);
  const init = () => ({ debtId: '', amount: '', bankId: 'bank_caja', method: 'efectivo', date: businessDate });
  const [form, setForm, clear] = useDraft(`debt-${kind}`, init);
  const [mutationId, renew] = useMutationId();
  const selected = debts.find((d) => d.id === form.debtId);
  const mutation = useRecord(() => {
    const body = { clientMutationId: mutationId, bankId: form.bankId, amount: parseAmount(form.amount), paymentDate: form.date, method: form.method };
    return kind === 'collect' ? api.collect(form.debtId, body) : api.pay(form.debtId, body);
  });

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.debtId || parseAmount(form.amount) <= 0) return;
    mutation.mutate(undefined, {
      onSuccess: () => {
        clear();
        renew();
        onDone?.();
      },
    });
  };

  return (
    <form onSubmit={submit} aria-label={kind === 'collect' ? 'Cobro' : 'Pago'}>
      <Field label={kind === 'collect' ? '¿Quién te pagó?' : '¿A quién le pagaste?'}>
        {(id) => (
          <select id={id} value={form.debtId} onChange={(e) => setForm((f) => ({ ...f, debtId: e.target.value }))}>
            <option value="">Elige una cuenta</option>
            {debts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.counterpartyName} · debe {formatMoney(d.pendingAmount)}
              </option>
            ))}
          </select>
        )}
      </Field>
      {selected && (
        <p className="muted">
          Pendiente: {formatMoney(selected.pendingAmount)}
          {selected.creditDueBy ? ` · vence ${selected.creditDueBy}` : ''}
        </p>
      )}
      <AmountField value={form.amount} onChange={(amount) => setForm((f) => ({ ...f, amount }))} />
      <BankField value={form.bankId} onChange={(bankId) => setForm((f) => ({ ...f, bankId }))} />
      <Field label="Fecha">
        {(id) => <input id={id} type="date" max={businessDate} value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />}
      </Field>
      <SubmitBar
        online={online}
        pending={mutation.isPending}
        label={kind === 'collect' ? 'Guardar cobro' : 'Guardar pago'}
        error={mutation.error}
        success={mutation.isSuccess ? 'Guardado.' : null}
      />
    </form>
  );
}

export const CollectionForm = (p: FormProps) => <DebtPaymentForm {...p} kind="collect" />;
export const PaymentForm = (p: FormProps) => <DebtPaymentForm {...p} kind="pay" />;

// ---------- Venta ----------

export function SaleForm({ online, businessDate, onDone }: FormProps) {
  const counterparties = useCounterparties();
  const customers = (counterparties.data ?? []).filter((c) => c.kind === 'customer' && !c.aggregated);
  const init = () => ({ customerId: '', amount: '', paid: true, bankId: 'bank_caja', expiresAt: '' });
  const [form, setForm, clear] = useDraft('sale', init);
  const [mutationId, renew] = useMutationId();
  const mutation = useRecord(() =>
    api.createSale(mutationId, {
      id: `sale_${mutationId}`,
      customerId: form.customerId,
      amount: parseAmount(form.amount),
      paid: form.paid,
      bankId: form.bankId,
      saleDate: businessDate,
      expiresAt: form.expiresAt || null,
    }),
  );
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!form.customerId || parseAmount(form.amount) <= 0) return;
    mutation.mutate(undefined, {
      onSuccess: () => {
        clear();
        renew();
        onDone?.();
      },
    });
  };
  return (
    <form onSubmit={submit} aria-label="Venta">
      <Field label="Clienta">
        {(id) => (
          <select id={id} value={form.customerId} onChange={(e) => setForm((f) => ({ ...f, customerId: e.target.value }))}>
            <option value="">Elige una clienta</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
      </Field>
      <AmountField value={form.amount} onChange={(amount) => setForm((f) => ({ ...f, amount }))} />
      <div className="toggle" role="group" aria-label="Forma de pago">
        <button type="button" aria-pressed={form.paid} onClick={() => setForm((f) => ({ ...f, paid: true }))}>
          De contado
        </button>
        <button type="button" aria-pressed={!form.paid} onClick={() => setForm((f) => ({ ...f, paid: false }))}>
          A crédito
        </button>
      </div>
      {form.paid ? (
        <BankField value={form.bankId} onChange={(bankId) => setForm((f) => ({ ...f, bankId }))} />
      ) : (
        <Field label="Vence" hint="Si lo dejas vacío, vence a los 30 días.">
          {(id) => <input id={id} type="date" min={businessDate} value={form.expiresAt} onChange={(e) => setForm((f) => ({ ...f, expiresAt: e.target.value }))} />}
        </Field>
      )}
      <SubmitBar online={online} pending={mutation.isPending} label="Guardar venta" error={mutation.error} success={mutation.isSuccess ? 'Venta guardada.' : null} />
    </form>
  );
}

// ---------- Compromiso futuro o recurrente ----------

export function CommitmentForm({ online, businessDate, onDone }: FormProps) {
  const init = () => ({ concept: '', amount: '', recurring: true, days: '1', date: businessDate, negotiable: false, direction: 'outflow' as 'outflow' | 'inflow' });
  const [form, setForm, clear] = useDraft('commitment', init);
  const [mutationId, renew] = useMutationId();
  const days = form.days
    .split(/[,\s]+/)
    .map(Number)
    .filter((d) => Number.isInteger(d) && d >= 1 && d <= 31);
  const mutation = useRecord(() =>
    api.createCommitment(mutationId, {
      id: `cmt_${mutationId}`,
      direction: form.direction,
      concept: form.concept.trim(),
      amount: parseAmount(form.amount),
      negotiable: form.negotiable,
      schedule: form.recurring ? { kind: 'monthly', daysOfMonth: days, startDate: businessDate } : { kind: 'once', date: form.date },
    }),
  );
  const invalid = !form.concept.trim() || parseAmount(form.amount) <= 0 || (form.recurring && days.length === 0);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (invalid) return;
    mutation.mutate(undefined, {
      onSuccess: () => {
        clear();
        renew();
        onDone?.();
      },
    });
  };
  return (
    <form onSubmit={submit} aria-label="Compromiso">
      <Field label="Concepto">{(id) => <input id={id} value={form.concept} placeholder="Arriendo, sueldos, cuota…" onChange={(e) => setForm((f) => ({ ...f, concept: e.target.value }))} />}</Field>
      <AmountField value={form.amount} onChange={(amount) => setForm((f) => ({ ...f, amount }))} />
      <div className="toggle" role="group" aria-label="Frecuencia">
        <button type="button" aria-pressed={form.recurring} onClick={() => setForm((f) => ({ ...f, recurring: true }))}>
          Cada mes
        </button>
        <button type="button" aria-pressed={!form.recurring} onClick={() => setForm((f) => ({ ...f, recurring: false }))}>
          Una vez
        </button>
      </div>
      {form.recurring ? (
        <Field label="Días del mes" hint="Por ejemplo: 15, 30">
          {(id) => <input id={id} inputMode="numeric" value={form.days} onChange={(e) => setForm((f) => ({ ...f, days: e.target.value }))} />}
        </Field>
      ) : (
        <Field label="Fecha">{(id) => <input id={id} type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />}</Field>
      )}
      <label className="check">
        <input type="checkbox" checked={form.negotiable} onChange={(e) => setForm((f) => ({ ...f, negotiable: e.target.checked }))} /> Se puede pedir plazo
      </label>
      <SubmitBar online={online} pending={mutation.isPending} label="Guardar compromiso" error={mutation.error} success={mutation.isSuccess ? 'Compromiso guardado.' : null} />
    </form>
  );
}
