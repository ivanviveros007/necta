import { formatDayShort, formatMoney, formatMoneyCompact, type SnapshotReceivable, type StoreSnapshot } from '@necta/cash-engine';
import { Host, Picker } from '@expo/ui';
import { useState } from 'react';
import { Text, View } from 'react-native';
import { AmountInput, CollectPanel, DateField, ReceivablePicker } from './collect';
import { commitmentCreate, debtPayment, movementCreate, saleCreate, type Draft } from '../domain/operations';
import { Body, Button, colors, Field, Notice, Segmented, styles } from './ui';

/** «45.000» → 45000. */
export function parseAmount(text: string): number {
  const digits = text.replace(/\D/g, '');
  return digits ? Number(digits) : 0;
}

export interface FormProps {
  snapshot: StoreSnapshot;
  businessDate: string;
  /** «Hoy · …» o «Fecha del caso · …» si la fecha de negocio es simulada. */
  dateCaption?: string;
  newId: () => string;
  /** Guarda localmente (SQLite + outbox). Funciona sin señal. */
  onSubmit: (draft: Draft) => Promise<void>;
  /** clientMutationId de la operación local que creó una entidad, si aún no se envió. */
  creatorOf?: (entityId: string) => Promise<string | null>;
  onDone?: () => void;
}

/** Selector nativo (Expo UI: SwiftUI / Jetpack Compose) dentro de su Host. */
export function OptionPicker<T extends string>({ label, value, options, onChange, testID }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; testID?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={{ minHeight: 56, borderWidth: 2, borderColor: '#6F6F6F', borderRadius: 12, justifyContent: 'center', paddingHorizontal: 8 }}>
        <Host matchContents>
          <Picker testID={testID} selectedValue={value} onValueChange={(v) => onChange(v as T)}>
            {options.map((o) => (
              <Picker.Item key={o.value} label={o.label} value={o.value} />
            ))}
          </Picker>
        </Host>
      </View>
    </View>
  );
}

function useSubmit(onSubmit: FormProps['onSubmit'], onDone?: () => void) {
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const submit = async (draft: Draft | null, reset: () => void) => {
    if (!draft) return;
    setError(null);
    try {
      await onSubmit(draft);
      reset();
      setSaved(true);
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar');
    }
  };
  return { error, saved, submit };
}

const bankOptions = (s: StoreSnapshot) => s.banks.filter((b) => !b.deletedAt).map((b) => ({ value: b.id, label: b.name }));

/**
 * Registro rápido (hoja del botón +): gasto, ingreso o cobro de una deuda. Monto grande, bolsillo con
 * botones, todo al alcance del pulgar. Se guarda en el teléfono aunque no haya señal.
 */
export function MovementForm({ snapshot, businessDate, dateCaption, newId, onSubmit, onDone, onClose, creatorOf }: FormProps & { onClose?: () => void }) {
  const [kind, setKind] = useState<'expense' | 'income' | 'collect'>('expense');
  const [receivable, setReceivable] = useState<SnapshotReceivable | null>(null);
  const [amount, setAmount] = useState(0);
  const banks = snapshot.banks.filter((b) => !b.deletedAt);
  const [bankId, setBankId] = useState(banks[0]?.id ?? '');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(businessDate);
  const { error, saved, submit } = useSubmit(onSubmit, onDone);
  const ctx = { snapshot, businessDate, dateCaption, newId, onSubmit, creatorOf, onDone };
  return (
    <View>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '800', color: colors.ink }}>
          Registrar
        </Text>
        {onClose ? <Button variant="link" label="Cerrar" onPress={onClose} /> : null}
      </View>
      <Segmented
        label="Tipo"
        value={kind}
        onChange={(k) => {
          setKind(k);
          setReceivable(null);
        }}
        options={[
          { value: 'expense', label: '− Gasto' },
          { value: 'income', label: '+ Ingreso' },
          { value: 'collect', label: 'Cobro' },
        ]}
      />
      {kind === 'collect' ? (
        receivable ? (
          <View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 8 }}>
              <Text style={{ fontSize: 18, fontWeight: '800', color: colors.ink }}>{receivable.counterpartyName}</Text>
              <Button variant="link" label="Cambiar" onPress={() => setReceivable(null)} />
            </View>
            <CollectPanel receivable={receivable} ctx={ctx} />
          </View>
        ) : (
          <ReceivablePicker snapshot={snapshot} onPick={setReceivable} />
        )
      ) : (
        <View>
          <AmountInput value={amount} onChange={setAmount} sign={kind === 'income' ? '+' : '−'} tone={kind === 'income' ? colors.ok : colors.bad} />
          <DateField value={date} onChange={setDate} snapshot={snapshot} businessDate={businessDate} caption={dateCaption} />
          {banks.length > 1 ? <Segmented label="Bolsillo" value={bankId} onChange={setBankId} options={banks.map((b) => ({ value: b.id, label: b.name }))} /> : null}
          <Field label="Descripción (opcional)" value={description} onChangeText={setDescription} placeholder={kind === 'income' ? 'Venta del mercado…' : 'Transporte, bolsas…'} />
          {error ? <Notice tone="bad">{error}</Notice> : null}
          {saved ? <Notice tone="ok">Guardado en el teléfono.</Notice> : null}
          <Button
            label={amount > 0 ? `Guardar ${kind === 'income' ? 'ingreso' : 'gasto'} ${formatMoneyCompact(amount)}` : 'Escribe el monto'}
            disabled={amount <= 0 || !bankId}
            onPress={() =>
              void submit(movementCreate(newId, { kind: kind === 'income' ? 'income' : 'expense', amount, bankId, date, description }), () => {
                setAmount(0);
                setDescription('');
              })
            }
          />
        </View>
      )}
    </View>
  );
}

export function DebtPaymentForm({ kind, snapshot, businessDate, newId, onSubmit, creatorOf, onDone }: FormProps & { kind: 'receivable' | 'payable' }) {
  const debts = (kind === 'receivable' ? snapshot.receivables : snapshot.payables).filter((d) => d.pendingAmount > 0 && !d.deletedAt);
  const [debtId, setDebtId] = useState('');
  const [amount, setAmount] = useState('');
  const [bankId, setBankId] = useState(snapshot.banks[0]?.id ?? '');
  const { error, saved, submit } = useSubmit(onSubmit, onDone);
  const selected = debts.find((d) => d.id === debtId);
  const value = parseAmount(amount);
  const tooMuch = selected ? value > selected.pendingAmount : false;
  return (
    <View>
      <OptionPicker
        testID="debt-picker"
        label={kind === 'receivable' ? '¿Quién te pagó?' : '¿A quién le pagaste?'}
        value={debtId}
        onChange={setDebtId}
        options={[{ value: '', label: 'Elige una cuenta' }, ...debts.map((d) => ({ value: d.id, label: `${d.counterpartyName} · ${formatMoney(d.pendingAmount)}` }))]}
      />
      {selected ? <Body muted>Pendiente: {formatMoney(selected.pendingAmount)}{selected.creditDueBy ? ` · vence ${selected.creditDueBy}` : ''}</Body> : null}
      <Field label="Monto (COP)" keyboardType="number-pad" value={amount} onChangeText={setAmount} hint={value > 0 ? formatMoney(value) : undefined} />
      {tooMuch ? <Notice tone="warn">El monto es mayor a lo que falta pagar.</Notice> : null}
      <OptionPicker label="Bolsillo" value={bankId} onChange={setBankId} options={bankOptions(snapshot)} />
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {saved ? <Notice tone="ok">Guardado en el teléfono.</Notice> : null}
      <Button
        label={kind === 'receivable' ? 'Guardar cobro' : 'Guardar pago'}
        disabled={!selected || value <= 0 || tooMuch}
        onPress={() =>
          void (async () => {
            const dep = creatorOf ? await creatorOf(debtId) : null;
            await submit(debtPayment(newId, kind, debtId, { amount: value, bankId, paymentDate: businessDate }, dep ? [dep] : []), () => setAmount(''));
          })()
        }
      />
    </View>
  );
}

export function SaleForm({ snapshot, businessDate, newId, onSubmit, onDone }: FormProps) {
  const customers = snapshot.counterparties.filter((c) => !c.aggregated && !c.deletedAt && !c.id.startsWith('sup_'));
  const [customerId, setCustomerId] = useState('');
  const [amount, setAmount] = useState('');
  const [paid, setPaid] = useState<'cash' | 'credit'>('cash');
  const [bankId, setBankId] = useState(snapshot.banks[0]?.id ?? '');
  const { error, saved, submit } = useSubmit(onSubmit, onDone);
  const value = parseAmount(amount);
  const customer = customers.find((c) => c.id === customerId);
  return (
    <View>
      <OptionPicker label="Clienta" value={customerId} onChange={setCustomerId} options={[{ value: '', label: 'Elige una clienta' }, ...customers.map((c) => ({ value: c.id, label: c.name }))]} />
      <Field label="Monto (COP)" keyboardType="number-pad" value={amount} onChangeText={setAmount} hint={value > 0 ? formatMoney(value) : undefined} />
      <Segmented label="Forma de pago" value={paid} onChange={setPaid} options={[{ value: 'cash', label: 'De contado' }, { value: 'credit', label: 'A crédito' }]} />
      {paid === 'cash' ? <OptionPicker label="Bolsillo" value={bankId} onChange={setBankId} options={bankOptions(snapshot)} /> : <Body muted>Vence a los 30 días.</Body>}
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {saved ? <Notice tone="ok">Venta guardada en el teléfono.</Notice> : null}
      <Button
        label="Guardar venta"
        disabled={!customer || value <= 0}
        onPress={() =>
          void submit(
            customer ? saleCreate(newId, { customerId, customerName: customer.name, amount: value, paid: paid === 'cash', bankId, saleDate: businessDate, expiresAt: null }) : null,
            () => setAmount(''),
          )
        }
      />
    </View>
  );
}

export function CommitmentForm({ businessDate, newId, onSubmit, onDone }: FormProps) {
  const [concept, setConcept] = useState('');
  const [amount, setAmount] = useState('');
  const [recurring, setRecurring] = useState<'monthly' | 'once'>('monthly');
  const [days, setDays] = useState('1');
  const [date, setDate] = useState(businessDate);
  const [negotiable, setNegotiable] = useState<'yes' | 'no'>('no');
  const { error, saved, submit } = useSubmit(onSubmit, onDone);
  const value = parseAmount(amount);
  const dayList = days.split(/[,\s]+/).map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 31);
  const valid = concept.trim().length > 0 && value > 0 && (recurring === 'once' ? /^\d{4}-\d{2}-\d{2}$/.test(date) : dayList.length > 0);
  return (
    <View>
      <Field label="Concepto" value={concept} onChangeText={setConcept} placeholder="Arriendo, sueldos, cuota…" />
      <Field label="Monto (COP)" keyboardType="number-pad" value={amount} onChangeText={setAmount} hint={value > 0 ? formatMoney(value) : undefined} />
      <Segmented label="Frecuencia" value={recurring} onChange={setRecurring} options={[{ value: 'monthly', label: 'Cada mes' }, { value: 'once', label: 'Una vez' }]} />
      {recurring === 'monthly' ? (
        <Field label="Días del mes" keyboardType="numbers-and-punctuation" value={days} onChangeText={setDays} hint="Por ejemplo: 15, 30" />
      ) : (
        <Field label="Fecha (AAAA-MM-DD)" value={date} onChangeText={setDate} />
      )}
      <Segmented label="¿Se puede pedir plazo?" value={negotiable} onChange={setNegotiable} options={[{ value: 'no', label: 'No se aplaza' }, { value: 'yes', label: 'Se puede pedir plazo' }]} />
      {error ? <Notice tone="bad">{error}</Notice> : null}
      {saved ? <Notice tone="ok">Compromiso guardado en el teléfono.</Notice> : null}
      <Button
        label="Guardar compromiso"
        disabled={!valid}
        onPress={() =>
          void submit(
            commitmentCreate(newId, {
              direction: 'outflow',
              concept: concept.trim(),
              amount: value,
              negotiable: negotiable === 'yes',
              schedule: recurring === 'monthly' ? { kind: 'monthly', daysOfMonth: dayList, startDate: businessDate } : { kind: 'once', date },
            }),
            () => {
              setConcept('');
              setAmount('');
            },
          )
        }
      />
      <Text style={{ color: colors.muted, fontSize: 15 }}>Necta no conoce estos pagos si no los cargas.</Text>
    </View>
  );
}
