import {
  applyPendingOperations,
  buildForecastInput,
  computeForecast,
  limpiaYaSnapshot,
  type PendingOperation,
  type StoreSnapshot,
} from '@necta/cash-engine';
import type { ForecastResponse, SessionResponse } from '@necta/contracts';
import { vi } from 'vitest';
import type { Socket } from 'socket.io-client';

export const SESSION: SessionResponse = {
  user: { id: 'usr_carmen', email: 'carmen@limpiaya.test', name: 'Carmen Ortiz' },
  stores: [{ id: 'store_limpia_ya', name: 'Limpia Ya', currency: 'COP', timeZone: 'America/Bogota', businessDate: '2026-05-25', businessDateSimulated: true, todayPolicy: 'fullDay' }],
  expiresAt: '2026-05-25T20:00:00.000Z',
  csrfToken: 'csrf-test',
};

export interface Recorded {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: unknown;
}

/**
 * API falsa en memoria para pruebas de la web: aplica operaciones con el mismo motor del servidor
 * (applyPendingOperations) para que las pantallas reflejen los cambios.
 */
export function installFakeApi(options: { loggedIn?: boolean } = {}) {
  let loggedIn = options.loggedIn ?? true;
  let snapshot: StoreSnapshot = limpiaYaSnapshot();
  let seq = 18;
  const requests: Recorded[] = [];
  const seen = new Map<string, string>();
  const overrides = new Map<string, (body: unknown) => { status: number; body: unknown }>();
  let alerts: unknown[] = [];
  const payments = new Map<string, { clientMutationId: string; amount: number; paymentDate: string; bankId: string }[]>();

  const forecast = (): ForecastResponse => ({
    ...computeForecast(buildForecastInput(snapshot)),
    storeId: 'store_limpia_ya',
    computedAt: '2026-05-25T12:00:00.000Z',
    cutoff: '2026-05-25T05:00:00.000Z',
    dataVersion: seq,
    provisional: false,
    pendingOperations: 0,
  });

  const reads = (path: string, openOnly: boolean): unknown => {
    if (path === '/v2/forecast/14d') return forecast();
    if (path === '/v2/banks') return snapshot.banks;
    if (path === '/v2/counterparties') return snapshot.counterparties.map((c) => ({ ...c, kind: 'customer', aggregated: c.aggregated ?? false }));
    if (path === '/v2/receivables') return snapshot.receivables.filter((r) => !openOnly || r.pendingAmount > 0).map((r) => ({ version: 1, ...r, payments: payments.get(r.id) ?? [] }));
    if (path === '/v2/payables') return snapshot.payables.filter((p) => !openOnly || p.pendingAmount > 0);
    if (path === '/v2/commitments') return snapshot.commitments.filter((c) => !c.deletedAt);
    if (path === '/v2/movements') return snapshot.movements.filter((m) => !m.deletedAt).map((m) => ({ version: 1, description: '', ...m }));
    if (path === '/v2/alerts') return alerts;
    if (path === '/v2/sales') return snapshot.sales;
    if (path === '/v2/cash-baseline') return snapshot.baseline ? { id: 'baseline', version: 1, ...snapshot.baseline } : null;
    return undefined;
  };

  const json = (status: number, body: unknown) =>
    new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  const apply = (cmid: string, op: PendingOperation, entity: unknown) => {
    const key = JSON.stringify(op);
    if (seen.has(cmid)) {
      if (seen.get(cmid) !== key) return json(409, { code: 'IDEMPOTENCY_PAYLOAD_MISMATCH', message: 'distinto' });
      return json(200, { entity, seq });
    }
    seen.set(cmid, key);
    snapshot = applyPendingOperations(snapshot, [op]);
    seq += 1;
    return json(201, { entity, seq });
  };

  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    requests.push({ method, url, headers: (init?.headers ?? {}) as Record<string, string>, body });
    const path = url.split('?')[0]!;
    const override = overrides.get(`${method} ${path}`);
    if (override) {
      const r = override(body);
      return json(r.status, r.body);
    }

    if (path === '/v2/auth/me') return loggedIn ? json(200, SESSION) : json(401, { code: 'UNAUTHENTICATED', message: 'no' });
    if (path === '/v2/auth/login') {
      if (body.password !== 'Necta2026!') return json(401, { code: 'UNAUTHENTICATED', message: 'Email o contraseña incorrectos' });
      loggedIn = true;
      return json(200, SESSION);
    }
    if (path === '/v2/auth/logout') {
      loggedIn = false;
      return json(204, null);
    }
    if (!loggedIn) return json(401, { code: 'UNAUTHENTICATED', message: 'no' });

    if (method === 'GET') {
      const read = reads(path, url.includes('status=open'));
      if (read !== undefined) return json(200, read);
    }
    const mv = /^\/v2\/movements\/([^/]+)$/.exec(path);
    if (mv && (method === 'PATCH' || method === 'DELETE')) {
      const op = method === 'PATCH'
        ? ({ type: 'movement.update', entityId: mv[1]!, payload: { changes: body.changes } } as PendingOperation)
        : ({ type: 'movement.delete', entityId: mv[1]!, payload: {} } as PendingOperation);
      return apply(body.clientMutationId, op, { id: mv[1] });
    }
    if (method === 'POST' && path === '/v2/movements') {
      return apply(body.clientMutationId, { type: 'movement.create', payload: { movement: body.movement } }, body.movement);
    }
    const debt = /^\/v2\/(receivables|payables)\/([^/]+)\/payments$/.exec(path);
    if (method === 'POST' && debt) {
      const list = debt[1] === 'receivables' ? snapshot.receivables : snapshot.payables;
      const target = list.find((d) => d.id === debt[2]);
      if (!target) return json(404, { code: 'NOT_FOUND', message: 'no' });
      if (body.amount > target.pendingAmount) return json(422, { code: 'PAYMENT_EXCEEDS_PENDING', message: 'excede' });
      const type = debt[1] === 'receivables' ? 'receivable.payment' : 'payable.payment';
      if (!seen.has(body.clientMutationId)) payments.set(debt[2]!, [...(payments.get(debt[2]!) ?? []), body]);
      return apply(body.clientMutationId, { type, entityId: debt[2]!, payload: body } as PendingOperation, target);
    }
    const resched = /^\/v2\/receivables\/([^/]+)\/reschedule$/.exec(path);
    if (method === 'POST' && resched) {
      const target = snapshot.receivables.find((d) => d.id === resched[1]);
      if (!target) return json(404, { code: 'NOT_FOUND', message: 'no' });
      return apply(body.clientMutationId, { type: 'receivable.reschedule', entityId: resched[1]!, payload: { newDueDate: body.newDueDate } }, target);
    }
    if (method === 'POST' && path === '/v2/sale/batch') {
      const { clientMutationId, sale } = body.sales[0];
      const r = await apply(clientMutationId, { type: 'sale.create', payload: { sale } }, sale);
      return json(200, { batchId: body.batchId, results: [{ clientMutationId, status: r.status === 201 ? 'applied' : 'duplicate' }] });
    }
    if (method === 'POST' && path === '/v2/commitments') {
      return apply(body.clientMutationId, { type: 'commitment.create', payload: { commitment: body.commitment } }, body.commitment);
    }
    if (method === 'POST' && /^\/v2\/alerts\/[^/]+\/ack$/.test(path)) {
      alerts = alerts.map((a) => ({ ...(a as object), acknowledgedAt: '2026-05-25T13:00:00.000Z' }));
      return json(200, alerts[0]);
    }
    return json(404, { code: 'NOT_FOUND', message: `${method} ${path}` });
  });

  vi.stubGlobal('fetch', fetchMock);

  return {
    fetch: fetchMock,
    requests,
    get snapshot() {
      return snapshot;
    },
    override(method: string, path: string, handler: (body: unknown) => { status: number; body: unknown }) {
      overrides.set(`${method} ${path}`, handler);
    },
    setAlerts(list: unknown[]) {
      alerts = list;
    },
    /** Simula un cambio hecho desde otro dispositivo. */
    externalChange(op: PendingOperation) {
      snapshot = applyPendingOperations(snapshot, [op]);
      seq += 1;
    },
    writes: () => requests.filter((r) => r.method !== 'GET'),
  };
}

/** Socket falso controlable desde la prueba. */
export function fakeSocket() {
  const handlers = new Map<string, ((...args: unknown[]) => void)[]>();
  const socket = {
    on(event: string, cb: (...args: unknown[]) => void) {
      handlers.set(event, [...(handlers.get(event) ?? []), cb]);
      return socket;
    },
    removeAllListeners() {
      handlers.clear();
      return socket;
    },
    close: vi.fn(),
    emit(event: string, ...args: unknown[]) {
      (handlers.get(event) ?? []).forEach((cb) => cb(...args));
    },
  };
  return { socket: socket as unknown as Socket & { emit: (e: string, ...a: unknown[]) => void }, factory: () => socket as unknown as Socket };
}

export function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, get: () => online });
  window.dispatchEvent(new Event(online ? 'online' : 'offline'));
}
