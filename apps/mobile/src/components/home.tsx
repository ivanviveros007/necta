import {
  formatDayShort,
  formatMoney,
  formatMoneyCompact,
  type DayResult,
  type HomeSummary,
  type PaymentCoverage,
} from '@necta/cash-engine';
import { useState, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Line, Polyline, Rect } from 'react-native-svg';
import type { SyncState } from '../sync/syncCoordinator';
import { colors } from './ui';

const label = { fontSize: 13, fontWeight: '700' as const, color: colors.muted, letterSpacing: 0.4, textTransform: 'uppercase' as const };
const num = { fontVariant: ['tabular-nums' as const], color: colors.ink };

export function SectionTitle({ children, right }: { children: string; right?: string }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end', marginTop: 20, marginBottom: 6 }}>
      <Text accessibilityRole="header" style={label}>
        {children}
      </Text>
      {right ? <Text style={[label, { textTransform: 'none' }]}>{right}</Text> : null}
    </View>
  );
}

/** Saldo actual y mínimo proyectado: las dos cifras que responden «¿me alcanza?». */
export function BalanceHeader({ summary }: { summary: Pick<HomeSummary, 'balanceToday' | 'balanceDelta' | 'minBalance'> }) {
  const [showDelta, setShowDelta] = useState(false);
  const negative = summary.minBalance.amount < 0;
  return (
    <View style={{ marginTop: 4 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <Text style={label}>Saldo</Text>
        {summary.balanceDelta ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Diferencia con lo registrado" hitSlop={12} onPress={() => setShowDelta((v) => !v)}>
            <Text style={{ fontSize: 14, color: colors.warn, fontWeight: '800' }}>ⓘ</Text>
          </Pressable>
        ) : null}
      </View>
      <Text style={[num, { fontSize: 40, fontWeight: '800' }]}>{formatMoney(summary.balanceToday)}</Text>
      {showDelta && summary.balanceDelta ? (
        <Text style={[num, { fontSize: 14, color: colors.warn }]}>
          Registrado {formatMoney(summary.balanceToday - summary.balanceDelta)} · dif. {formatMoney(summary.balanceDelta)}
        </Text>
      ) : null}
      <View
        accessibilityLabel={`Mínimo en 14 días ${formatMoney(summary.minBalance.amount)} el ${formatDayShort(summary.minBalance.date)}`}
        style={{ flexDirection: 'row', alignSelf: 'flex-start', alignItems: 'center', gap: 6, marginTop: 6, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 999, backgroundColor: negative ? colors.badBg : '#E3F3E8' }}
      >
        <Text style={{ fontSize: 14, fontWeight: '900', color: negative ? colors.bad : colors.ok }}>{negative ? '▼' : '▲'}</Text>
        <Text style={{ fontSize: 14, fontWeight: '700', color: colors.ink }}>
          Mínimo 14 d {formatMoneyCompact(summary.minBalance.amount)} · {formatDayShort(summary.minBalance.date)}
        </Text>
      </View>
    </View>
  );
}

/** Saldo al cierre por día; al tocar un punto, tooltip con cifras del día. */
export function CashChart({ days }: { days: DayResult[] }) {
  const [selected, setSelected] = useState<number | null>(null);
  const [width, setWidth] = useState(340);
  const H = 160;
  const pad = 12;
  const values = days.map((d) => d.closing);
  const max = Math.max(0, ...values);
  const min = Math.min(0, ...values);
  const span = max - min || 1;
  const x = (i: number) => pad + (i * (width - 2 * pad)) / Math.max(1, days.length - 1);
  const y = (v: number) => pad + ((max - v) * (H - 2 * pad)) / span;
  const day = selected !== null ? days[selected] : undefined;
  return (
    <View>
      <View style={{ height: H }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)} testID="cash-chart">
        <Svg width={width} height={H}>
          {min < 0 ? <Rect x={0} y={y(0)} width={width} height={H - y(0)} fill={colors.badBg} /> : null}
          <Line x1={0} x2={width} y1={y(0)} y2={y(0)} stroke="#8A8A8A" strokeDasharray="5 4" strokeWidth={1} />
          <Polyline points={days.map((d, i) => `${x(i)},${y(d.closing)}`).join(' ')} stroke={colors.brand} strokeWidth={3} fill="none" />
          {selected !== null ? <Line x1={x(selected)} x2={x(selected)} y1={0} y2={H} stroke={colors.ink} strokeWidth={1} /> : null}
          {days.map((d, i) => (
            <Circle key={d.date} cx={x(i)} cy={y(d.closing)} r={i === selected ? 7 : d.isShortfall ? 5 : 3.5} fill={d.isShortfall ? colors.bad : colors.brand} />
          ))}
        </Svg>
        <View style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, flexDirection: 'row' }}>
          {days.map((d, i) => (
            <Pressable
              key={d.date}
              testID={`chart-day-${d.date}`}
              accessibilityRole="button"
              accessibilityLabel={`${formatDayShort(d.date)} saldo ${formatMoney(d.closing)}`}
              style={{ flex: 1 }}
              onPress={() => setSelected(i === selected ? null : i)}
            />
          ))}
        </View>
        {day ? <DayTooltip day={day} left={x(selected!)} width={width} /> : null}
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 }}>
        <Text style={{ fontSize: 13, color: colors.muted }}>{days[0] ? formatDayShort(days[0].date) : ''}</Text>
        <Text style={{ fontSize: 13, color: colors.muted }}>
          <Text style={{ color: colors.brand }}>●</Text> saldo  <Text style={{ color: colors.bad }}>●</Text> negativo  - - $ 0
        </Text>
        <Text style={{ fontSize: 13, color: colors.muted }}>{days.length ? formatDayShort(days[days.length - 1]!.date) : ''}</Text>
      </View>
    </View>
  );
}

/** Tooltip numérico: fecha, saldo al cierre, entra y sale. */
export function DayTooltip({ day, left, width }: { day: DayResult; left: number; width: number }) {
  const W = 170;
  const x = Math.max(0, Math.min(left - W / 2, width - W));
  const row = (k: string, v: string, color: string = '#FFFFFF') => (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: '#BDBDBD', fontSize: 13 }}>{k}</Text>
      <Text style={{ color, fontSize: 14, fontWeight: '800', fontVariant: ['tabular-nums'] }}>{v}</Text>
    </View>
  );
  return (
    <View testID="day-tooltip" pointerEvents="none" style={{ position: 'absolute', top: 0, left: x, width: W, padding: 10, borderRadius: 10, backgroundColor: 'rgba(17,17,17,0.92)' }}>
      <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '800', marginBottom: 2 }}>{formatDayShort(day.date)}</Text>
      {row('Saldo', formatMoney(day.closing), day.closing < 0 ? '#FF8A8A' : '#9BE3B4')}
      {row('Entra', `+${formatMoneyCompact(day.totalIn).replace('$ ', '')}`)}
      {row('Sale', `−${formatMoneyCompact(day.totalOut).replace('$ ', '')}`)}
    </View>
  );
}

function Kpi({ title, value, tone }: { title: string; value: number; tone?: string }) {
  return (
    <View accessibilityLabel={`${title} ${formatMoney(value)}`} style={{ flex: 1, padding: 12, borderRadius: 12, backgroundColor: colors.soft }}>
      <Text style={label}>{title}</Text>
      <Text adjustsFontSizeToFit numberOfLines={1} style={[num, { fontSize: 18, fontWeight: '800', color: tone ?? colors.ink }]}>
        {formatMoneyCompact(value)}
      </Text>
    </View>
  );
}

export function KpiRow({ totals }: { totals: HomeSummary['totals'] }) {
  return (
    <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
      <Kpi title="Entra" value={totals.inflow} tone={colors.ok} />
      <Kpi title="Sale" value={totals.outflow} tone={colors.bad} />
      <Kpi title="Sin fecha" value={totals.unscheduled} />
    </View>
  );
}

const STATUS = {
  covered: { icon: '✓', color: colors.ok, bg: '#E3F3E8' },
  depends: { icon: '!', color: colors.warn, bg: colors.warnBg },
  short: { icon: '✕', color: colors.bad, bg: colors.badBg },
} as const;

function StatusPill({ p }: { p: PaymentCoverage }) {
  const s = STATUS[p.status];
  const text = p.status === 'short' ? `−${formatMoneyCompact(p.shortBy).replace('$ ', '')}` : p.status === 'depends' ? 'depende' : 'ok';
  return (
    <View style={{ minWidth: 84, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 999, backgroundColor: s.bg }}>
      <Text style={{ fontSize: 13, fontWeight: '900', color: s.color }}>{s.icon}</Text>
      <Text style={{ fontSize: 13, fontWeight: '800', color: s.color }}>{text}</Text>
    </View>
  );
}

function Row({ date, name, amount, right, a11y }: { date: string; name: string; amount: string; right?: ReactNode; a11y: string }) {
  return (
    <View accessibilityLabel={a11y} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 52, borderBottomWidth: 1, borderColor: colors.line, gap: 8 }}>
      <Text style={{ width: 54, fontSize: 14, color: colors.muted }}>{date}</Text>
      <Text style={{ flex: 1, fontSize: 16, color: colors.ink }} numberOfLines={1}>
        {name}
      </Text>
      <Text style={[num, { fontSize: 16, fontWeight: '700' }]}>{amount}</Text>
      {right}
    </View>
  );
}

const dayLabel = (date: string) => formatDayShort(date).split(' ').slice(0, 2).join(' ');

/** Pagos de la ventana con su estado: ✓ cubierto · ! depende de un cobro · ✕ faltante. */
export function PaymentsTable({ payments, covered }: { payments: PaymentCoverage[]; covered: number }) {
  return (
    <View>
      <SectionTitle right={payments.length ? `${covered}/${payments.length} cubiertos` : undefined}>Pagos</SectionTitle>
      {payments.length === 0 ? <Text style={{ color: colors.muted, fontSize: 15 }}>Sin pagos cargados</Text> : null}
      {payments.map((p) => (
        <Row
          key={p.key}
          a11y={`${formatDayShort(p.date)} ${p.label} ${formatMoney(p.amount)} ${p.status === 'short' ? `faltan ${formatMoney(p.shortBy)}` : p.status === 'depends' ? `depende de ${p.dependsOn}` : 'cubierto'}`}
          date={dayLabel(p.date)}
          name={p.label}
          amount={formatMoneyCompact(p.amount)}
          right={<StatusPill p={p} />}
        />
      ))}
    </View>
  );
}

export function CollectionsTable({ items }: { items: HomeSummary['upcoming'] }) {
  const incoming = items.filter((i) => i.amount > 0);
  return (
    <View>
      <SectionTitle>Cobros</SectionTitle>
      {incoming.length === 0 ? <Text style={{ color: colors.muted, fontSize: 15 }}>Sin cobros con fecha</Text> : null}
      {incoming.map((i) => (
        <Row key={i.key} a11y={`${formatDayShort(i.date)} ${i.label} ${formatMoney(i.amount)}`} date={dayLabel(i.date)} name={i.label.replace(/^Cobro /, '')} amount={`+${formatMoneyCompact(i.amount).replace('$ ', '')}`} />
      ))}
    </View>
  );
}

const ACTION_VERB: Record<string, string> = { confirm_collection: 'Confirmar cobro', collect: 'Cobrar', postpone: 'Aplazar' };

/** Acción sugerida en una sola línea. */
export function ActionChip({ action, onPress }: { action: HomeSummary['primaryAction']; onPress: () => void }) {
  if (!action) return null;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Acción sugerida: ${action.title}`}
      onPress={onPress}
      style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, marginTop: 16, paddingHorizontal: 14, borderRadius: 12, backgroundColor: colors.brand }}
    >
      <Text style={{ fontSize: 13, fontWeight: '800', color: '#BFE3D2', textTransform: 'uppercase' }}>Sugerido</Text>
      <Text style={{ flex: 1, fontSize: 16, fontWeight: '700', color: '#FFFFFF' }} numberOfLines={1}>
        {ACTION_VERB[action.kind] ?? 'Acción'} · {action.target}
      </Text>
      <Text style={{ fontSize: 22, color: '#FFFFFF' }}>›</Text>
    </Pressable>
  );
}

/** Indicador compacto para el encabezado. */
export function SyncIndicator({ sync, pending, problems, expired, onPress }: { sync: SyncState | null; pending: number; problems: number; expired: boolean; onPress: () => void }) {
  let color: string = colors.ok;
  let text = '';
  if (expired || sync?.phase === 'auth_expired') {
    color = colors.warn;
    text = 'Ingresar';
  } else if (problems > 0) {
    color = colors.bad;
    text = `${problems}`;
  } else if (sync?.phase === 'offline') {
    color = colors.warn;
    text = pending ? `Offline · ${pending}` : 'Offline';
  } else if (sync?.phase === 'syncing') {
    text = '…';
  } else if (pending > 0) {
    color = colors.warn;
    text = `${pending}`;
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`Sincronización: ${text || 'al día'}`} hitSlop={10} onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 4 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: color }} />
      {text ? <Text style={{ fontSize: 15, fontWeight: '700', color }}>{text}</Text> : null}
    </Pressable>
  );
}
