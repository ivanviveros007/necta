import { MODELS } from '../src/db/schemas';
import { cmid, createTestApp, mobile, mobileToken, seedAll, type TestApp } from './helpers';

describe('Reprogramar un cobro', () => {
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

  it('cambia el vencimiento, guarda el original y la proyección lo refleja', async () => {
    const res = await api.post('/v2/receivables/rcv_brisas/reschedule').send({ clientMutationId: cmid(), baseVersion: 1, newDueDate: '2026-06-02' }).expect(201);
    expect(res.body.entity).toMatchObject({ creditDueBy: '2026-06-02', originalDueBy: '2026-05-28', version: 2 });
    const f = await api.get('/v2/forecast/14d').expect(200);
    expect(f.body.scenarios.expected.firstShortfall).toMatchObject({ date: '2026-05-29', amount: 590_000 });
  });

  it('versión vieja: conflicto; fecha pasada o deuda pagada: rechazo', async () => {
    await api.post('/v2/receivables/rcv_brisas/reschedule').send({ clientMutationId: cmid(), baseVersion: 1, newDueDate: '2026-06-02' }).expect(201);
    const conflict = await api.post('/v2/receivables/rcv_brisas/reschedule').send({ clientMutationId: cmid(), baseVersion: 1, newDueDate: '2026-06-03' }).expect(409);
    expect(conflict.body.code).toBe('VERSION_CONFLICT');
    const past = await api.post('/v2/receivables/rcv_esquina/reschedule').send({ clientMutationId: cmid(), baseVersion: 1, newDueDate: '2026-05-20' }).expect(400);
    expect(past.body.code).toBe('VALIDATION_ERROR');
    await api.post('/v2/receivables/rcv_fina/payments').send({ clientMutationId: cmid(), bankId: 'bank_caja', amount: 600_000, paymentDate: '2026-05-25' }).expect(201);
    const settled = await api.post('/v2/receivables/rcv_fina/reschedule').send({ clientMutationId: cmid(), baseVersion: 2, newDueDate: '2026-06-02' }).expect(422);
    expect(settled.body.code).toBe('DEBT_ALREADY_SETTLED');
  });

  it('la puntualidad se mide contra el vencimiento original', async () => {
    await api.post('/v2/receivables/rcv_brisas/reschedule').send({ clientMutationId: cmid(), baseVersion: 1, newDueDate: '2026-06-05' }).expect(201);
    // Fecha de negocio fija 2026-05-25: el pago llega antes del original, cuenta a tiempo.
    await api.post('/v2/receivables/rcv_brisas/payments').send({ clientMutationId: cmid(), bankId: 'bank_banco', amount: 2_100_000, paymentDate: '2026-05-25' }).expect(201);
    const cp = await t.conn.model(MODELS.Counterparty).findById('cli_hotel_brisas').lean<{ history: { payments: number; onTime: number } }>();
    expect(cp!.history).toMatchObject({ payments: 7, onTime: 7 });
  });

  it('por sync push también es idempotente', async () => {
    const op = { clientMutationId: 'op_r', type: 'receivable.reschedule', entityId: 'rcv_brisas', baseVersion: 1, payload: { newDueDate: '2026-06-02' } };
    const a = await api.post('/v2/sync/push').send({ operations: [op] }).expect(200);
    const b = await api.post('/v2/sync/push').send({ operations: [op] }).expect(200);
    expect(a.body.results[0].status).toBe('applied');
    expect(b.body.results[0]).toMatchObject({ status: 'duplicate', seq: a.body.results[0].seq });
  });
});
