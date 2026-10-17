import { formatMoneyCompact } from '@necta/cash-engine';
import { useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { useLocalView } from '../app-state/NectaProvider';
import { ActionsTable, AssumptionsToggle, DayTable, UnscheduledTable } from '../components/detail';
import { ReceivableSheet } from '../components/ReceivableSheet';
import { SectionTitle } from '../components/home';
import { Body, colors, Segmented } from '../components/ui';

export default function DetailScreen() {
  const view = useLocalView();
  const [scenario, setScenario] = useState<'expected' | 'conservative'>('expected');
  const [receivableId, setReceivableId] = useState<string | null>(null);
  const f = view.data?.forecast;
  if (!f) return <Body>Sin datos</Body>;
  const removed = f.scenarios.conservative.removedInflow;
  return (
    <>
      <ScrollView style={{ backgroundColor: colors.paper }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }}>
        <Segmented label="Escenario" value={scenario} onChange={setScenario} options={[{ value: 'expected', label: 'Esperado' }, { value: 'conservative', label: 'Conservador' }]} />
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 4 }}>
          {view.data?.provisional ? <Chip text={`${view.data.pendingCount} pendientes`} tone={colors.warn} /> : null}
          {scenario === 'conservative' && removed ? <Chip text={`Sin ${removed.label.replace(/^Cobro /, '')} (−${formatMoneyCompact(removed.amount).replace('$ ', '')})`} tone={colors.bad} /> : null}
        </View>
        <DayTable scenario={f.scenarios[scenario]} />
        <SectionTitle>Acciones</SectionTitle>
        <ActionsTable actions={f.actions} onReceivable={setReceivableId} />
        <SectionTitle>Por cobrar sin fecha (no suma)</SectionTitle>
        <UnscheduledTable items={f.unscheduledReceivables} onReceivable={setReceivableId} />
        <AssumptionsToggle assumptions={f.assumptions} />
      </ScrollView>
      <ReceivableSheet receivableId={receivableId} onClose={() => setReceivableId(null)} />
    </>
  );
}

function Chip({ text, tone }: { text: string; tone: string }) {
  return (
    <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1.5, borderColor: tone }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: tone }}>{text}</Text>
    </View>
  );
}
