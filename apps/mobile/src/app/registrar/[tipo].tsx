import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScrollView } from 'react-native';
import { useLocalView, useNecta } from '../../app-state/NectaProvider';
import { CommitmentForm, DebtPaymentForm, SaleForm } from '../../components/forms';
import { Body, colors, Segmented } from '../../components/ui';

const TABS = [
  { value: 'venta', label: 'Venta' },
  { value: 'cobro', label: 'Cobro' },
  { value: 'pago', label: 'Pago' },
  { value: 'compromiso', label: 'Fijo' },
] as const;
type Tab = (typeof TABS)[number]['value'];

export default function RecordScreen() {
  const { tipo } = useLocalSearchParams<{ tipo: Tab }>();
  const router = useRouter();
  const { record, newId, repo } = useNecta();
  const view = useLocalView();
  const snapshot = view.data?.snapshot;
  if (!snapshot) return <Body>Sin datos todavía.</Body>;
  const props = {
    snapshot,
    businessDate: snapshot.businessDate,
    newId,
    onSubmit: record,
    creatorOf: (id: string) => repo?.creatorOf(id) ?? Promise.resolve(null),
  };
  const tab: Tab = TABS.some((t) => t.value === tipo) ? (tipo as Tab) : 'venta';
  return (
    <ScrollView style={{ backgroundColor: colors.paper }} contentContainerStyle={{ padding: 16, paddingBottom: 48 }} keyboardShouldPersistTaps="handled">
      <Segmented label="Qué registrar" value={tab} onChange={(v) => router.setParams({ tipo: v })} options={[...TABS]} />
      {tab === 'venta' && <SaleForm {...props} />}
      {tab === 'cobro' && <DebtPaymentForm kind="receivable" {...props} />}
      {tab === 'pago' && <DebtPaymentForm kind="payable" {...props} />}
      {tab === 'compromiso' && <CommitmentForm {...props} />}
    </ScrollView>
  );
}
