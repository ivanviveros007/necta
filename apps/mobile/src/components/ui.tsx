import { formatMoney } from '@necta/cash-engine';
import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, type TextInputProps } from 'react-native';

/** Alto contraste para leer con sol: texto ≥ 17, controles ≥ 56 px, estados con texto e ícono. */
export const colors = {
  ink: '#111111',
  paper: '#FFFFFF',
  muted: '#3F3F3F',
  brand: '#0B3D2E',
  ok: '#0A6B2F',
  warn: '#8A4B00',
  bad: '#A3141E',
  line: '#BDBDBD',
  soft: '#F2F2EE',
  warnBg: '#FFE9C2',
  badBg: '#FDE2E2',
};

export function Money({ amount, currency = 'COP', style }: { amount: number; currency?: string; style?: object }) {
  return <Text style={[styles.money, amount < 0 && styles.negative, style]}>{formatMoney(amount, currency)}</Text>;
}

export function Card({ children, tone, label }: { children: ReactNode; tone?: 'bad' | 'warn' | 'ok' | 'brand'; label?: string }) {
  return (
    <View accessibilityLabel={label} style={[styles.card, tone && { borderColor: colors[tone] }]}>
      {children}
    </View>
  );
}

export function Title({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.title}>
      {children}
    </Text>
  );
}

export function Body({ children, muted, bold }: { children: ReactNode; muted?: boolean; bold?: boolean }) {
  return <Text style={[styles.body, muted && styles.muted, bold && styles.bold]}>{children}</Text>;
}

export function Button({ label, onPress, variant = 'primary', disabled, testID }: { label: string; onPress: () => void; variant?: 'primary' | 'secondary' | 'link'; disabled?: boolean; testID?: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityState={{ disabled: Boolean(disabled) }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.button, styles[variant], disabled && styles.disabled, pressed && styles.pressed]}
    >
      <Text style={[styles.buttonText, variant !== 'primary' && styles.buttonTextAlt]}>{label}</Text>
    </Pressable>
  );
}

export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={label} style={styles.segmented}>
      {options.map((o) => (
        <Pressable
          key={o.value}
          accessibilityRole="radio"
          accessibilityState={{ checked: value === o.value }}
          onPress={() => onChange(o.value)}
          style={[styles.segment, value === o.value && styles.segmentOn]}
        >
          <Text style={[styles.segmentText, value === o.value && styles.segmentTextOn]}>{o.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Field({ label, hint, ...input }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput accessibilityLabel={label} placeholderTextColor={colors.muted} style={styles.input} {...input} />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function Notice({ tone, children, testID }: { tone: 'warn' | 'bad' | 'ok'; children: ReactNode; testID?: string }) {
  const icon = tone === 'ok' ? '✓' : tone === 'warn' ? '⚠' : '✕';
  return (
    <View testID={testID} accessibilityRole="alert" style={[styles.notice, { backgroundColor: tone === 'bad' ? colors.badBg : tone === 'warn' ? colors.warnBg : '#E3F3E8' }]}>
      <Text style={[styles.body, styles.bold]}>
        {icon} {children}
      </Text>
    </View>
  );
}

export const styles = StyleSheet.create({
  money: { fontVariant: ['tabular-nums'], color: colors.ink, fontSize: 17 },
  negative: { color: colors.bad, fontWeight: '700' },
  card: { borderWidth: 2, borderColor: colors.line, borderRadius: 14, padding: 16, marginVertical: 8, backgroundColor: colors.paper },
  title: { fontSize: 26, fontWeight: '800', color: colors.ink, marginBottom: 6 },
  body: { fontSize: 17, lineHeight: 24, color: colors.ink },
  muted: { color: colors.muted },
  bold: { fontWeight: '700' },
  button: { minHeight: 56, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, marginVertical: 6 },
  primary: { backgroundColor: colors.brand },
  secondary: { borderWidth: 2, borderColor: colors.brand, backgroundColor: colors.paper },
  link: { minHeight: 44, backgroundColor: 'transparent' },
  disabled: { opacity: 0.45 },
  pressed: { opacity: 0.8 },
  buttonText: { color: colors.paper, fontSize: 18, fontWeight: '700' },
  buttonTextAlt: { color: colors.brand },
  segmented: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  segment: { flex: 1, minHeight: 52, borderRadius: 12, borderWidth: 2, borderColor: colors.brand, alignItems: 'center', justifyContent: 'center' },
  segmentOn: { backgroundColor: colors.brand },
  segmentText: { fontSize: 17, fontWeight: '700', color: colors.brand },
  segmentTextOn: { color: colors.paper },
  field: { marginVertical: 8 },
  label: { fontSize: 17, fontWeight: '600', color: colors.ink, marginBottom: 4 },
  input: { minHeight: 56, borderWidth: 2, borderColor: '#6F6F6F', borderRadius: 12, paddingHorizontal: 14, fontSize: 20, color: colors.ink, backgroundColor: colors.paper },
  hint: { fontSize: 15, color: colors.muted, marginTop: 4 },
  notice: { padding: 12, borderRadius: 12, marginVertical: 6 },
});
