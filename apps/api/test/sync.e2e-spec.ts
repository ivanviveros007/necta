import { encodeCursor } from '@necta/contracts';
import { bank, cmid, createTestApp, mobile, mobileToken, receivable, seedAll, type TestApp } from './helpers';

describe('Sincronización push/pull', () => {
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

  const sale = (id: string, cm: string, extra: Record<string, unknown> = {}) => ({
    clientMutationId: cm,
    type: 'sale.create',
    payload: { sale: { id, customerId: 'cli_tienda_dona_fina', items: [{ itemId: 'prod_x', quantitiesSold: 2, finalPrice: 100_000 }], payments: [], saleDate: '2026-05-25', ...extra } },
  });

  it('venta a crédito y cobro creados offline se aplican en orden con dependencias', async () => {
    const res = await api
      .post('/v2/sync/push')
      .send({
        operations: [
          sale('sale_off_1', 'op_1'),
          { clientMutationId: 'op_2', type: 'receivable.payment', entityId: 'sale_off_1', dependsOn: ['op_1'], payload: { bankId: 'bank_caja', amount: 50_000, paymentDate: '2026-05-25' } },
        ],
      })
      .expect(200);
    expect(res.body.results.map((r: { status: string }) => r.status)).toEqual(['applied', 'applied']);
    expect(res.body.results[1].seq).toBeGreaterThan(res.body.results[0].seq);
    expect((await receivable(t.conn, 'sale_off_1'))!.pendingAmount).toBe(150_000);
    expect((await bank(t.conn, 'bank_caja'))!.storedLedgerBalance).toBe(650_000);
  });

  it('dependencia rechazada: la operación queda blocked y no se aplica', async () => {
    const res = await api
      .post('/v2/sync/push')
      .send({
        operations: [
          sale('sale_bad', 'op_bad', { customerId: 'cli_inexistente' }),
          { clientMutationId: 'op_dep', type: 'receivable.payment', entityId: 'sale_bad', dependsOn: ['op_bad'], payload: { bankId: 'bank_caja', amount: 1, paymentDate: '2026-05-25' } },
        ],
      })
      .expect(200);
    expect(res.body.results[0]).toMatchObject({ status: 'rejected', error: { code: 'NOT_FOUND' } });
    expect(res.body.results[1]).toMatchObject({ status: 'blocked', error: { code: 'DEPENDENCY_FAILED' } });
  });

  it('reenviar el mismo push no duplica efectos y devuelve el seq original', async () => {
    const ops = { operations: [{ clientMutationId: 'op_g', type: 'movement.create', payload: { movement: { id: 'mv_g', kind: 'expense', amount: 45_000, bankId: 'bank_caja', date: '2026-05-25' } } }] };
    const a = await api.post('/v2/sync/push').send(ops).expect(200);
    const b = await api.post('/v2/sync/push').send(ops).expect(200);
    expect(b.body.results[0]).toMatchObject({ status: 'duplicate', seq: a.body.results[0].seq });
    expect((await bank(t.conn, 'bank_caja'))!.storedLedgerBalance).toBe(555_000);
  });

  it('distingue payload distinto (rejected IDEMPOTENCY_PAYLOAD_MISMATCH) de conflicto de versión (conflict)', async () => {
    const mk = (amount: number) => ({ clientMutationId: 'op_same', type: 'movement.create', payload: { movement: { id: 'mv_same', kind: 'expense', amount, bankId: 'bank_caja', date: '2026-05-25' } } });
    await api.post('/v2/sync/push').send({ operations: [mk(10_000)] }).expect(200);
    const mismatch = await api.post('/v2/sync/push').send({ operations: [mk(20_000)] }).expect(200);
    expect(mismatch.body.results[0]).toMatchObject({ status: 'rejected', error: { code: 'IDEMPOTENCY_PAYLOAD_MISMATCH' } });

    const conflict = await api
      .post('/v2/sync/push')
      .send({ operations: [{ clientMutationId: cmid(), type: 'commitment.update', entityId: 'cmt_arriendo', baseVersion: 7, payload: { changes: { amount: 1 } } }] })
      .expect(200);
    expect(conflict.body.results[0]).toMatchObject({ status: 'conflict', error: { code: 'VERSION_CONFLICT' } });
    expect(conflict.body.results[0].remote.entity).toMatchObject({ id: 'cmt_arriendo', version: 1, amount: 1_300_000 });
  });

  it('validación del push: 400 con detalle', async () => {
    const res = await api.post('/v2/sync/push').send({ operations: [{ clientMutationId: 'x', type: 'movement.create', payload: {} }] }).expect(400);
    expect(res.body.code).toBe('VALIDATION_ERROR');
  });

  it('pull inicial trae todo el estado de la tienda y nada de otras', async () => {
    const res = await api.get('/v2/sync/pull').expect(200);
    const types = new Set(res.body.changes.map((c: { entityType: string }) => c.entityType));
    expect([...types].sort()).toEqual(['bank', 'baseline', 'commitment', 'counterparty', 'payable', 'receivable']);
    expect(res.body.hasMore).toBe(false);
    expect(res.body.changes.some((c: { entity: { id: string } }) => c.entity.id === 'bank_otra')).toBe(false);
    expect(res.body.nextCursor).not.toMatch(/^\d+$/);
  });

  it('pull paginado sin omitir cambios, incluidos borrados lógicos', async () => {
    const first = await api.get('/v2/sync/pull').expect(200);
    const cursor = first.body.nextCursor as string;
    for (let i = 0; i < 7; i++) {
      await api.post('/v2/movements').send({ clientMutationId: `op_p${i}`, movement: { id: `mv_p${i}`, kind: 'income', amount: 1000 + i, bankId: 'bank_caja', date: '2026-05-25' } }).expect(201);
    }
    await api.delete('/v2/movements/mv_p0').send({ clientMutationId: cmid(), baseVersion: 1 }).expect(201);

    const seen = new Map<string, { deletedAt: string | null }>();
    const flags: boolean[] = [];
    let next = cursor;
    for (let page = 0; page < 10; page++) {
      const res = await api.get(`/v2/sync/pull?cursor=${next}&limit=3`).expect(200);
      for (const c of res.body.changes) if (c.entityType === 'movement') seen.set(c.entity.id, c.entity);
      flags.push(res.body.hasMore);
      next = res.body.nextCursor;
      if (!res.body.hasMore) break;
    }
    expect(flags[flags.length - 1]).toBe(false);
    expect(flags.length).toBeGreaterThan(2);
    expect([...seen.keys()].sort()).toEqual(['mv_p0', 'mv_p1', 'mv_p2', 'mv_p3', 'mv_p4', 'mv_p5', 'mv_p6']);
    expect(seen.get('mv_p0')!.deletedAt).toEqual(expect.any(String));
    const done = await api.get(`/v2/sync/pull?cursor=${next}`).expect(200);
    expect(done.body.changes).toHaveLength(0);
  });

  it('un cobro devuelve en el pull la deuda, el bolsillo y la contraparte con el mismo seq', async () => {
    const first = await api.get('/v2/sync/pull').expect(200);
    const push = await api.post('/v2/sync/push').send({ operations: [{ clientMutationId: 'op_c', type: 'receivable.payment', entityId: 'rcv_brisas', payload: { bankId: 'bank_banco', amount: 500_000, paymentDate: '2026-05-25' } }] }).expect(200);
    const seq = push.body.results[0].seq;
    const res = await api.get(`/v2/sync/pull?cursor=${first.body.nextCursor}`).expect(200);
    expect(res.body.maxSeq).toBe(seq);
    expect(res.body.changes.map((c: { entityType: string }) => c.entityType).sort()).toEqual(['bank', 'counterparty', 'receivable']);
    expect(res.body.changes.every((c: { entity: { seq: number } }) => c.entity.seq === seq)).toBe(true);
  });

  it('cursor inválido: 400 INVALID_CURSOR', async () => {
    const res = await api.get('/v2/sync/pull?cursor=%%%').expect(400);
    expect(res.body.code).toBe('INVALID_CURSOR');
    await api.get(`/v2/sync/pull?cursor=${encodeCursor(0)}`).expect(200);
  });
});
