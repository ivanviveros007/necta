import type { LocalRepository } from '../db/localRepository';
import { ApiError, type ApiClient } from '../services/apiClient';

export type SyncPhase = 'idle' | 'syncing' | 'offline' | 'auth_expired' | 'error';

export interface SyncState {
  phase: SyncPhase;
  lastSyncAt: string | null;
  lastError: string | null;
  /** Próximo reintento automático tras una falla temporal. */
  nextRetryAt: string | null;
  attempt: number;
}

export interface SyncDeps {
  repo: LocalRepository;
  api: ApiClient;
  storeId: string;
  getToken: () => Promise<string | null>;
  now?: () => number;
  random?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

const BATCH = 50;

/** 1 s, 2 s, 4 s… hasta 5 min, con jitter (50–100 %). */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const base = Math.min(1000 * 2 ** Math.max(0, attempt - 1), 300_000);
  return Math.round(base * (0.5 + random() / 2));
}

/**
 * Un coordinador por usuaria y tienda. Envía la outbox en orden de creación (respetando dependencias,
 * que el servidor valida), trae cambios por cursor y concilia sin doble conteo. Nunca corre dos veces
 * en paralelo: si llega otro disparador mientras sincroniza, repite al terminar.
 */
export class SyncCoordinator {
  private state: SyncState = { phase: 'idle', lastSyncAt: null, lastError: null, nextRetryAt: null, attempt: 0 };
  private running: Promise<void> | null = null;
  private again = false;
  private timer: unknown = null;
  private listeners = new Set<(s: SyncState) => void>();
  private readonly now: () => number;
  private readonly random: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (h: unknown) => void;

  constructor(private readonly deps: SyncDeps) {
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
    this.setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  getState(): SyncState {
    return this.state;
  }

  subscribe(listener: (s: SyncState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private set(patch: Partial<SyncState>): void {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((l) => l(this.state));
  }

  async init(): Promise<void> {
    const last = await this.deps.repo.getMeta('last_sync_at');
    if (last) this.set({ lastSyncAt: last });
  }

  /** Disparador: abrir, primer plano, reconexión, socket, tras registrar o por reintento. */
  run(): Promise<void> {
    if (this.running) {
      this.again = true;
      return this.running;
    }
    this.running = (async () => {
      do {
        this.again = false;
        await this.cycle();
      } while (this.again && this.state.phase === 'idle');
    })().finally(() => {
      this.running = null;
    });
    return this.running;
  }

  dispose(): void {
    if (this.timer) this.clearTimer(this.timer);
    this.listeners.clear();
  }

  private async cycle(): Promise<void> {
    const token = await this.deps.getToken();
    if (!token) {
      this.set({ phase: 'auth_expired', lastError: 'Ingresa de nuevo para sincronizar. Tus registros quedan guardados.' });
      return;
    }
    if (this.timer) {
      this.clearTimer(this.timer);
      this.timer = null;
    }
    this.set({ phase: 'syncing', nextRetryAt: null });
    try {
      await this.pushAll(token);
      await this.pullAll(token);
      await this.refreshServerForecast(token);
      const at = new Date(this.now()).toISOString();
      await this.deps.repo.setMeta('last_sync_at', at);
      this.set({ phase: 'idle', lastSyncAt: at, lastError: null, attempt: 0 });
    } catch (error) {
      await this.deps.repo.revertSending(error instanceof Error ? error.message : String(error));
      if (error instanceof ApiError && error.status === 401) {
        // Sesión vencida: se pausa sin borrar nada; la captura local sigue.
        this.set({ phase: 'auth_expired', lastError: 'Tu sesión venció. Ingresa de nuevo para sincronizar; tus registros quedan guardados.' });
        return;
      }
      const transient = error instanceof ApiError ? error.transient : true;
      const attempt = this.state.attempt + 1;
      if (transient) {
        const delay = retryDelayMs(attempt, this.random);
        this.timer = this.setTimer(() => void this.run(), delay);
        this.set({
          phase: error instanceof ApiError && (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT') ? 'offline' : 'error',
          attempt,
          lastError: error instanceof Error ? error.message : String(error),
          nextRetryAt: new Date(this.now() + delay).toISOString(),
        });
      } else {
        this.set({ phase: 'error', attempt, lastError: error instanceof Error ? error.message : String(error) });
      }
    }
  }

  private async pushAll(token: string): Promise<void> {
    for (;;) {
      const pending = (await this.deps.repo.outbox()).filter((o) => o.status === 'pending').slice(0, BATCH);
      if (pending.length === 0) return;
      await this.deps.repo.markSending(pending.map((p) => p.clientMutationId));
      // Se reenvía el payload original, sin modificar (idempotencia).
      const { results } = await this.deps.api.push(token, this.deps.storeId, pending.map((p) => p.operation));
      await this.deps.repo.applyPushResults(results);
      if (pending.length < BATCH) return;
    }
  }

  /** Resultado confirmado por el servidor; si falla no invalida la sincronización. */
  private async refreshServerForecast(token: string): Promise<void> {
    try {
      const f = await this.deps.api.forecast(token, this.deps.storeId);
      await this.deps.repo.setMeta('business_date', f.window.start);
      await this.deps.repo.setMeta('server_forecast', JSON.stringify({ computedAt: f.computedAt, dataVersion: f.dataVersion, status: f.status, headline: f.conclusion.headline }));
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) throw error;
    }
  }

  private async pullAll(token: string): Promise<void> {
    for (let page = 0; page < 1000; page++) {
      const cursor = await this.deps.repo.getMeta('cursor');
      const res = await this.deps.api.pull(token, this.deps.storeId, cursor);
      // El cursor solo avanza junto con la página persistida (misma transacción).
      await this.deps.repo.applyPullPage(res.changes, res.nextCursor, res.maxSeq);
      if (!res.hasMore) return;
    }
  }
}
