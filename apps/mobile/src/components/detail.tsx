import {
  formatDayShort,
  formatMoney,
  formatMoneyCompact,
  type Assumption,
  type RecommendedAction,
  type ScenarioResult,
  type UnscheduledReceivable,
} from '@necta/cash-engine';
import { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SectionTitle } from './home';
import { colors } from './ui';

const num = { fontVariant: ['tabular-nums' as const] };
const cell = { flex: 1, textAlign: 'right' as const, fontSize: 15, color: colors.ink, ...num };
const head = { flex: 1, textAlign: 'right' as const, fontSize: 12, fontWeight: '700' as const, color: colors.muted, textTransform: 'uppercase' as const };
const short = (n: number) => formatMoneyCompact(n).replace('$ ', '');

/** Tabla de los 14 días: Día · Entra · Sale · Saldo. Tocar una fila muestra sus movimientos. */
export function DayTable({ scenario }: { scenario: ScenarioResult }) {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <View>
      <View style={{ flexDirection: 'row', paddingVertical: 8, borderBottomWidth: 2, borderColor: colors.ink }}>
        <Text style={[head, { flex: 1.3, textAlign: 'left' }]}>Día</Text>
        <Text style={head}>Entra</Text>
        <Text style={head}>Sale</Text>
        <Text style={head}>Saldo</Text>
      </View>
      {scenario.days.map((d) => (
        <View key={d.date} style={{ borderBottomWidth: 1, borderColor: colors.line, backgroundColor: d.isShortfall ? colors.badBg : undefined }}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${formatDayShort(d.date)}: entra ${formatMoney(d.totalIn)}, sale ${formatMoney(d.totalOut)}, saldo ${formatMoney(d.closing)}`}
            onPress={() => setOpen(open === d.date ? null : d.date)}
            style={{ flexDirection: 'row', alignItems: 'center', minHeight: 48 }}
          >
            <Text style={{ flex: 1.3, fontSize: 15, color: colors.ink, fontWeight: '600' }}>
              {formatDayShort(d.date)}
              {d.intradayRisk ? <Text style={{ color: colors.warn }}> ⏱</Text> : null}
            </Text>
            <Text style={[cell, { color: d.totalIn ? colors.ok : colors.muted }]}>{d.totalIn ? `+${short(d.totalIn)}` : '—'}</Text>
            <Text style={[cell, { color: d.totalOut ? colors.bad : colors.muted }]}>{d.totalOut ? `−${short(d.totalOut)}` : '—'}</Text>
            <Text style={[cell, { fontWeight: '800', color: d.closing < 0 ? colors.bad : colors.ink }]}>{formatMoneyCompact(d.closing)}</Text>
          </Pressable>
          {open === d.date ? (
            <View testID={`day-flows-${d.date}`} style={{ paddingBottom: 8, paddingLeft: 8 }}>
              {[...d.inflows, ...d.outflows].map((f) => (
                <View key={f.key} style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 2 }}>
                  <Text style={{ fontSize: 14, color: colors.muted, flex: 1 }} numberOfLines={1}>
                    {f.label}
                  </Text>
                  <Text style={{ fontSize: 14, fontWeight: '700', color: f.direction === 'inflow' ? colors.ok : colors.bad, ...num }}>
                    {f.direction === 'inflow' ? '+' : '−'}
                    {formatMoney(f.amount).replace('$ ', '')}
                  </Text>
                </View>
              ))}
              {d.inflows.length + d.outflows.length === 0 ? <Text style={{ fontSize: 14, color: colors.muted }}>Sin movimientos</Text> : null}
            </View>
          ) : null}
        </View>
      ))}
    </View>
  );
}

const VERB: Record<RecommendedAction['kind'], { text: string; color: string }> = {
  confirm_collection: { text: 'Confirmar', color: colors.brand },
  collect: { text: 'Cobrar', color: colors.ok },
  postpone: { text: 'Aplazar', color: colors.warn },
};

/** Acciones: verbo · contraparte · monto · efecto (✓ resuelve, +N días). */
export function ActionsTable({ actions }: { actions: RecommendedAction[] }) {
  if (actions.length === 0) return <Text style={{ fontSize: 15, color: colors.muted }}>Sin acciones</Text>;
  return (
    <View>
      {actions.map((a) => (
        <View key={a.id} accessibilityLabel={a.detail} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 50, borderBottomWidth: 1, borderColor: colors.line }}>
          <View style={{ width: 84, alignItems: 'center', paddingVertical: 4, borderRadius: 999, backgroundColor: VERB[a.kind].color }}>
            <Text style={{ fontSize: 12, fontWeight: '800', color: '#FFFFFF' }}>{VERB[a.kind].text}</Text>
          </View>
          <Text style={{ flex: 1, fontSize: 15, color: colors.ink }} numberOfLines={1}>
            {a.target}
          </Text>
          <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, ...num }}>{formatMoneyCompact(a.amount)}</Text>
          <Text style={{ width: 52, textAlign: 'right', fontSize: 14, fontWeight: '800', color: a.impact.resolves ? colors.ok : colors.muted }}>
            {a.kind === 'postpone' && a.postponeDays ? `+${a.postponeDays} d` : a.kind === 'confirm_collection' ? formatDayShort(a.riskDate).split(' ').slice(0, 2).join(' ') : a.impact.resolves ? '✓' : '—'}
          </Text>
        </View>
      ))}
    </View>
  );
}

const REASON: Record<UnscheduledReceivable['reason'], string> = {
  overdue: 'vencido',
  late_payer: 'paga tarde',
  insufficient_history: 'poco historial',
  no_due_date: 'sin fecha',
  due_after_window: 'vence después',
};

export function UnscheduledTable({ items }: { items: UnscheduledReceivable[] }) {
  const visible = items.filter((u) => u.reason !== 'due_after_window');
  if (visible.length === 0) return <Text style={{ fontSize: 15, color: colors.muted }}>Ninguno</Text>;
  return (
    <View>
      {visible.map((u) => (
        <View key={u.receivableId} accessibilityLabel={u.basis} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 48, borderBottomWidth: 1, borderColor: colors.line }}>
          <Text style={{ flex: 1, fontSize: 15, color: colors.ink }} numberOfLines={1}>
            {u.counterpartyName}
          </Text>
          <Text style={{ fontSize: 13, fontWeight: '700', color: colors.warn }}>
            {REASON[u.reason]}
            {u.reason === 'overdue' ? ` ${u.daysOverdue} d` : ''}
          </Text>
          <Text style={{ width: 84, textAlign: 'right', fontSize: 15, fontWeight: '700', color: colors.ink, ...num }}>{formatMoneyCompact(u.pendingAmount)}</Text>
        </View>
      ))}
    </View>
  );
}

/** Supuestos plegados: visibles a pedido, sin ocupar la pantalla. */
export function AssumptionsToggle({ assumptions }: { assumptions: Assumption[] }) {
  const [open, setOpen] = useState(false);
  const missing = assumptions.filter((a) => a.missing).length;
  return (
    <View>
      <Pressable accessibilityRole="button" onPress={() => setOpen((o) => !o)} style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', minHeight: 48 }}>
        <SectionTitle right={missing ? `${missing} faltan` : undefined}>{`Supuestos (${assumptions.length})`}</SectionTitle>
        <Text style={{ fontSize: 20, color: colors.brand, marginTop: 14 }}>{open ? '⌃' : '⌄'}</Text>
      </Pressable>
      {open
        ? assumptions.map((a) => (
            <Text key={a.code} style={{ fontSize: 14, color: a.missing ? colors.warn : colors.muted, paddingVertical: 3 }}>
              {a.missing ? '⚠ ' : '• '}
              {a.text}
            </Text>
          ))
        : null}
    </View>
  );
}
