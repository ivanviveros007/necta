import { businessDateCaption, summarizeForecast, type TodayItem } from '@necta/cash-engine';
import { Redirect, Stack, useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, View } from 'react-native';
import { useLocalView, useNecta, useOutbox } from '../app-state/NectaProvider';
import { MovementEditContent, PaymentVoidContent, TodaySection } from '../components/collect';
import { ReceivableSheet } from '../components/ReceivableSheet';
import { MovementForm } from '../components/forms';
import { ActionChip, BalanceHeader, CashChart, CollectionsTable, HeaderTitle, KpiRow, PaymentsTable, SectionLink, SyncIndicator } from '../components/home';
import { Fab, OfflineNotice, Sheet } from '../components/sync';
import { Body, colors } from '../components/ui';
import { todayActivity } from '../domain/todayActivity';
import { useMovementEditor } from '../hooks/useMovementEditor';
import { useOnlineStatus } from '../hooks/useOnlineStatus';

type SheetState = { kind: 'entry' } | { kind: 'receivable'; id: string } | { kind: 'movement'; item: TodayItem } | { kind: 'payment'; item: TodayItem } | null;

/** Home: saldo, mínimo proyectado, gráfico, indicadores, acción, pagos con estado, cobros y hoy. */
export default function HomeScreen() {
  const { status, sync, expired, record, newId, store, repo, simulatedDate } = useNecta();
  const view = useLocalView();
  const outbox = useOutbox();
  const online = useOnlineStatus();
  const router = useRouter();
  const [sheet, setSheet] = useState<SheetState>(null);
  const editor = useMovementEditor();
  const v = view.data;
  const summary = useMemo(() => (v ? summarizeForecast(v.forecast, 30) : null), [v]);
  const today = useMemo(() => (v ? todayActivity(v.confirmed, v.snapshot, v.outbox) : null), [v]);

  if (status === 'loading') return <ActivityIndicator style={{ flex: 1 }} size="large" color={colors.brand} />;
  if (status === 'anonymous') return <Redirect href="/login" />;
  const editing =
    sheet?.kind === 'movement' && v
      ? (() => {
          const m = v.snapshot.movements.find((x) => x.id === sheet.item.movementId);
          return m ? { amount: m.amount, description: (m as { description?: string }).description ?? '', date: m.date, kind: m.kind } : null;
        })()
      : null;
  const problems = (outbox.data ?? []).filter((o) => o.status === 'conflict' || o.status === 'rejected' || o.status === 'blocked').length;
  const close = () => setSheet(null);
  const ctx = v
    ? { snapshot: v.snapshot, businessDate: v.snapshot.businessDate, dateCaption: businessDateCaption(v.snapshot.businessDate, simulatedDate), newId, onSubmit: record, creatorOf: (id: string) => repo?.creatorOf(id) ?? Promise.resolve(null), onDone: close }
    : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.paper }}>
      <Stack.Screen
        options={{
          headerTitle: () => <HeaderTitle name={store?.name ?? 'Necta'} badge={v && simulatedDate ? businessDateCaption(v.snapshot.businessDate, true) : null} />,
          headerRight: () => (
            <SyncIndicator sync={sync} pending={v?.pendingCount ?? 0} problems={problems} expired={expired} onPress={() => router.push('/sincronizacion')} />
          ),
        }}
      />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
        <OfflineNotice visible={online === false} />
        {v && summary && today ? (
          <>
            <BalanceHeader summary={summary} />
            <SectionLink title="Próximos 14 días" link="Día por día" onPress={() => router.push('/detalle')} />
            <CashChart days={v.forecast.scenarios.expected.days} />
            <KpiRow totals={summary.totals} />
            <ActionChip
              action={summary.primaryAction}
              onPress={() => {
                const a = summary.primaryAction;
                if (a && (a.kind === 'confirm_collection' || a.kind === 'collect') && a.sourceId) setSheet({ kind: 'receivable', id: a.sourceId });
                else router.push('/detalle');
              }}
            />
            <PaymentsTable payments={summary.payments} covered={summary.coveredCount} />
            <CollectionsTable items={summary.upcoming} onPress={(id) => setSheet({ kind: 'receivable', id })} />
            <TodaySection activity={today} onEdit={(item) => setSheet(item.payment ? { kind: 'payment', item } : { kind: 'movement', item })} />
          </>
        ) : (
          <Body>{sync?.phase === 'syncing' ? 'Sincronizando…' : 'Sin datos. Conéctate para sincronizar.'}</Body>
        )}
      </ScrollView>
      {v && ctx ? (
        <>
          <Fab onPress={() => setSheet({ kind: 'entry' })} />
          <Sheet open={sheet?.kind === 'entry'} onClose={close}>
            {sheet?.kind === 'entry' ? <MovementForm {...ctx} onClose={close} /> : null}
          </Sheet>
          <ReceivableSheet receivableId={sheet?.kind === 'receivable' ? sheet.id : null} onClose={close} />
          <Sheet open={sheet?.kind === 'payment'} onClose={close}>
            {sheet?.kind === 'payment' ? (
              <PaymentVoidContent
                item={sheet.item}
                bankName={v.snapshot.banks.find((b) => b.id === sheet.item.payment?.bankId)?.name ?? ''}
                onVoid={() => editor.voidPayment(sheet.item)}
                onClose={close}
              />
            ) : null}
          </Sheet>
          <Sheet open={sheet?.kind === 'movement'} onClose={close}>
            {sheet?.kind === 'movement' && editing ? (
              <MovementEditContent
                item={sheet.item}
                current={editing}
                snapshot={v.snapshot}
                businessDate={v.snapshot.businessDate}
                caption={businessDateCaption(v.snapshot.businessDate, simulatedDate)}
                onSave={(changes) => editor.save(sheet.item, changes)}
                onDelete={() => editor.remove(sheet.item)}
                onClose={close}
              />
            ) : null}
          </Sheet>
        </>
      ) : null}
    </View>
  );
}
