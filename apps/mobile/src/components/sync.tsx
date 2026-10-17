import { BottomSheet, RNHostView } from '@expo/ui';
import type { ReactNode } from 'react';
import { Pressable, Text, useWindowDimensions, View } from 'react-native';
import type { OutboxItem } from '../db/localRepository';
import type { SyncState } from '../sync/syncCoordinator';
import { Body, Button, Card, colors, Notice } from './ui';

const time = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : 'nunca');

/** Estado de sincronización siempre visible: pendientes, última sincronización, errores. */
export function SyncBanner({ sync, pendingCount, problems, expired, onOpen }: { sync: SyncState | null; pendingCount: number; problems: number; expired: boolean; onOpen: () => void }) {
  let tone: 'ok' | 'warn' | 'bad' = 'ok';
  let text = `Sincronizado · ${time(sync?.lastSyncAt ?? null)}`;
  if (expired || sync?.phase === 'auth_expired') {
    tone = 'warn';
    text = `Sesión vencida: registras igual; ingresa para enviar ${pendingCount} pendientes`;
  } else if (sync?.phase === 'offline') {
    tone = 'warn';
    text = `Sin conexión · ${pendingCount} pendientes guardados en el teléfono`;
  } else if (sync?.phase === 'syncing') {
    text = 'Sincronizando…';
  } else if (sync?.phase === 'error') {
    tone = 'bad';
    text = `No se pudo sincronizar · reintentamos solos`;
  } else if (pendingCount > 0) {
    tone = 'warn';
    text = `${pendingCount} pendientes · proyección provisional`;
  }
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${text}. Ver sincronización`} onPress={onOpen} testID="sync-banner">
      <View style={{ backgroundColor: tone === 'ok' ? '#E3F3E8' : tone === 'warn' ? colors.warnBg : colors.badBg, padding: 12, borderRadius: 12, marginBottom: 6 }}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>
          {tone === 'ok' ? '✓' : tone === 'warn' ? '⚠' : '✕'} {text}
        </Text>
        {problems > 0 ? <Text style={{ fontSize: 16, color: colors.bad, fontWeight: '700' }}>{problems} para revisar (conflictos o rechazos)</Text> : null}
        <Text style={{ fontSize: 14, color: colors.muted }}>Última sincronización: {time(sync?.lastSyncAt ?? null)}</Text>
      </View>
    </Pressable>
  );
}

const STATUS_TEXT: Record<OutboxItem['status'], string> = {
  pending: 'Pendiente de enviar',
  sending: 'Enviando…',
  applied: 'Enviado · esperando confirmación',
  conflict: 'Conflicto: elige qué versión queda',
  rejected: 'Rechazado',
  blocked: 'Bloqueado: depende de otro registro rechazado',
};

const TYPE_TEXT: Record<OutboxItem['type'], string> = {
  'movement.create': 'Ingreso o gasto',
  'movement.update': 'Edición de movimiento',
  'movement.delete': 'Borrado de movimiento',
  'sale.create': 'Venta',
  'receivable.payment': 'Cobro',
  'payable.payment': 'Pago',
  'receivable.reschedule': 'Nueva fecha de cobro',
  'commitment.create': 'Pago fijo o futuro',
  'commitment.update': 'Edición de pago fijo',
  'commitment.delete': 'Borrado de pago fijo',
  'baseline.update': 'Ventas habituales',
  'bank.adjustment': 'Ajuste de saldo',
};

function describe(item: OutboxItem): string {
  const p = item.operation.payload as Record<string, unknown>;
  const amount = (p.amount ?? (p.movement as { amount?: number })?.amount ?? (p.commitment as { amount?: number })?.amount) as number | undefined;
  return amount ? `${TYPE_TEXT[item.type]} · $ ${amount.toLocaleString('es-CO')}` : TYPE_TEXT[item.type];
}

/** Lista de la outbox con resolución explícita de conflictos y rechazos. */
export function OutboxList({ items, onKeepMine, onKeepServer, onDiscard }: { items: OutboxItem[]; onKeepMine: (i: OutboxItem) => void; onKeepServer: (i: OutboxItem) => void; onDiscard: (i: OutboxItem) => void }) {
  if (items.length === 0) return <Body>No hay registros pendientes.</Body>;
  return (
    <View>
      {items.map((i) => (
        <Card key={i.clientMutationId} tone={i.status === 'conflict' || i.status === 'rejected' || i.status === 'blocked' ? 'bad' : undefined} label={describe(i)}>
          <Body bold>{describe(i)}</Body>
          <Body muted>{STATUS_TEXT[i.status]}</Body>
          {i.lastError && i.status !== 'pending' ? <Body>{i.lastError}</Body> : null}
          {i.status === 'conflict' && i.remote ? (
            <View>
              <Body>Versión del servidor: {JSON.stringify(pick(i.remote.entity))}</Body>
              <Body>Tu versión: {JSON.stringify((i.operation.payload as { changes?: unknown }).changes ?? {})}</Body>
              <Button label="Usar la mía" onPress={() => onKeepMine(i)} />
              <Button variant="secondary" label="Usar la del servidor" onPress={() => onKeepServer(i)} />
            </View>
          ) : null}
          {i.status === 'rejected' || i.status === 'blocked' ? <Button variant="secondary" label="Descartar y volver a registrar" onPress={() => onDiscard(i)} /> : null}
        </Card>
      ))}
    </View>
  );
}

function pick(entity: Record<string, unknown>) {
  const { concept, amount, description, version } = entity as Record<string, unknown>;
  return Object.fromEntries(Object.entries({ concept, amount, description, version }).filter(([, v]) => v !== undefined));
}

/** Botón flotante al alcance del pulgar. */
export function Fab({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Registrar"
      onPress={onPress}
      style={{ position: 'absolute', right: 20, bottom: 32, width: 72, height: 72, borderRadius: 36, backgroundColor: colors.brand, alignItems: 'center', justifyContent: 'center', shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 4 }, elevation: 6 }}
    >
      <Text style={{ color: colors.paper, fontSize: 40, lineHeight: 44 }}>+</Text>
    </Pressable>
  );
}

/**
 * Hoja inferior nativa (Expo UI). Sin snapPoints se ajusta al contenido. RNHostView vuelve el
 * contenido vista de React Native (si no, los Host internos quedarían anidados dentro de SwiftUI).
 */
export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  const { width } = useWindowDimensions();
  return (
    <BottomSheet isPresented={open} onDismiss={onClose} contentPadding={0}>
      <RNHostView matchContents>
        <View style={{ width, paddingHorizontal: 20, paddingTop: 12, paddingBottom: 28, backgroundColor: colors.paper }}>{open ? children : null}</View>
      </RNHostView>
    </BottomSheet>
  );
}

export function OfflineNotice({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return <Notice tone="warn">Sin señal: todo lo que registres se guarda en el teléfono y se envía cuando vuelva.</Notice>;
}
