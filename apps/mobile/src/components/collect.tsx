import { addDays, affectsStoredBalance, formatDayShort, formatMoney, formatMoneyCompact, type SnapshotReceivable, type StoreSnapshot, type TodayItem } from '@necta/cash-engine';
import DateTimePicker from '@expo/ui/community/datetime-picker';
import { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { debtPayment, receivableReschedule, type Draft } from '../domain/operations';
import type { TodayActivity } from '@necta/cash-engine';
import { Button, colors, Notice, Segmented } from './ui';

const num = { fontVariant: ['tabular-nums' as const] };

interface Ctx {
  snapshot: StoreSnapshot;
  businessDate: string;
  /** «Hoy · …» o «Fecha del caso · …». */
  dateCaption?: string;
  newId: () => string;
  onSubmit: (draft: Draft) => Promise<void>;
  creatorOf?: (entityId: string) => Promise<string | null>;
  onDone?: () => void;
}

/** Monto grande editable (cobro total o parcial). */
export function AmountInput({ value, onChange, sign, tone }: { value: number; onChange: (n: number) => void; sign: string; tone: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginVertical: 12 }}>
      <Text style={{ fontSize: 36, fontWeight: '800', color: tone }}>{sign} $</Text>
      <TextInput
        accessibilityLabel="Monto (COP)"
        keyboardType="number-pad"
        placeholder="0"
        placeholderTextColor="#9A9A9A"
        value={value > 0 ? formatMoney(value).replace('$ ', '') : ''}
        onChangeText={(t) => onChange(Number(t.replace(/\D/g, '')) || 0)}
        style={{ fontSize: 40, fontWeight: '800', color: colors.ink, minWidth: 140, paddingHorizontal: 6, ...num }}
      />
    </View>
  );
}

const toDate = (d: string) => {
  const [y, m, day] = d.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, day, 12);
};
const fromDate = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Fecha de un movimiento ya hecho: Hoy por defecto, Ayer u Otra (selector nativo de Expo UI hasta hoy).
 * Nunca futura. Si es anterior al saldo guardado, avisa que completa el historial.
 */
export function DateField({ value, onChange, snapshot, businessDate, caption }: { value: string; onChange: (d: string) => void; snapshot: StoreSnapshot; businessDate: string; caption?: string }) {
  const yesterday = addDays(businessDate, -1);
  const [other, setOther] = useState(value !== businessDate && value !== yesterday);
  const mode = other ? 'other' : value === yesterday ? 'yesterday' : 'today';
  const asOf = snapshot.banks.map((b) => b.balanceAsOf).filter((v): v is string => Boolean(v)).sort().at(-1) ?? null;
  const historical = asOf ? !affectsStoredBalance(value, asOf, snapshot.timeZone) : false;
  return (
    <View>
      <Segmented
        label="Fecha"
        value={mode}
        onChange={(m) => {
          if (m === 'today') onChange(businessDate);
          if (m === 'yesterday') onChange(yesterday);
          setOther(m === 'other');
        }}
        options={[
          { value: 'today', label: 'Hoy' },
          { value: 'yesterday', label: 'Ayer' },
          { value: 'other', label: 'Otra' },
        ]}
      />
      {other ? (
        <View style={{ alignItems: 'center', marginVertical: 4 }}>
          <DateTimePicker
            testID="date-picker"
            value={toDate(value)}
            maximumDate={toDate(businessDate)}
            mode="date"
            display="compact"
            locale="es-CO"
            accentColor={colors.brand}
            onValueChange={(_, d) => {
              const next = fromDate(d);
              if (next <= businessDate) onChange(next);
            }}
          />
        </View>
      ) : null}
      <Text style={{ textAlign: 'center', fontSize: 15, color: colors.muted }}>{value === businessDate ? caption ?? `Hoy · ${formatDayShort(value)}` : formatDayShort(value)}</Text>
      {historical ? <Text style={{ textAlign: 'center', fontSize: 14, color: colors.warn, marginTop: 2 }}>Anterior al saldo guardado: completa el historial, no cambia el saldo.</Text> : null}
    </View>
  );
}

function BankChips({ snapshot, value, onChange }: { snapshot: StoreSnapshot; value: string; onChange: (id: string) => void }) {
  const banks = snapshot.banks.filter((b) => !b.deletedAt);
  if (banks.length < 2) return null;
  return <Segmented label="Bolsillo" value={value} onChange={onChange} options={banks.map((b) => ({ value: b.id, label: b.name }))} />;
}

/** Registrar el cobro de una deuda: monto precargado con lo pendiente, editable para pagos parciales. */
export function CollectPanel({ receivable, ctx }: { receivable: SnapshotReceivable; ctx: Ctx }) {
  const [amount, setAmount] = useState(receivable.pendingAmount);
  const [bankId, setBankId] = useState(ctx.snapshot.banks[0]?.id ?? '');
  const [date, setDate] = useState(ctx.businessDate);
  const [error, setError] = useState<string | null>(null);
  const tooMuch = amount > receivable.pendingAmount;
  const save = async () => {
    setError(null);
    try {
      const dep = ctx.creatorOf ? await ctx.creatorOf(receivable.id) : null;
      await ctx.onSubmit(debtPayment(ctx.newId, 'receivable', receivable.id, { amount, bankId, paymentDate: date }, dep ? [dep] : []));
      ctx.onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
    }
  };
  return (
    <View>
      <AmountInput value={amount} onChange={setAmount} sign="+" tone={colors.ok} />
      <Text style={{ textAlign: 'center', fontSize: 14, color: colors.muted }}>Pendiente {formatMoney(receivable.pendingAmount)}</Text>
      <DateField value={date} onChange={setDate} snapshot={ctx.snapshot} businessDate={ctx.businessDate} caption={ctx.dateCaption} />
      <BankChips snapshot={ctx.snapshot} value={bankId} onChange={setBankId} />
      {tooMuch ? <Notice tone="warn">Mayor al pendiente</Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Button
        testID="collect-submit"
        label={amount <= 0 ? 'Escribe el monto' : amount === receivable.pendingAmount ? `Ya pagó · Registrar ${formatMoneyCompact(amount)}` : `Pagó una parte · Registrar ${formatMoneyCompact(amount)}`}
        disabled={amount <= 0 || tooMuch}
        onPress={() => void save()}
      />
    </View>
  );
}

/** La clienta paga otro día: elegir la nueva fecha con un toque (próximos 14 días). */
export function ReschedulePanel({ receivable, ctx }: { receivable: SnapshotReceivable & { version?: number }; ctx: Ctx }) {
  const days = Array.from({ length: 14 }, (_, i) => addDays(ctx.businessDate, i + 1));
  const [date, setDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const save = async () => {
    if (!date || !receivable.version) return;
    setError(null);
    try {
      await ctx.onSubmit(receivableReschedule(ctx.newId, { id: receivable.id, version: receivable.version }, date));
      ctx.onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
    }
  };
  return (
    <View>
      <Text style={{ fontSize: 14, color: colors.muted, marginTop: 8 }}>Vence {receivable.creditDueBy ? formatDayShort(receivable.creditDueBy) : 'sin fecha'} · nueva fecha:</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingVertical: 10 }}>
        {days.map((d) => (
          <Pressable
            key={d}
            accessibilityRole="radio"
            accessibilityState={{ checked: d === date }}
            onPress={() => setDate(d)}
            style={{ minWidth: 64, minHeight: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 12, borderWidth: 2, borderColor: colors.brand, backgroundColor: d === date ? colors.brand : colors.paper }}
          >
            <Text style={{ fontSize: 13, fontWeight: '700', color: d === date ? '#FFFFFF' : colors.muted }}>{formatDayShort(d).split(' ')[0]}</Text>
            <Text style={{ fontSize: 18, fontWeight: '800', color: d === date ? '#FFFFFF' : colors.ink }}>{d.slice(8)}</Text>
          </Pressable>
        ))}
      </ScrollView>
      {!receivable.version ? <Notice tone="warn">Sincroniza antes de cambiar la fecha</Notice> : null}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Button label={date ? `Mover a ${formatDayShort(date)}` : 'Elige una fecha'} disabled={!date || !receivable.version} onPress={() => void save()} />
    </View>
  );
}

/** Hoja de un cobro: acción principal «Ya pagó» y alternativa «Paga otro día». */
export function ReceivableSheetContent({ receivable, ctx, onClose }: { receivable: SnapshotReceivable & { version?: number }; ctx: Ctx; onClose: () => void }) {
  const [mode, setMode] = useState<'collect' | 'reschedule'>('collect');
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flex: 1 }}>
          <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '800', color: colors.ink }} numberOfLines={1}>
            {receivable.counterpartyName}
          </Text>
          <Text style={{ fontSize: 15, color: colors.muted, ...num }}>
            Debe {formatMoney(receivable.pendingAmount)} · vence {receivable.creditDueBy ? formatDayShort(receivable.creditDueBy) : 'sin fecha'}
          </Text>
        </View>
        <Button variant="link" label="Cerrar" onPress={onClose} />
      </View>
      {mode === 'collect' ? (
        <View>
          <CollectPanel receivable={receivable} ctx={ctx} />
          <Button variant="secondary" label="Paga otro día" onPress={() => setMode('reschedule')} />
        </View>
      ) : (
        <View>
          <ReschedulePanel receivable={receivable} ctx={ctx} />
          <Button variant="link" label="‹ Volver a registrar cobro" onPress={() => setMode('collect')} />
        </View>
      )}
    </View>
  );
}

/** Elegir a quién se le cobra (FAB → Cobro). */
export function ReceivablePicker({ snapshot, onPick }: { snapshot: StoreSnapshot; onPick: (r: SnapshotReceivable) => void }) {
  const open = snapshot.receivables.filter((r) => r.pendingAmount > 0 && !r.deletedAt).sort((a, b) => (a.creditDueBy ?? '9') < (b.creditDueBy ?? '9') ? -1 : 1);
  return (
    <View>
      {open.map((r) => (
        <Pressable key={r.id} accessibilityRole="button" onPress={() => onPick(r)} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, borderBottomWidth: 1, borderColor: colors.line, gap: 8 }}>
          <Text style={{ flex: 1, fontSize: 16, color: colors.ink }} numberOfLines={1}>
            {r.counterpartyName}
          </Text>
          <Text style={{ fontSize: 14, color: colors.muted }}>{r.creditDueBy ? formatDayShort(r.creditDueBy) : 'sin fecha'}</Text>
          <Text style={{ width: 84, textAlign: 'right', fontSize: 16, fontWeight: '700', color: colors.ink, ...num }}>{formatMoneyCompact(r.pendingAmount)}</Text>
        </Pressable>
      ))}
    </View>
  );
}

function Progress({ title, done, expected, tone }: { title: string; done: number; expected: number; tone: string }) {
  const ratio = expected > 0 ? Math.min(1, done / expected) : done > 0 ? 1 : 0;
  return (
    <View style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase' }}>{title}</Text>
        <Text style={{ fontSize: 13, fontWeight: '700', color: colors.ink, ...num }}>
          {formatMoneyCompact(done).replace('$ ', '')}/{formatMoneyCompact(expected).replace('$ ', '')}
        </Text>
      </View>
      <View style={{ height: 8, borderRadius: 4, backgroundColor: colors.soft, marginTop: 4 }}>
        <View style={{ width: `${ratio * 100}%`, height: 8, borderRadius: 4, backgroundColor: tone }} />
      </View>
    </View>
  );
}

/** Lo registrado hoy y avance contra lo habitual del día. */
export function TodaySection({ activity, onEdit }: { activity: TodayActivity; onEdit?: (item: TodayItem) => void }) {
  return (
    <View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 20, marginBottom: 6 }}>
        <Text accessibilityRole="header" style={{ fontSize: 13, fontWeight: '700', color: colors.muted, letterSpacing: 0.4, textTransform: 'uppercase' }}>
          Hoy
        </Text>
      </View>
      <View style={{ flexDirection: 'row', gap: 16, marginBottom: 6 }}>
        <Progress title="Ventas" done={activity.sales.done} expected={activity.sales.expected} tone={colors.ok} />
        <Progress title="Gastos" done={activity.expenses.done} expected={activity.expenses.expected} tone={colors.bad} />
      </View>
      {activity.items.length === 0 ? <Text style={{ fontSize: 15, color: colors.muted }}>Sin registros hoy</Text> : null}
      {activity.items.map((i) => (
        <Pressable
          key={i.key}
          disabled={!onEdit || !i.movementId}
          onPress={() => onEdit?.(i)}
          accessibilityRole={onEdit && i.movementId ? 'button' : undefined}
          accessibilityLabel={`${i.label} ${formatMoney(i.amount)} ${i.state === 'pending' ? 'pendiente de enviar' : i.state === 'problem' ? 'con problema' : 'confirmado'}`}
          style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48, borderBottomWidth: 1, borderColor: colors.line, gap: 8 }}
        >
          <Text style={{ width: 22, fontSize: 15, color: i.state === 'problem' ? colors.bad : i.state === 'pending' ? colors.warn : colors.ok }}>
            {i.state === 'pending' ? '⏳' : i.state === 'problem' ? '✕' : '✓'}
          </Text>
          <Text style={{ flex: 1, fontSize: 15, color: colors.ink }} numberOfLines={1}>
            {i.label}
          </Text>
          {i.amount !== 0 ? (
            <Text style={{ fontSize: 15, fontWeight: '700', color: i.amount > 0 ? colors.ok : colors.bad, ...num }}>
              {i.amount > 0 ? '+' : '−'}
              {formatMoneyCompact(Math.abs(i.amount)).replace('$ ', '')}
            </Text>
          ) : null}
          {onEdit && i.movementId ? <Text style={{ fontSize: 18, color: colors.brand }}>›</Text> : null}
        </Pressable>
      ))}
    </View>
  );
}

/** Corregir o borrar un ingreso/gasto. Borrar pide un segundo toque. */
export function MovementEditContent({
  item,
  current,
  snapshot,
  businessDate,
  caption,
  onSave,
  onDelete,
  onClose,
}: {
  item: TodayItem;
  current: { amount: number; description: string; date: string; kind: 'income' | 'expense' };
  snapshot: StoreSnapshot;
  businessDate: string;
  caption?: string;
  onSave: (changes: { amount: number; description: string; date: string }) => Promise<void>;
  onDelete: () => Promise<void>;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(current.amount);
  const [description, setDescription] = useState(current.description);
  const [date, setDate] = useState(current.date);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setError(null);
    try {
      await fn();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
    }
  };
  const changed = amount !== current.amount || description !== current.description || date !== current.date;
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '800', color: colors.ink }}>
          {current.kind === 'income' ? 'Ingreso' : 'Gasto'}
        </Text>
        <Button variant="link" label="Cerrar" onPress={onClose} />
      </View>
      {item.state === 'pending' ? <Text style={{ fontSize: 14, color: colors.warn }}>⏳ Aún no se envió: la corrección reemplaza lo pendiente.</Text> : null}
      <AmountInput value={amount} onChange={setAmount} sign={current.kind === 'income' ? '+' : '−'} tone={current.kind === 'income' ? colors.ok : colors.bad} />
      <DateField value={date} onChange={setDate} snapshot={snapshot} businessDate={businessDate} caption={caption} />
      <View style={{ marginVertical: 8 }}>
        <Text style={{ fontSize: 17, fontWeight: '600', color: colors.ink, marginBottom: 4 }}>Descripción</Text>
        <TextInput
          accessibilityLabel="Descripción"
          value={description}
          onChangeText={setDescription}
          style={{ minHeight: 52, borderWidth: 2, borderColor: '#6F6F6F', borderRadius: 12, paddingHorizontal: 14, fontSize: 18, color: colors.ink }}
        />
      </View>
      {error ? <Notice tone="bad">{error}</Notice> : null}
      <Button label="Guardar cambios" disabled={!changed || amount <= 0} onPress={() => void run(() => onSave({ amount, description, date }))} />
      <Button
        variant="secondary"
        label={confirmDelete ? `Sí, eliminar ${formatMoneyCompact(current.amount)}` : 'Eliminar'}
        onPress={() => (confirmDelete ? void run(onDelete) : setConfirmDelete(true))}
      />
    </View>
  );
}
