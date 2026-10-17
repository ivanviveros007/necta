import { createTestApp, mobile, mobileToken, ORIGIN, OTHER, seedAll, STORE, webSession, type TestApp } from './helpers';
import { DEMO_USER } from '../src/scripts/seed-data';

describe('Sesiones y permisos', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await createTestApp();
  });
  beforeEach(async () => seedAll(t.conn));
  afterAll(async () => t.close());

  it('móvil: login devuelve Bearer con expiración y sin cookies', async () => {
    const res = await t.http.post('/v2/auth/login').set('x-client-platform', 'mobile').send({ email: DEMO_USER.email, password: DEMO_USER.password }).expect(200);
    expect(res.body.accessToken).toEqual(expect.any(String));
    expect(new Date(res.body.expiresAt).getTime()).toBeGreaterThan(Date.now());
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body.stores[0]).toMatchObject({ id: STORE, currency: 'COP', businessDate: '2026-05-25', todayPolicy: 'fullDay' });
  });

  it('web: cookie HttpOnly SameSite=Lax y cookie CSRF, sin token en el cuerpo', async () => {
    const web = await webSession(t);
    const session = web.rawSetCookie.find((c) => c.startsWith('necta_session='))!;
    const csrf = web.rawSetCookie.find((c) => c.startsWith('necta_csrf='))!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(session).not.toMatch(/Secure/i); // COOKIE_SECURE=false en local
    expect(csrf).not.toMatch(/HttpOnly/i);
    expect(web.body.accessToken).toBeUndefined();
    await web.get('/v2/auth/me').expect(200).expect((r) => expect(r.body.csrfToken).toBe(web.csrf));
  });

  it('contraseña incorrecta y email inexistente responden igual (401 genérico)', async () => {
    const a = await t.http.post('/v2/auth/login').set('x-client-platform', 'mobile').send({ email: DEMO_USER.email, password: 'mala' }).expect(401);
    const b = await t.http.post('/v2/auth/login').set('x-client-platform', 'mobile').send({ email: 'nadie@x.test', password: 'mala' }).expect(401);
    expect(a.body).toEqual(b.body);
  });

  it('login exige x-client-platform válido', async () => {
    await t.http.post('/v2/auth/login').send({ email: DEMO_USER.email, password: DEMO_USER.password }).expect(400);
  });

  it('x-client-platform no autoriza: sin token es 401', async () => {
    await t.http.get('/v2/forecast/14d').set('x-client-platform', 'mobile').set('x-store-id', STORE).expect(401);
  });

  it('token inválido o vencido es 401', async () => {
    await t.http.get('/v2/banks').set('authorization', 'Bearer abc.def.ghi').set('x-store-id', STORE).expect(401);
  });

  it('web: POST con cookie sin CSRF o con origen ajeno es 403', async () => {
    const web = await webSession(t);
    const body = { clientMutationId: 'm_csrf', movement: { id: 'mv_csrf', kind: 'expense', amount: 1000, bankId: 'bank_caja', date: '2026-05-25' } };
    await t.http.post('/v2/movements').set('cookie', web.cookies).set('x-store-id', STORE).set('origin', ORIGIN).send(body).expect(403);
    await t.http
      .post('/v2/movements')
      .set('cookie', web.cookies)
      .set('x-store-id', STORE)
      .set('origin', 'https://evil.test')
      .set('x-csrf-token', web.csrf)
      .send(body)
      .expect(403)
      .expect((r) => expect(r.body.code).toBe('CSRF_REJECTED'));
    await web.post('/v2/movements').send(body).expect(201);
  });

  it('aislamiento: no se accede a otra tienda ni se revelan sus datos', async () => {
    const token = await mobileToken(t);
    const res = await mobile(t, token, OTHER.storeId).get('/v2/forecast/14d').expect(403);
    expect(res.body.code).toBe('STORE_FORBIDDEN');
    await mobile(t, token, OTHER.storeId).get('/v2/banks/bank_otra/projection').expect(403);
    const otherToken = await mobileToken(t, OTHER.email, OTHER.password);
    await mobile(t, otherToken, STORE).get('/v2/receivables').expect(403);
    // Una tienda propia no ve bolsillos ajenos aunque conozca el id.
    await mobile(t, token).get('/v2/banks/bank_otra/projection').expect(404);
  });

  it('sin x-store-id en rutas de tienda es 403', async () => {
    const token = await mobileToken(t);
    await t.http.get('/v2/banks').set('authorization', `Bearer ${token}`).expect(403);
  });

  it('health es público', async () => {
    await t.http.get('/health').expect(200).expect((r) => expect(r.body.mongo.replicaSet).toBe('rs0'));
  });
});
