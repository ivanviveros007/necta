import { addDays, affectsStoredBalance, formatDayShort, formatMoney, formatMoneyCompact } from '@necta/cash-engine';
import type { MovementEntity, ReceivableEntity } from '@necta/contracts';
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import { useBanks, useMutationId, useReceivables, useRecord } from '../hooks/queries';
import { useDateCaption, useStoreTimeZone } from '../session/businessDate';

/** Hoja inferior (dialog nativo). Se cierra con Esc o el botón Cerrar. */
export function Sheet({ open, onClose, label, children }: { open: boolean; onClose: () => void; label: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === 'function') d.showModal();
      else d.setAttribute('open', '');
    }
    if (!open && d.open) {
      if (typeof d.close === 'function') d.close();
      else d.removeAttribute('open');
    }
  }, [open]);
  return (
    <dialog ref={ref} className="sheet" aria-label={label} onClose={onClose}>
      {open ? children : null}
    </dialog>
  );
}

export function SheetHeader({ title, subtitle, onClose }: { title: string; subtitle?: string; onClose: () => void }) {
  return (
    <div className="sheet-header">
      <div>
        <h2>{title}</h2>
        {subtitle ? <p className="muted">{subtitle}</p> : null}
      </div>
      <button type="button" className="link" onClick={onClose}>
        Cerrar
      </button>
    </div>
  );
}

/** Monto grande editable. */
export function AmountInput({ value, onChange, sign, tone }: { value: number; onChange: (n: number) => void; sign: string; tone: 'pos' | 'neg' }) {
  const text = value > 0 ? formatMoney(value).replace('$ ', '') : '';
  return (
    <div className="amount-input">
      <span className={tone}>{sign} $</span>
      <input
        aria-label="Monto (COP)"
        inputMode="numeric"
        autoComplete="off"
        placeholder="0"
        value={text}
        // El ancho sigue a los dígitos: el monto nunca queda cortado.
        style={{ width: `calc(${Math.max(text.length, 1) + 1}ch + 8px)` }}
        onChange={(e) => onChange(Number(e.target.value.replace(/\D/g, '')) || 0)}
      />
    </div>
  );
}

export function BankChips({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const banks = useBanks().data ?? [];
  if (banks.length < 2) return null;
  return (
    <div className="toggle" role="group" aria-label="Bolsillo">
      {banks.map((b) => (
        <button key={b.id} type="button" aria-pressed={value === b.id} onClick={() => onChange(b.id)}>
          {b.name}
        </button>
      ))}
    </div>
  );
}

/**
 * Fecha de un movimiento ya hecho: Hoy por defecto, Ayer u Otra (calendario hasta hoy).
 * Nunca futura. Si es anterior al saldo guardado, avisa que completa el historial.
 */
export function DateField({ value, onChange, businessDate, caption }: { value: string; onChange: (d: string) => void; businessDate: string; caption: string }) {
  const yesterday = addDays(businessDate, -1);
  const [other, setOther] = useState(value !== businessDate && value !== yesterday);
  const banks = useBanks().data ?? [];
  const asOf = banks.map((b) => b.balanceAsOf).filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;
  const timeZone = useStoreTimeZone();
  const historical = asOf ? !affectsStoredBalance(value, asOf, timeZone) : false;
  return (
    <div className="date-field">
      <div className="toggle" role="group" aria-label="Fecha">
        <button type="button" aria-pressed={!other && value === businessDate} onClick={() => { setOther(false); onChange(businessDate); }}>
          Hoy
        </button>
        <button type="button" aria-pressed={!other && value === yesterday} onClick={() => { setOther(false); onChange(yesterday); }}>
          Ayer
        </button>
        <button type="button" aria-pressed={other} onClick={() => setOther(true)}>
          Otra
        </button>
      </div>
      {other ? (
        <input aria-label="Otra fecha" type="date" max={businessDate} value={value} onChange={(e) => e.target.value && e.target.value <= businessDate && onChange(e.target.value)} />
      ) : null}
      <p className="muted center">{value === businessDate ? caption : formatDayShort(value)}</p>
      {historical ? <p className="note center">Anterior al saldo guardado: completa el historial, no cambia el saldo.</p> : null}
    </div>
  );
}

/** Registrar el cobro de una deuda: monto precargado con lo pendiente, editable para pagos parciales. */
export function CollectPanel({ receivable, businessDate, online, onDone }: { receivable: ReceivableEntity; businessDate: string; online: boolean; onDone: () => void }) {
  const dateCaption = useDateCaption(businessDate);
  const [amount, setAmount] = useState(receivable.pendingAmount);
  const [bankId, setBankId] = useState('bank_caja');
  const [date, setDate] = useState(businessDate);
  const [mutationId, renew] = useMutationId();
  const mutation = useRecord(() => api.collect(receivable.id, { clientMutationId: mutationId, bankId, amount, paymentDate: date, method: 'efectivo' }));
  const tooMuch = amount > receivable.pendingAmount;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate(undefined, {
      onSuccess: () => {
        renew();
        onDone();
      },
    });
  };
  return (
    <form onSubmit={submit} aria-label="Registrar cobro">
      <AmountInput value={amount} onChange={setAmount} sign="+" tone="pos" />
      <p className="muted center">Pendiente {formatMoney(receivable.pendingAmount)}</p>
      <DateField value={date} onChange={setDate} businessDate={businessDate} caption={dateCaption} />
      <BankChips value={bankId} onChange={setBankId} />
      {tooMuch ? <p className="warning">Mayor al pendiente</p> : null}
      {!online ? <p className="warning" role="alert">Sin conexión: no se puede guardar.</p> : null}
      {mutation.error ? <p className="error" role="alert">{errorMessage(mutation.error)}</p> : null}
      <button type="submit" className="primary" disabled={!online || amount <= 0 || tooMuch || mutation.isPending}>
        {amount <= 0 ? 'Escribe el monto' : amount === receivable.pendingAmount ? `Ya pagó · Registrar ${formatMoneyCompact(amount)}` : `Pagó una parte · Registrar ${formatMoneyCompact(amount)}`}
      </button>
    </form>
  );
}

/** La clienta paga otro día: elegir la nueva fecha (próximos 14 días). */
export function ReschedulePanel({ receivable, businessDate, online, onDone }: { receivable: ReceivableEntity; businessDate: string; online: boolean; onDone: () => void }) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(businessDate, i + 1));
  const [date, setDate] = useState<string | null>(null);
  const [mutationId, renew] = useMutationId();
  const mutation = useRecord(() => api.reschedule(receivable.id, { clientMutationId: mutationId, baseVersion: receivable.version, newDueDate: date! }));
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!date) return;
    mutation.mutate(undefined, {
      onSuccess: () => {
        renew();
        onDone();
      },
    });
  };
  return (
    <form onSubmit={submit} aria-label="Nueva fecha de cobro">
      <p className="muted">Vence {receivable.creditDueBy ? formatDayShort(receivable.creditDueBy) : 'sin fecha'} · nueva fecha:</p>
      <div className="day-chips" role="radiogroup" aria-label="Nueva fecha">
        {days.map((d) => (
          <button key={d} type="button" role="radio" aria-checked={d === date} aria-label={formatDayShort(d)} onClick={() => setDate(d)}>
            <small>{formatDayShort(d).split(' ')[0]}</small>
            <strong>{d.slice(8)}</strong>
          </button>
        ))}
      </div>
      {!online ? <p className="warning" role="alert">Sin conexión: no se puede guardar.</p> : null}
      {mutation.error ? <p className="error" role="alert">{errorMessage(mutation.error)}</p> : null}
      <button type="submit" className="primary" disabled={!online || !date || mutation.isPending}>
        {date ? `Mover a ${formatDayShort(date)}` : 'Elige una fecha'}
      </button>
    </form>
  );
}

/** Hoja de un cobro: «Ya pagó» como acción principal y «Paga otro día» como alternativa. */
export function ReceivableSheet({ receivableId, businessDate, online, onClose }: { receivableId: string | null; businessDate: string; online: boolean; onClose: () => void }) {
  const receivables = useReceivables();
  const receivable = receivableId ? receivables.data?.find((r) => r.id === receivableId) : undefined;
  const [mode, setMode] = useState<'collect' | 'reschedule'>('collect');
  useEffect(() => setMode('collect'), [receivableId]);
  return (
    <Sheet open={Boolean(receivableId)} onClose={onClose} label="Cobro">
      {receivable ? (
        <>
          <SheetHeader
            title={receivable.counterpartyName}
            subtitle={`Debe ${formatMoney(receivable.pendingAmount)} · vence ${receivable.creditDueBy ? formatDayShort(receivable.creditDueBy) : 'sin fecha'}`}
            onClose={onClose}
          />
          {mode === 'collect' ? (
            <>
              <CollectPanel receivable={receivable} businessDate={businessDate} online={online} onDone={onClose} />
              <button type="button" className="secondary" onClick={() => setMode('reschedule')}>
                Paga otro día
              </button>
            </>
          ) : (
            <>
              <ReschedulePanel receivable={receivable} businessDate={businessDate} online={online} onDone={onClose} />
              <button type="button" className="link" onClick={() => setMode('collect')}>
                ‹ Volver a registrar cobro
              </button>
            </>
          )}
        </>
      ) : receivableId ? (
        <p role="status">Cargando…</p>
      ) : null}
    </Sheet>
  );
}

/** Elegir a quién se le cobra (botón + → Cobro). */
export function ReceivablePicker({ onPick }: { onPick: (r: ReceivableEntity) => void }) {
  const receivables = useReceivables();
  const open = [...(receivables.data ?? [])].sort((a, b) => ((a.creditDueBy ?? '9') < (b.creditDueBy ?? '9') ? -1 : 1));
  return (
    <ul className="rows" aria-label="Quién te debe">
      {open.map((r) => (
        <li key={r.id}>
          <button type="button" className="row-button" onClick={() => onPick(r)}>
            <span className="name">{r.counterpartyName}</span>
            <span className="date">{r.creditDueBy ? formatDayShort(r.creditDueBy) : 'sin fecha'}</span>
            <span className="amount">{formatMoneyCompact(r.pendingAmount)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Corregir o borrar un ingreso/gasto (versión conocida; si cambió en otro lado, conflicto visible). */
export function MovementEditSheet({ movement, businessDate, online, onClose }: { movement: MovementEntity | null; businessDate: string; online: boolean; onClose: () => void }) {
  return (
    <Sheet open={Boolean(movement)} onClose={onClose} label="Editar movimiento">
      {movement ? <MovementEditForm key={movement.id} movement={movement} businessDate={businessDate} online={online} onClose={onClose} /> : null}
    </Sheet>
  );
}

function MovementEditForm({ movement, businessDate, online, onClose }: { movement: MovementEntity; businessDate: string; online: boolean; onClose: () => void }) {
  const caption = useDateCaption(businessDate);
  const [amount, setAmount] = useState(movement.amount);
  const [description, setDescription] = useState(movement.description);
  const [date, setDate] = useState(movement.date);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [saveId, renewSave] = useMutationId();
  const [deleteId, renewDelete] = useMutationId();
  const changes = {
    ...(amount !== movement.amount ? { amount } : {}),
    ...(description !== movement.description ? { description } : {}),
    ...(date !== movement.date ? { date } : {}),
  };
  const save = useRecord(() => api.updateMovement(movement.id, { clientMutationId: saveId, baseVersion: movement.version, changes }));
  const remove = useRecord(() => api.deleteMovement(movement.id, { clientMutationId: deleteId, baseVersion: movement.version }));
  const error = save.error ?? remove.error;
  return (
    <>
      <SheetHeader title={movement.kind === 'income' ? 'Ingreso' : 'Gasto'} onClose={onClose} />
      <form
        aria-label="Editar movimiento"
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(undefined, { onSuccess: () => { renewSave(); onClose(); } });
        }}
      >
        <AmountInput value={amount} onChange={setAmount} sign={movement.kind === 'income' ? '+' : '−'} tone={movement.kind === 'income' ? 'pos' : 'neg'} />
        <DateField value={date} onChange={setDate} businessDate={businessDate} caption={caption} />
        <label className="field">
          <span>Descripción</span>
          <input aria-label="Descripción" value={description} onChange={(e) => setDescription(e.target.value)} />
        </label>
        {!online ? <p className="warning" role="alert">Sin conexión: no se puede guardar.</p> : null}
        {error ? <p className="error" role="alert">{errorMessage(error)}</p> : null}
        <button type="submit" className="primary" disabled={!online || Object.keys(changes).length === 0 || amount <= 0 || save.isPending}>
          Guardar cambios
        </button>
      </form>
      <button
        type="button"
        className="secondary danger"
        disabled={!online || remove.isPending}
        onClick={() => (confirmDelete ? remove.mutate(undefined, { onSuccess: () => { renewDelete(); onClose(); } }) : setConfirmDelete(true))}
      >
        {confirmDelete ? `Sí, eliminar ${formatMoneyCompact(movement.amount)}` : 'Eliminar'}
      </button>
    </>
  );
}
