import type { INestApplication } from '@nestjs/common';
import { getConnectionToken } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import bcrypt from 'bcryptjs';
import type { Connection } from 'mongoose';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/bootstrap';
import { loadConfig } from '../src/config/config';
import { MODELS } from '../src/db/schemas';
import { DEMO_STORE_ID, DEMO_USER, resetDemo, seedDemo } from '../src/scripts/seed-data';

export const STORE = DEMO_STORE_ID;
export const ORIGIN = 'http://localhost:5173';
export const OTHER = { userId: 'usr_otra', storeId: 'store_otra', email: 'otra@tienda.test', password: 'Otra2026!' };

export interface TestApp {
  app: INestApplication;
  conn: Connection;
  http: ReturnType<typeof request>;
  close: () => Promise<void>;
}

export async function createTestApp(options: { listen?: boolean } = {}): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule.forRoot({ scheduler: false, devEndpoints: true })] }).compile();
  const app = moduleRef.createNestApplication({ logger: ['error'] });
  configureApp(app, loadConfig());
  if (options.listen) await app.listen(0, '127.0.0.1');
  else await app.init();
  const conn = app.get<Connection>(getConnectionToken());
  return {
    app,
    conn,
    http: request(app.getHttpServer()),
    close: async () => {
      await app.close();
    },
  };
}

/** Siembra el caso y una segunda usuaria con su propia tienda (para probar aislamiento). */
export async function seedAll(conn: Connection): Promise<void> {
  await resetDemo(conn, [STORE, OTHER.storeId], [DEMO_USER.id, OTHER.userId]);
  await seedDemo(conn);
  await conn.model(MODELS.User).create({
    _id: OTHER.userId,
    email: OTHER.email,
    passwordHash: await bcrypt.hash(OTHER.password, 4),
    name: 'Otra Usuaria',
    storeIds: [OTHER.storeId],
  });
  await conn.model(MODELS.Store).create({ _id: OTHER.storeId, ownerId: OTHER.userId, name: 'Otra', currency: 'USD', timeZone: 'America/Bogota' });
  await conn.model(MODELS.Bank).create({
    _id: 'bank_otra',
    storeId: OTHER.storeId,
    name: 'Caja',
    storedLedgerBalance: 500,
    reconstructedBalance: 500,
    openingBalance: 500,
    balanceAsOf: null,
    version: 1,
    seq: 1,
  });
  await conn.model(MODELS.Counter).create({ _id: OTHER.storeId, seq: 1 });
}

export async function mobileToken(t: TestApp, email = DEMO_USER.email, password = DEMO_USER.password): Promise<string> {
  const res = await t.http.post('/v2/auth/login').set('x-client-platform', 'mobile').send({ email, password }).expect(200);
  return res.body.accessToken as string;
}

/** Cliente con Bearer y tienda, como la app móvil. */
export function mobile(t: TestApp, token: string, storeId = STORE) {
  const h = (r: request.Test) => r.set('authorization', `Bearer ${token}`).set('x-store-id', storeId).set('x-client-platform', 'mobile');
  return {
    get: (url: string) => h(t.http.get(url)),
    post: (url: string) => h(t.http.post(url)),
    patch: (url: string) => h(t.http.patch(url)),
    put: (url: string) => h(t.http.put(url)),
    delete: (url: string) => h(t.http.delete(url)),
  };
}

/** Cliente web: cookie HttpOnly + CSRF + Origin permitido. */
export async function webSession(t: TestApp) {
  const res = await t.http.post('/v2/auth/login').set('x-client-platform', 'web').send({ email: DEMO_USER.email, password: DEMO_USER.password }).expect(200);
  const cookies = (res.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]!).join('; ');
  const csrf = res.body.csrfToken as string;
  const h = (r: request.Test) =>
    r.set('cookie', cookies).set('x-store-id', STORE).set('x-client-platform', 'web').set('origin', ORIGIN).set('x-csrf-token', csrf);
  return {
    cookies,
    csrf,
    rawSetCookie: res.headers['set-cookie'] as unknown as string[],
    body: res.body,
    get: (url: string) => h(t.http.get(url)),
    post: (url: string) => h(t.http.post(url)),
    patch: (url: string) => h(t.http.patch(url)),
  };
}

export const cmid = (prefix = 'm') => `${prefix}_${randomUUID()}`;

export async function bank(conn: Connection, id: string) {
  return conn.model(MODELS.Bank).findById(id).lean<{ storedLedgerBalance: number; reconstructedBalance: number }>();
}

export async function receivable(conn: Connection, id: string) {
  return conn.model(MODELS.Receivable).findById(id).lean<{ pendingAmount: number; payments: unknown[]; version: number }>();
}
