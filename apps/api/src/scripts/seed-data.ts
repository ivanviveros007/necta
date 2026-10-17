import { CASE_BALANCE_AS_OF, limpiaYaSnapshot } from '@necta/cash-engine';
import bcrypt from 'bcryptjs';
import type { Connection } from 'mongoose';
import { MODEL_DEFINITIONS, MODELS } from '../db/schemas';

export const DEMO_USER = {
  id: 'usr_carmen',
  email: 'carmen@limpiaya.test',
  password: 'Necta2026!',
  name: 'Carmen Ortiz',
};
export const DEMO_STORE_ID = 'store_limpia_ya';
export const DEMO_SUPPLIER_ID = 'sup_proveedor_principal';

/** Solo se permite sembrar/borrar en bases de demo o pruebas: nunca en bases ajenas. */
export function assertDemoDatabase(dbName: string): void {
  if (!/^necta_(demo|test)[a-z0-9_]*$/.test(dbName)) {
    throw new Error(`Base "${dbName}" no permitida para seed/reset (usa necta_demo o necta_test*)`);
  }
}

function models(conn: Connection) {
  for (const def of MODEL_DEFINITIONS) if (!conn.models[def.name]) conn.model(def.name, def.schema);
  return conn.models;
}

/** Borra solo documentos de la usuaria y tienda de demo (y lo derivado de esa tienda). */
export async function resetDemo(conn: Connection, storeIds: string[] = [DEMO_STORE_ID], userIds: string[] = [DEMO_USER.id]): Promise<void> {
  assertDemoDatabase(conn.db!.databaseName);
  const m = models(conn);
  const byStore = [
    MODELS.Bank, MODELS.Counterparty, MODELS.Receivable, MODELS.Payable, MODELS.Movement, MODELS.Commitment,
    MODELS.Sale, MODELS.Baseline, MODELS.BankAdjustment, MODELS.Operation, MODELS.ForecastSnapshot, MODELS.Alert,
    MODELS.NotificationDelivery,
  ];
  for (const name of byStore) await m[name]!.deleteMany({ storeId: { $in: storeIds } });
  await m[MODELS.Counter]!.deleteMany({ _id: { $in: storeIds } });
  await m[MODELS.ReviewQueue]!.deleteMany({ _id: { $in: storeIds } });
  await m[MODELS.Store]!.deleteMany({ _id: { $in: storeIds } });
  await m[MODELS.Device]!.deleteMany({ userId: { $in: userIds } });
  await m[MODELS.Preference]!.deleteMany({ _id: { $in: userIds } });
  await m[MODELS.User]!.deleteMany({ _id: { $in: userIds } });
}

/**
 * Siembra el caso «Limpia Ya» del enunciado con el mismo fixture que usan las pruebas del motor.
 * El saldo reconstruido se representa con openingBalance (no se inventan movimientos históricos).
 */
export async function seedDemo(conn: Connection, options: { withDevice?: boolean } = {}): Promise<void> {
  assertDemoDatabase(conn.db!.databaseName);
  const m = models(conn);
  await Promise.all(Object.values(m).map((model) => model.init()));
  await resetDemo(conn);

  const snap = limpiaYaSnapshot();
  const now = new Date();
  let seq = 0;
  const meta = () => ({ storeId: DEMO_STORE_ID, version: 1, seq: ++seq, updatedAt: now, deletedAt: null });

  await m[MODELS.User]!.create({
    _id: DEMO_USER.id,
    email: DEMO_USER.email,
    passwordHash: await bcrypt.hash(DEMO_USER.password, 10),
    name: DEMO_USER.name,
    storeIds: [DEMO_STORE_ID],
  });
  await m[MODELS.Store]!.create({ _id: DEMO_STORE_ID, ownerId: DEMO_USER.id, name: 'Limpia Ya', currency: snap.currency, timeZone: snap.timeZone });

  await m[MODELS.Bank]!.insertMany(
    snap.banks.map((b) => ({
      _id: b.id,
      ...meta(),
      name: b.name,
      storedLedgerBalance: b.storedLedgerBalance,
      reconstructedBalance: b.reconstructedBalance,
      openingBalance: b.reconstructedBalance,
      balanceAsOf: new Date(CASE_BALANCE_AS_OF),
    })),
  );
  await m[MODELS.Counterparty]!.insertMany([
    ...snap.counterparties.map((c) => ({ _id: c.id, ...meta(), name: c.name, kind: 'customer', aggregated: c.aggregated ?? false, history: c.history })),
    { _id: DEMO_SUPPLIER_ID, ...meta(), name: 'Proveedor principal', kind: 'supplier', aggregated: false, history: { payments: 0, onTime: 0, avgDaysLate: null } },
  ]);
  await m[MODELS.Receivable]!.insertMany(
    snap.receivables.map((r) => ({ _id: r.id, ...meta(), counterpartyId: r.counterpartyId, counterpartyName: r.counterpartyName, totalAmount: r.totalAmount, pendingAmount: r.pendingAmount, creditDueBy: r.creditDueBy, dueHint: r.dueHint ?? null, payments: [] })),
  );
  await m[MODELS.Payable]!.insertMany(
    snap.payables.map((p) => ({ _id: p.id, ...meta(), counterpartyId: DEMO_SUPPLIER_ID, counterpartyName: p.counterpartyName, totalAmount: p.totalAmount, pendingAmount: p.pendingAmount, creditDueBy: p.creditDueBy, negotiable: p.negotiable, payments: [] })),
  );
  await m[MODELS.Commitment]!.insertMany(
    snap.commitments.map((c) => ({ _id: c.id, ...meta(), direction: c.direction, concept: c.concept, amount: c.amount, schedule: c.schedule, negotiable: c.negotiable })),
  );
  await m[MODELS.Baseline]!.create({ _id: `baseline_${DEMO_STORE_ID}`, ...meta(), ...snap.baseline! });
  await m[MODELS.Counter]!.create({ _id: DEMO_STORE_ID, seq });
  await m[MODELS.Preference]!.create({ _id: DEMO_USER.id });
  if (options.withDevice) {
    await m[MODELS.Device]!.create({
      _id: 'ExponentPushToken[SIMULADO-demo-local]',
      userId: DEMO_USER.id,
      expoPushToken: 'ExponentPushToken[SIMULADO-demo-local]',
      platform: 'ios',
      timeZone: snap.timeZone,
      updatedAt: now,
    });
  }
}
