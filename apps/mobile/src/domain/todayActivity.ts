import { todayActivity as sharedTodayActivity, type StoreSnapshot, type TodayActivity, type TodayItem } from '@necta/cash-engine';
import type { OutboxItem } from '../db/localRepository';

/** Lo confirmado (motor compartido, igual que la web) + operaciones locales aún no conciliadas. */
export function todayActivity(confirmed: StoreSnapshot, applied: StoreSnapshot, outbox: OutboxItem[]): TodayActivity {
  const names = new Map(applied.counterparties.map((c) => [c.id, c.name]));
  const extra: TodayItem[] = [];
  for (const o of outbox) {
    const state: TodayItem['state'] = o.status === 'conflict' || o.status === 'rejected' || o.status === 'blocked' ? 'problem' : 'pending';
    const op = o.operation;
    if (op.type === 'movement.create') {
      const m = op.payload.movement;
      extra.push({
        key: `o:mv:${o.clientMutationId}`,
        label: m.description || (m.kind === 'income' ? 'Ingreso' : 'Gasto'),
        amount: m.kind === 'income' ? m.amount : -m.amount,
        state,
        movementId: m.id,
        pendingClientMutationId: o.status === 'pending' ? o.clientMutationId : undefined,
        at: o.createdAt,
      });
    } else if (op.type === 'receivable.payment' || op.type === 'payable.payment') {
      const isReceivable = op.type === 'receivable.payment';
      const debt = (isReceivable ? applied.receivables : applied.payables).find((x) => x.id === op.entityId);
      extra.push({
        key: `o:${o.clientMutationId}`,
        label: `${isReceivable ? 'Cobro' : 'Pago'} ${debt?.counterpartyName ?? ''}`.trim(),
        amount: isReceivable ? op.payload.amount : -op.payload.amount,
        state,
        pendingClientMutationId: o.status === 'pending' ? o.clientMutationId : undefined,
        at: o.createdAt,
        payment: { kind: isReceivable ? 'receivable' : 'payable', debtId: op.entityId, clientMutationId: o.clientMutationId, amount: op.payload.amount, bankId: op.payload.bankId, paymentDate: op.payload.paymentDate },
      });
    } else if (op.type === 'sale.create') {
      const sale = op.payload.sale;
      const total = sale.items.reduce((a, i) => a + i.quantitiesSold * i.finalPrice, 0);
      const paid = sale.payments.reduce((a, p) => a + p.amount, 0);
      extra.push({ key: `o:${o.clientMutationId}`, label: `Venta ${names.get(sale.customerId) ?? ''}${paid < total ? ' (crédito)' : ''}`.trim(), amount: paid, state, at: o.createdAt });
    } else if (op.type === 'receivable.reschedule') {
      const r = applied.receivables.find((x) => x.id === op.entityId);
      extra.push({ key: `o:${o.clientMutationId}`, label: `${r?.counterpartyName ?? 'Cobro'} → ${op.payload.newDueDate.slice(5).split('-').reverse().join('/')}`, amount: 0, state, at: o.createdAt });
    }
  }
  // Movimientos confirmados con sus ediciones/borrados locales aplicados (sin duplicar altas pendientes).
  const touched = new Set(outbox.filter((o) => o.type === 'movement.update' || o.type === 'movement.delete').map((o) => o.entityId));
  const appliedById = new Map(applied.movements.map((m) => [m.id, m]));
  const movements = confirmed.movements
    .map((m) => appliedById.get(m.id) ?? m)
    .filter((m) => !m.deletedAt);
  const result = sharedTodayActivity(
    {
      businessDate: confirmed.businessDate,
      movements: movements as never,
      sales: confirmed.sales,
      receivables: confirmed.receivables as never,
      payables: confirmed.payables as never,
      baseline: applied.baseline,
    },
    extra,
  );
  for (const item of result.items) if (item.movementId && touched.has(item.movementId) && item.state === 'confirmed') item.state = 'pending';
  // Cobros/pagos con una anulación local aún no conciliada: ya no cuentan.
  const voided = new Set(
    outbox.flatMap((o) => (o.operation.type === 'receivable.payment.void' || o.operation.type === 'payable.payment.void' ? [o.operation.payload.paymentClientMutationId] : [])),
  );
  result.items = result.items.filter((i) => !(i.payment && voided.has(i.payment.clientMutationId)));
  return result;
}
