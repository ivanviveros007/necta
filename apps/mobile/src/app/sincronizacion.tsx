import { useRouter } from 'expo-router';
import { ScrollView } from 'react-native';
import { useNecta, useOutbox } from '../app-state/NectaProvider';
import { OutboxList } from '../components/sync';
import { Body, Button, colors, Notice } from '../components/ui';
import { useSyncActions } from '../hooks/useSyncActions';

export default function SyncScreen() {
  const { sync, syncNow, expired, logout, user } = useNecta();
  const outbox = useOutbox();
  const actions = useSyncActions();
  const router = useRouter();
  const pending = (outbox.data ?? []).filter((o) => o.status === 'pending' || o.status === 'sending').length;
  return (
    <ScrollView style={{ backgroundColor: colors.paper }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
      <Body>Estado: {sync?.phase ?? '—'}</Body>
      <Body muted>Última sincronización: {sync?.lastSyncAt ? new Date(sync.lastSyncAt).toLocaleString('es-CO') : 'nunca'}</Body>
      {sync?.nextRetryAt ? <Body muted>Próximo reintento: {new Date(sync.nextRetryAt).toLocaleTimeString('es-CO')}</Body> : null}
      {sync?.lastError ? <Notice tone="warn">{sync.lastError}</Notice> : null}
      {expired || sync?.phase === 'auth_expired' ? (
        <Button label="Ingresar de nuevo para enviar" onPress={() => void logout().then(() => router.replace('/login'))} />
      ) : (
        <Button label="Sincronizar ahora" onPress={() => void syncNow()} />
      )}
      <OutboxList items={outbox.data ?? []} onKeepMine={(i) => void actions.keepMine(i)} onKeepServer={(i) => void actions.keepServer(i)} onDiscard={(i) => void actions.discard(i)} />
      <Button
        variant="link"
        label="Cerrar sesión"
        onPress={() => void logout().then(() => router.replace('/login'))}
      />
      {pending > 0 ? <Body muted>Si cierras sesión, tus {pending} registros pendientes quedan guardados para {user?.name} y se envían al volver a ingresar.</Body> : null}
    </ScrollView>
  );
}
