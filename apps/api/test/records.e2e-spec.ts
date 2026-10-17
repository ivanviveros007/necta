import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { MODELS } from '../src/db/schemas';
import { StoreEvents } from '../src/events/store-events';
import { bank, cmid, createTestApp, mobile, mobileToken, receivable, seedAll, webSession, type TestApp } from './helpers';

describe('Registro: idempotencia, transacciones y reglas', () => {
  let t: TestApp;
  let api: ReturnType<typeof mobile>;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => {
    await seedAll(t.conn);
    api = mobile(t, await mobileToken(t));
  });
  afterAll(async () => t.close());

  const pay = (id: string, body: Record<string, unknown>) => api.post(`/v2/receivables/${id}/payments`).send(body);

  describe('cobro parcial (contrato existente)', () => {
    it('reduce el pendiente, sube la caja y no crea un ingreso independiente', async () => {
      const res = await pay('rcv_sol', { clientMutationId: cmid(), bankId: 'bank_caja', amount: 300_000, method: 'transferencia', paymentDate: '2026-05-25' }).expect(201);
      expect(res.body.entity).toMatchObject({ counterpartyName: 'Minimercado Sol', totalAmount: 1_200_000, pendingAmount: 900_000, creditDueBy: '2026-05-05' });
      expect((await bank(t.conn, 'bank_caja'))!.storedLedgerBalance).toBe(900_000);
      expect(await t.conn.model(MODELS.Movement).countDocuments()).toBe(0);
      const cp = await t.conn.model(MODELS.Counterparty).findById('cli_minimercado_sol').lean<{ history: { payments: number; onTime: number; avgDaysLate: number } }>();
      // Pago 20 días tarde: 5 pagos, 1 a tiempo, promedio (18·3 + 20)/4.
      expect(cp!.history).toEqual({ payments: 5, onTime: 1, avgDaysLate: 18.5 });
    });

    it('GET /v2/receivables/:id conserva los campos del anexo', async () => {
      const res = await api.get('/v2/receivables/rcv_sol').expect(200);
      expect(res.body).toMatchObject({ counterpartyName: 'Minimercado Sol', totalAmount: 1_200_000, pendingAmount: 1_200_000, creditDueBy: '2026-05-05' });
    });

    it('cobro mayor al pendiente se rechaza sin efectos', async () => {
      const res = await pay('rcv_sol', { clientMutationId: cmid(), bankId: 'bank_caja', amount: 1_300_000, paymentDate: '2026-05-25' }).expect(422);
      expect(res.body.code).toBe('PAYMENT_EXCEEDS_PENDING');
      expect((await receivable(t.conn, 'rcv_sol'))!.pendingAmount).toBe(1_200_000);
      expect((await bank(t.conn, 'bank_caja'))!.storedLedgerBalance).toBe(600_000);
    });

    it('cobro sobre deuda cancelada se rechaza', async () => {
      await pay('rcv_fina', { clientMutationId: cmid(), bankId: 'bank_caja', amount: 600_000, paymentDate: '2026-05-25' }).expect(201);
      const res = await pay('rcv_fina', { clientMutationId: cmid(), bankId: 'bank_caja', amount: 1, paymentDate: '2026-05-25' }).expect(422);
      expect(res.body.code).toBe('DEBT_ALREADY_SETTLED');
    });

    it('fecha futura y monto inválido', async () => {
      const future = await pay('rcv_sol', { clientMutationId: cmid(), bankId: 'bank_caja', amount: 1000, paymentDate: '2026-05-26' }).expect(422);
      expect(future.body.code).toBe('FUTURE_DATE_NOT_ALLOWED');
      const invalid = await pay('rcv_sol', { clientMutationId: cmid(), bankId: 'bank_caja', amount: -5, paymentDate: '2026-05-25' }).expect(400);
      expect(invalid.body.code).toBe('VALIDATION_ERROR');
    });
  });

  describe('idempotencia', () => {
    const body = () => ({ clientMutationId: 'm_cobro_1', bankId: 'bank_caja', amount: 300_000, paymentDate: '2026-05-25' });

    it('reintento idéntico: un solo efecto y la segunda respuesta replica el resultado', async () => {
      const first = await pay('rcv_sol', body()).expect(201);
      const second = await pay('rcv_sol', body()).expect(200);
      expect(second.headers['idempotent-replayed']).toBe('true');
      expect(second.body).toEqual(first.body);
      expect((await receivable(t.conn, 'rcv_sol'))!.pendingAmount).toBe(900_000);
      expect((await bank(t.conn, 'bank_caja'))!.storedLedgerBalance).toBe(900_000);
    });

    it('reintentos concurrentes: solo uno aplica', async () => {
      const results = await Promise.all(Array.from({ length: 6 }, () => pay('rcv_sol', body())));
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 200, 200, 201]);
      expect((await receivable(t.conn, 'rcv_sol'))!.payments).toHaveLength(1);
      expect((await bank(t.conn, 'bank_caja'))!.storedLedgerBalance).toBe(900_000);
      expect(await t.conn.model(MODELS.Operation).countDocuments({ clientMutationId: 'm_cobro_1' })).toBe(1);
    });

    it('mismo id con otro payload: 409 IDEMPOTENCY_PAYLOAD_MISMATCH sin cambios', async () => {
      await pay('rcv_sol', body()).expect(201);
      const res = await pay('rcv_sol', { ...body(), amount: 400_000 }).expect(409);
      expect(res.body.code).toBe('IDEMPOTENCY_PAYLOAD_MISMATCH');
      expect((await receivable(t.conn, 'rcv_sol'))!.pendingAmount).toBe(900_000);
    });

    it('caída tras el commit y antes de responder: el reintento es seguro', async () => {
      const events = t.app.get(StoreEvents);
      const spy = jest.spyOn(events, 'emitChanged').mockImplementationOnce(() => {
        throw new Error('caída simulada después del commit');
      });
      await pay('rcv_sol', body()).expect(500);
      spy.mockRestore();
      const retry = await pay('rcv_sol', body()).expect(200);
      expect(retry.headers['idempotent-replayed']).toBe('true');
      expect((await receivable(t.conn, 'rcv_sol'))!.pendingAmount).toBe(900_000);
      expect((await bank(t.conn, 'bank_caja'))!.storedLedgerBalance).toBe(900_000);
    });
  });

  describe('transacciones', () => {
    it('una falla a mitad de la operación no deja efectos parciales', async () => {
      const receivables = t.app.get<Model<unknown>>(getModelToken(MODELS.Receivable));
      const spy = jest.spyOn(receivables, 'create').mockRejectedValueOnce(new Error('falla simulada') as never);
      const op = {
        batchId: 'b_tx',
        sales: [{ clientMutationId: 'm_tx', sale: { id: 'sale_tx', customerId: 'cli_hotel_brisas', items: [{ itemId: 'prod_cloro_5l', quantitiesSold: 10, finalPrice: 50_000 }], payments: [{ bankId: 'bank_caja', amount: 100_000, paymentDate: '2026-05-25' }], saleDate: '2026-05-25' } }],
      };
      await api.post('/v2/sale/batch').send(op).expect(500);
      spy.mockRestore();
      expect((await bank(t.conn, 'bank_caja'))!.storedLedgerBalance).toBe(600_000);
      expect(await t.conn.model(MODELS.Sale).countDocuments({ _id: 'sale_tx' })).toBe(0);
      expect(await t.conn.model(MODELS.Operation).countDocuments({ clientMutationId: 'm_tx' })).toBe(0);
      // El reintento después de la falla se aplica completo.
      const ok = await api.post('/v2/sale/batch').send(op).expect(200);
      expect(ok.body.results[0].status).toBe('applied');
      expect((await bank(t.conn, 'bank_caja'))!.storedLedgerBalance).toBe(700_000);
      expect((await receivable(t.conn, 'sale_tx'))!.pendingAmount).toBe(400_000);
    });
  });

  describe('ventas por lote (contrato existente)', () => {
    const anexo = (overrides: Record<string, unknown> = {}) => ({
      batchId: 'b_7f21',
      sales: [{ clientMutationId: 'm_0193', sale: { customerId: 'cli_hotel_brisas', items: [{ itemId: 'prod_cloro_5l', quantitiesSold: 40, finalPrice: 52_500 }], payments: [], saleDate: '2026-05-14', ...overrides } }],
    });

    it('venta sin pagos crea cuenta por cobrar; sin expiresAt vence a los 30 días', async () => {
      const res = await api.post('/v2/sale/batch').send(anexo()).expect(200);
      expect(res.body.results[0]).toMatchObject({ status: 'applied', entityType: 'sale' });
      const rcv = await api.get('/v2/receivables/sale_m_0193').expect(200);
      expect(rcv.body).toMatchObject({ totalAmount: 2_100_000, pendingAmount: 2_100_000, creditDueBy: '2026-06-13', counterpartyName: 'Hotel Brisas' });
      // A crédito: no sube la caja.
      expect((await bank(t.conn, 'bank_caja'))!.storedLedgerBalance).toBe(600_000);
    });

    it('mismo lote dos veces no duplica; con datos distintos responde 409', async () => {
      await api.post('/v2/sale/batch').send(anexo({ expiresAt: '2026-05-28' })).expect(200);
      const again = await api.post('/v2/sale/batch').send(anexo({ expiresAt: '2026-05-28' })).expect(200);
      expect(again.body.results[0].status).toBe('duplicate');
      expect(await t.conn.model(MODELS.Receivable).countDocuments({ sourceSaleId: 'sale_m_0193' })).toBe(1);
      await api.post('/v2/sale/batch').send(anexo({ expiresAt: '2026-05-30' })).expect(409);
    });
  });

  describe('saldo guardado vs reconstruido', () => {
    it('la proyección del bolsillo coincide con el anexo', async () => {
      const res = await api.get('/v2/banks/bank_banco/projection').expect(200);
      expect(res.body).toEqual({ storedLedgerBalance: 1_300_000, projectedBalance: 1_040_000, alignmentDelta: 260_000 });
    });

    it('carga histórica: no cambia el guardado, sí el reconstruido y la diferencia', async () => {
      await api.post('/v2/movements').send({ clientMutationId: cmid(), movement: { id: 'mv_hist', kind: 'income', amount: 120_000, bankId: 'bank_banco', date: '2026-05-20', description: 'Venta del cuaderno' } }).expect(201);
      const res = await api.get('/v2/banks/bank_banco/projection').expect(200);
      expect(res.body).toEqual({ storedLedgerBalance: 1_300_000, projectedBalance: 1_160_000, alignmentDelta: 140_000 });
      expect((await bank(t.conn, 'bank_banco'))!.reconstructedBalance).toBe(1_160_000);
    });

    it('ajuste explícito trazable', async () => {
      const res = await api.post('/v2/banks/bank_banco/adjustments').send({ clientMutationId: cmid(), newBalance: 1_040_000, reason: 'Conté el banco' }).expect(201);
      expect(res.body.entity).toMatchObject({ storedLedgerBalance: 1_040_000 });
      expect(await t.conn.model(MODELS.BankAdjustment).countDocuments({ bankId: 'bank_banco', previousBalance: 1_300_000 })).toBe(1);
      const proj = await api.get('/v2/banks/bank_banco/projection').expect(200);
      expect(proj.body.alignmentDelta).toBe(0);
    });
  });

  describe('movimientos y conflictos de versión', () => {
    const gasto = { clientMutationId: 'm_g1', movement: { id: 'mv_g1', kind: 'expense', amount: 90_000, bankId: 'bank_caja', date: '2026-05-25' } };

    it('editar y borrar ajustan el saldo; el borrado es lógico', async () => {
      await api.post('/v2/movements').send(gasto).expect(201);
      expect((await bank(t.conn, 'bank_caja'))!.storedLedgerBalance).toBe(510_000);
      await api.patch('/v2/movements/mv_g1').send({ clientMutationId: cmid(), baseVersion: 1, changes: { amount: 100_000 } }).expect(201);
      expect((await bank(t.conn, 'bank_caja'))!.storedLedgerBalance).toBe(500_000);
      const del = await api.delete('/v2/movements/mv_g1').send({ clientMutationId: cmid(), baseVersion: 2 }).expect(201);
      expect(del.body.entity.deletedAt).toEqual(expect.any(String));
      expect((await bank(t.conn, 'bank_caja'))!.storedLedgerBalance).toBe(600_000);
    });

    it('web y móvil editan el mismo compromiso: el segundo recibe 409 VERSION_CONFLICT con el estado remoto', async () => {
      const web = await webSession(t);
      await web.patch('/v2/commitments/cmt_arriendo').send({ clientMutationId: cmid(), baseVersion: 1, changes: { amount: 1_350_000 } }).expect(201);
      const res = await api.patch('/v2/commitments/cmt_arriendo').send({ clientMutationId: cmid(), baseVersion: 1, changes: { amount: 1_250_000 } }).expect(409);
      expect(res.body.code).toBe('VERSION_CONFLICT');
      expect(res.body.details.remote.entity).toMatchObject({ id: 'cmt_arriendo', version: 2, amount: 1_350_000 });
      // No hay sobrescritura silenciosa.
      const after = await api.get('/v2/commitments').expect(200);
      expect(after.body.find((c: { id: string }) => c.id === 'cmt_arriendo').amount).toBe(1_350_000);
    });

    it('compromiso inválido: 400 con el campo', async () => {
      const res = await api
        .post('/v2/commitments')
        .send({ clientMutationId: cmid(), commitment: { id: 'c_bad', direction: 'outflow', concept: 'X', amount: 0, schedule: { kind: 'monthly', daysOfMonth: [40], startDate: '2026-01-01' } } })
        .expect(400);
      expect(res.body.details.map((d: { path: string }) => d.path)).toEqual(expect.arrayContaining(['commitment.amount', 'commitment.schedule.daysOfMonth.0']));
    });

    it('base de contado: crear con versión 0 y editar con versión vigente', async () => {
      const current = await api.get('/v2/cash-baseline').expect(200);
      expect(current.body.version).toBe(1);
      const weekly = { weekdaySales: [0, 300_000, 260_000, 260_000, 260_000, 520_000, 520_000], weekdayExpenses: [0, 90_000, 90_000, 90_000, 90_000, 90_000, 90_000] };
      await api.put('/v2/cash-baseline').send({ clientMutationId: cmid(), baseVersion: 0, baseline: weekly }).expect(409);
      const ok = await api.put('/v2/cash-baseline').send({ clientMutationId: cmid(), baseVersion: 1, baseline: weekly }).expect(201);
      expect(ok.body.entity.weekdaySales[1]).toBe(300_000);
    });
  });
});
