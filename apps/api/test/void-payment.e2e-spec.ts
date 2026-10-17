import { MODELS } from '../src/db/schemas';
import { bank, cmid, createTestApp, mobile, mobileToken, receivable, seedAll, webSession, type TestApp } from './helpers';

describe('Anular un cobro o pago', () => {
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

  const collectFina = (id = 'pay_c1') =>
    api.post('/v2/receivables/rcv_fina/payments').send({ clientMutationId: id, bankId: 'bank_caja', amount: 600_000, paymentDate: '2026-05-25' }).expect(201);

  it('devuelve el monto a la deuda, revierte la caja, deja el rastro y corrige la puntualidad', async () => {
    await collectFina();
    expect((await bank(t.conn, 'bank_caja'))!.storedLedgerBalance).toBe(1_200_000);
    const res = await api.post('/v2/receivables/rcv_fina/payments/pay_c1/void').send({ clientMutationId: cmid() }).expect(201);
    expect(res.body.entity.pendingAmount).toBe(600_000);
    expect(res.body.entity.payments[0]).toMatchObject({ clientMutationId: 'pay_c1', voidedAt: expect.any(String) });
    expect((await bank(t.conn, 'bank_caja'))!.storedLedgerBalance).toBe(600_000);
    const cp = await t.conn.model(MODELS.Counterparty).findById('cli_tienda_dona_fina').lean<{ history: { payments: number; onTime: number } }>();
    expect(cp!.history).toMatchObject({ payments: 4, onTime: 4 });
    // La reconstrucción del saldo ignora el pago anulado.
    const proj = await api.get('/v2/banks/bank_caja/projection').expect(200);
    expect(proj.body).toEqual({ storedLedgerBalance: 600_000, projectedBalance: 600_000, alignmentDelta: 0 });
    // La proyección vuelve a contar con el cobro del viernes 29.
    const f = await api.get('/v2/forecast/14d').expect(200);
    expect(f.body.scheduledReceivables.some((s: { receivableId: string }) => s.receivableId === 'rcv_fina')).toBe(true);
  });

  it('idempotente; anular dos veces con otra operación se rechaza', async () => {
    await collectFina();
    const op = { clientMutationId: 'void_1' };
    await api.post('/v2/receivables/rcv_fina/payments/pay_c1/void').send(op).expect(201);
    await api.post('/v2/receivables/rcv_fina/payments/pay_c1/void').send(op).expect(200);
    const again = await api.post('/v2/receivables/rcv_fina/payments/pay_c1/void').send({ clientMutationId: cmid() }).expect(422);
    expect(again.body.code).toBe('PAYMENT_ALREADY_VOIDED');
    expect((await receivable(t.conn, 'rcv_fina'))!.pendingAmount).toBe(600_000);
  });

  it('por sync: datos que no coinciden con el pago guardado se rechazan', async () => {
    await collectFina();
    const res = await api
      .post('/v2/sync/push')
      .send({ operations: [{ clientMutationId: cmid(), type: 'receivable.payment.void', entityId: 'rcv_fina', payload: { paymentClientMutationId: 'pay_c1', amount: 1, bankId: 'bank_caja', paymentDate: '2026-05-25' } }] })
      .expect(200);
    expect(res.body.results[0]).toMatchObject({ status: 'rejected', error: { code: 'VALIDATION_ERROR' } });
  });

  it('pago al proveedor anulado desde la web', async () => {
    await api.post('/v2/payables/pay_proveedor/payments').send({ clientMutationId: 'pp1', bankId: 'bank_banco', amount: 1_000_000, paymentDate: '2026-05-25' }).expect(201);
    const web = await webSession(t);
    const res = await web.post('/v2/payables/pay_proveedor/payments/pp1/void').send({ clientMutationId: cmid() }).expect(201);
    expect(res.body.entity.pendingAmount).toBe(4_200_000);
    expect((await bank(t.conn, 'bank_banco'))!.storedLedgerBalance).toBe(1_300_000);
  });

  it('pago inexistente: 404', async () => {
    await api.post('/v2/receivables/rcv_fina/payments/nope/void').send({ clientMutationId: cmid() }).expect(404);
  });
});
