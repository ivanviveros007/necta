import type {
  ErrorCode,
  ForecastResponse,
  SessionResponse,
  SyncOperation,
  SyncPullResponse,
  SyncPushResponse,
} from '@necta/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR' | 'TIMEOUT',
    message: string,
  ) {
    super(message);
  }

  /** Falla temporal: se reintenta con espera. */
  get transient(): boolean {
    return this.code === 'NETWORK_ERROR' || this.code === 'TIMEOUT' || this.status >= 500;
  }
}

export interface ApiClient {
  login(email: string, password: string): Promise<SessionResponse>;
  forecast(token: string, storeId: string): Promise<ForecastResponse>;
  push(token: string, storeId: string, operations: SyncOperation[]): Promise<SyncPushResponse>;
  pull(token: string, storeId: string, cursor: string | null, limit?: number): Promise<SyncPullResponse>;
}

type Fetch = typeof fetch;

export function createApiClient(baseUrl: string, fetchImpl: Fetch = fetch, timeoutMs = 15_000): ApiClient {
  async function call<T>(method: string, path: string, opts: { token?: string; storeId?: string; body?: unknown } = {}): Promise<T> {
    const headers: Record<string, string> = { 'x-client-platform': 'mobile' };
    if (opts.body !== undefined) headers['content-type'] = 'application/json';
    if (opts.token) headers.authorization = `Bearer ${opts.token}`;
    if (opts.storeId) headers['x-store-id'] = opts.storeId;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // En iOS una petición puede quedar esperando la red aunque se aborte: la carrera garantiza que
    // la promesa siempre termina y el coordinador nunca queda trabado.
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new ApiError(0, 'TIMEOUT', 'La API no respondió a tiempo'));
      }, timeoutMs);
    });
    let res: Response;
    try {
      res = await Promise.race([
        fetchImpl(`${baseUrl}${path}`, {
          method,
          headers,
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          signal: controller.signal,
        }),
        timeout,
      ]);
    } catch (error) {
      if (error instanceof ApiError) throw error;
      const aborted = (error as { name?: string })?.name === 'AbortError';
      throw new ApiError(0, aborted ? 'TIMEOUT' : 'NETWORK_ERROR', aborted ? 'La API no respondió a tiempo' : 'Sin conexión con la API');
    } finally {
      clearTimeout(timer);
    }
    const data = (await res.json().catch(() => null)) as { code?: ErrorCode; message?: string } | null;
    if (!res.ok) throw new ApiError(res.status, data?.code ?? 'INTERNAL_ERROR', data?.message ?? `HTTP ${res.status}`);
    return data as T;
  }

  return {
    login: (email, password) => call('POST', '/v2/auth/login', { body: { email, password } }),
    forecast: (token, storeId) => call('GET', '/v2/forecast/14d', { token, storeId }),
    push: (token, storeId, operations) => call('POST', '/v2/sync/push', { token, storeId, body: { operations } }),
    pull: (token, storeId, cursor, limit = 200) =>
      call('GET', `/v2/sync/pull?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`, { token, storeId }),
  };
}
