import { summarizeForecast } from '@necta/cash-engine';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useLocalView, useNecta, useOutbox } from '../app-state/NectaProvider';
import { MovementForm } from '../components/forms';
import { ActionChip, BalanceHeader, CashChart, CollectionsTable, KpiRow, PaymentsTable, SyncIndicator } from '../components/home';
import { OfflineNotice, QuickEntry } from '../components/sync';
import { Body, colors } from '../components/ui';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

/** Home: saldo, mínimo proyectado, gráfico, indicadores, pagos con estado y cobros. */
export default function HomeScreen() {
  const { status, sync, expired, record, newId, store } = useNecta();
  const view = useLocalView();
  const outbox = useOutbox();
  const online = useOnlineStatus();
  const router = useRouter();
  const [sheet, setSheet] = useState(false);
  const summary = useMemo(() => (view.data ? summarizeForecast(view.data.forecast, 30) : null), [view.data]);

  if (status === 'loading') return <ActivityIndicator style={{ flex: 1 }} size="large" color={colors.brand} />;
  if (status === 'anonymous') return <Redirect href="/login" />;
  const v = view.data;
  const problems = (outbox.data ?? []).filter((o) => o.status === 'conflict' || o.status === 'rejected' || o.status === 'blocked').length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <Stack.Screen
        options={{
          title: store?.name ?? 'Necta',
          headerRight: () => (
            <SyncIndicator sync={sync} pending={v?.pendingCount ?? 0} problems={problems} expired={expired} onPress={() => router.push('/sincronizacion')} />
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <OfflineNotice visible={online === false} />
        {v && summary ? (
          <>
            <BalanceHeader summary={summary} />
            <View style={{ marginTop: 12 }}>
              <CashChart days={v.forecast.scenarios.expected.days} />
            </View>
            <KpiRow totals={summary.totals} />
            <ActionChip action={summary.primaryAction} onPress={() => router.push('/detalle')} />
            <PaymentsTable payments={summary.payments} covered={summary.coveredCount} />
            <CollectionsTable items={summary.upcoming} />
          </>
        ) : (
          <Body>{sync?.phase === 'syncing' ? 'Sincronizando…' : 'Sin datos. Conéctate para sincronizar.'}</Body>
        )}
      </ScrollView>
      {v && store ? (
        <QuickEntry open={sheet} onOpen={() => setSheet(true)} onClose={() => setSheet(false)}>
          <MovementForm
            snapshot={v.snapshot}
            businessDate={v.snapshot.businessDate}
            newId={newId}
            onSubmit={record}
            onDone={() => setSheet(false)}
            onClose={() => setSheet(false)}
            onIsCollection={() => {
              setSheet(false);
              router.push('/registrar/cobro');
            }}
          />
        </QuickEntry>
      ) : null}
    </View>
  );
}
