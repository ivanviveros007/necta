import { CASE_EXPECTED_CLOSINGS } from '@necta/cash-engine';
import { io, type Socket } from 'socket.io-client';
import { SimulationState } from '../src/alerts/adapters';
import { DeliveryService } from '../src/alerts/delivery.service';
import { ReviewService } from '../src/alerts/review.service';
import { MODELS } from '../src/db/schemas';
import { DEMO_USER } from '../src/scripts/seed-data';
import { cmid, createTestApp, mobile, mobileToken, ORIGIN, seedAll, STORE, webSession, type TestApp } from './helpers';

describe('Proyección, alertas y tiempo real', () => {
  let t: TestApp;
  let api: ReturnType<typeof mobile>;
  let review: ReviewService;
  let deliveries: DeliveryService;
  let sim: SimulationState;

  beforeAll(async () => {
    t = await createTestApp({ listen: true });
    review = t.app.get(ReviewService);
    deliveries = t.app.get(DeliveryService);
    sim = t.app.get(SimulationState);
  });
  beforeEach(async () => {
    await seedAll(t.conn);
    await t.conn.model(MODELS.ReviewQueue).deleteMany({});
    sim.reset();
    api = mobile(t, await mobileToken(t));
  });
  afterAll(async () => t.close());

  const deliveriesOf = () => t.conn.model(MODELS.NotificationDelivery).find({ storeId: STORE }).sort({ createdAt: 1 }).lean<Array<{ channel: string; status: string; attempts: number; recipient: string; nextAttemptAt: Date | null; lastError: string | null }>>();

  describe('GET /v2/forecast/14d', () => {
    it('reproduce los 14 días del caso y guarda un snapshot trazable', async () => {
      const res = await api.get('/v2/forecast/14d').expect(200);
      const closings = Object.fromEntries(res.body.scenarios.expected.days.map((d: { date: string; closing: number }) => [d.date, d.closing]));
      expect(closings).toEqual(CASE_EXPECTED_CLOSINGS);
      expect(res.body).toMatchObject({ status: 'short', cutoff: '2026-05-25T05:00:00.000Z', provisional: false, storeId: STORE });
      expect(res.body.reference).toMatchObject({ storedBalance: 1_900_000, reconstructedBalance: 1_640_000, alignmentDelta: 260_000 });
      expect(res.body.actions[0].title).toBe('Confirma el pago de Hotel Brisas');
      const snap = await t.conn.model(MODELS.ForecastSnapshot).findOne({ storeId: STORE }).lean<{ cutoff: string; dataVersion: number; result: { assumptions: unknown[] } }>();
      expect(snap).toMatchObject({ cutoff: '2026-05-25T05:00:00.000Z', dataVersion: res.body.dataVersion });
      expect(snap!.result.assumptions.length).toBeGreaterThan(3);
    });

    it('cobro parcial: caja, deuda y proyección consistentes sin doble conteo', async () => {
      await api.post('/v2/receivables/rcv_brisas/payments').send({ clientMutationId: cmid(), bankId: 'bank_banco', amount: 500_000, paymentDate: '2026-05-25' }).expect(201);
      const res = await api.get('/v2/forecast/14d').expect(200);
      expect(res.body.reference.storedBalance).toBe(2_400_000);
      expect(res.body.scheduledReceivables.find((s: { receivableId: string }) => s.receivableId === 'rcv_brisas').amount).toBe(1_600_000);
      expect(res.body.scenarios.expected.days.find((d: { date: string }) => d.date === '2026-05-28').closing).toBe(4_680_000);
    });

    it('gasto registrado hoy reemplaza parte de la base: el cierre de hoy no cambia', async () => {
      await api.post('/v2/movements').send({ clientMutationId: cmid(), movement: { id: 'mv_hoy', kind: 'expense', amount: 40_000, bankId: 'bank_caja', date: '2026-05-25' } }).expect(201);
      const res = await api.get('/v2/forecast/14d').expect(200);
      expect(res.body.reference.storedBalance).toBe(1_860_000);
      expect(res.body.scenarios.expected.days[0].closing).toBe(2_070_000);
    });
  });

  describe('revisión y alertas', () => {
    it('los cambios se agrupan en una sola revisión por tienda', async () => {
      for (let i = 0; i < 5; i++) {
        await api.post('/v2/movements').send({ clientMutationId: cmid(), movement: { id: `mv_b${i}`, kind: 'income', amount: 1000, bankId: 'bank_caja', date: '2026-05-25' } }).expect(201);
      }
      const queued = await t.conn.model(MODELS.ReviewQueue).find({}).lean<Array<{ _id: string; dueAt: Date }>>();
      expect(queued).toHaveLength(1);
      expect(await review.processDue(new Date())).toHaveLength(0); // el lote aún no vence
      const done = await review.processDue(new Date(Date.now() + 60_000));
      expect(done).toEqual([{ storeId: STORE, decision: 'created' }]);
    });

    it('alerta persistida y deduplicada; sin dispositivo se avisa por correo', async () => {
      expect(await review.reviewStore(STORE)).toBe('created');
      expect(await review.reviewStore(STORE)).toBe('unchanged');
      const alerts = await api.get('/v2/alerts').expect(200);
      expect(alerts.body).toHaveLength(1);
      expect(alerts.body[0]).toMatchObject({ status: 'active', scenario: 'expected', shortfallDate: '2026-06-01', amount: 590_000, notifiedCount: 1 });
      const d = await deliveriesOf();
      expect(d).toHaveLength(1);
      expect(d[0]).toMatchObject({ channel: 'email', status: 'pending', recipient: DEMO_USER.email });
      await deliveries.processDue();
      expect((await deliveriesOf())[0]!.status).toBe('sent');
    });

    it('vuelve a notificar si el faltante empeora más de 10 % y resuelve cuando se cubre', async () => {
      await review.reviewStore(STORE);
      await api.post('/v2/movements').send({ clientMutationId: cmid(), movement: { id: 'mv_big', kind: 'expense', amount: 300_000, bankId: 'bank_caja', date: '2026-05-25' } }).expect(201);
      expect(await review.reviewStore(STORE)).toBe('escalated');
      expect(await deliveriesOf()).toHaveLength(2);

      // Cobro de Sol + La Esquina hoy: el escenario esperado ya no tiene faltante.
      await api.post('/v2/receivables/rcv_sol/payments').send({ clientMutationId: cmid(), bankId: 'bank_caja', amount: 1_200_000, paymentDate: '2026-05-25' }).expect(201);
      await api.post('/v2/receivables/rcv_esquina/payments').send({ clientMutationId: cmid(), bankId: 'bank_caja', amount: 850_000, paymentDate: '2026-05-25' }).expect(201);
      const decision = await review.reviewStore(STORE);
      const alerts = (await api.get('/v2/alerts').expect(200)).body as Array<{ status: string; severity: string }>;
      expect(alerts.find((a) => a.status === 'resolved')).toBeTruthy();
      expect(['created', 'resolved']).toContain(decision);
    });

    it('push con recibo de error → falla registrada y respaldo por correo', async () => {
      await t.http.post('/v2/push-notifications/device').set('authorization', `Bearer ${await mobileToken(t)}`).send({ expoPushToken: 'ExponentPushToken[test-device]', platform: 'ios', timeZone: 'America/Bogota' }).expect(200);
      sim.pushReceipt = 'error';
      await review.reviewStore(STORE);
      await deliveries.processDue();
      let d = await deliveriesOf();
      expect(d).toHaveLength(1);
      expect(d[0]).toMatchObject({ channel: 'push', status: 'sent' }); // aceptado ≠ entregado
      await deliveries.checkReceipts(new Date(Date.now() + 60_000));
      d = await deliveriesOf();
      expect(d[0]).toMatchObject({ channel: 'push', status: 'failed' });
      expect(d[1]).toMatchObject({ channel: 'email', status: 'pending' });
    });

    it('falla temporal del correo: reintento con espera y luego enviado', async () => {
      sim.emailFailNext = 1;
      await review.reviewStore(STORE);
      await deliveries.processDue();
      let [d] = await deliveriesOf();
      expect(d).toMatchObject({ status: 'retry', attempts: 1 });
      expect(d!.lastError).toContain('503');
      expect(d!.nextAttemptAt!.getTime()).toBeGreaterThan(Date.now());
      await deliveries.processDue(new Date(Date.now() + 10 * 60_000));
      [d] = await deliveriesOf();
      expect(d).toMatchObject({ status: 'sent', attempts: 2 });
    });

    it('preferencia desactivada: alerta persistente sin envíos', async () => {
      await api.put('/v2/push-notifications/preferences').send({ cashShortfall: false }).expect(200);
      await review.reviewStore(STORE);
      expect(await deliveriesOf()).toHaveLength(0);
      expect((await api.get('/v2/alerts').expect(200)).body).toHaveLength(1);
    });

    it('la revisión diaria se encola una sola vez por fecha', async () => {
      const at8 = new Date('2026-05-25T13:00:00Z'); // 08:00 en Bogotá
      // Dos tiendas sembradas (Limpia Ya y la de aislamiento), ambas en Bogotá.
      expect(await review.enqueueDaily(at8)).toBe(2);
      expect(await review.enqueueDaily(at8)).toBe(0);
      const queued = await t.conn.model(MODELS.ReviewQueue).find({}).lean<Array<{ _id: string }>>();
      expect(queued.map((q) => q._id)).toContain(STORE);
      const at6 = new Date('2026-05-25T11:00:00Z');
      await t.conn.model(MODELS.Store).updateMany({}, { $set: { lastDailyReviewDate: null } });
      expect(await review.enqueueDaily(at6)).toBe(0);
    });

    it('la revisión pendiente sobrevive un reinicio (cola persistida)', async () => {
      await review.enqueue(STORE, 'test', 0);
      const fresh = await createTestApp();
      try {
        const done = await fresh.app.get(ReviewService).processDue(new Date(Date.now() + 1000));
        expect(done.map((d) => d.storeId)).toEqual([STORE]);
      } finally {
        await fresh.close();
      }
    });
  });

  describe('tiempo real', () => {
    const url = () => {
      const address = t.app.getHttpServer().address() as { port: number };
      return `http://127.0.0.1:${address.port}`;
    };

    function connect(options: Parameters<typeof io>[1]): Promise<Socket> {
      return new Promise((resolve, reject) => {
        const socket = io(url(), { path: '/socket.io', transports: ['websocket'], reconnection: false, ...options });
        socket.on('ready', () => resolve(socket));
        socket.on('unauthorized', () => reject(new Error('unauthorized')));
        socket.on('connect_error', reject);
        setTimeout(() => reject(new Error('timeout')), 5000);
      });
    }

    it('un cobro desde la web llega como store.changed al móvil conectado', async () => {
      const socket = await connect({ auth: { token: await mobileToken(t) } });
      try {
        const event = new Promise<{ storeId: string; seq: number; type: string }>((resolve) => socket.once('store.changed', resolve));
        const web = await webSession(t);
        await web.post('/v2/receivables/rcv_fina/payments').send({ clientMutationId: cmid(), bankId: 'bank_caja', amount: 100_000, paymentDate: '2026-05-25' }).expect(201);
        await expect(event).resolves.toMatchObject({ storeId: STORE, type: 'receivable.payment', seq: expect.any(Number) });
      } finally {
        socket.close();
      }
    });

    it('sin token, o con cookie desde un origen ajeno, se desconecta', async () => {
      await expect(connect({})).rejects.toThrow();
      const web = await webSession(t);
      await expect(connect({ extraHeaders: { cookie: web.cookies, origin: 'https://evil.test' } })).rejects.toThrow();
      const ok = await connect({ extraHeaders: { cookie: web.cookies, origin: ORIGIN } });
      ok.close();
    });
  });
});
