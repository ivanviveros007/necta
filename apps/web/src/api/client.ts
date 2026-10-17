import { HEADER_CSRF, HEADER_PLATFORM, HEADER_STORE, type ApiError as ApiErrorBody, type ErrorCode } from '@necta/contracts';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** Estado de sesión que necesita el cliente: tienda activa y token CSRF (la cookie HttpOnly la maneja el navegador). */
const state: { storeId: string | null; csrf: string | null } = { storeId: null, csrf: null };

export function setSessionHeaders(storeId: string | null, csrf: string | null): void {
  state.storeId = storeId;
  state.csrf = csrf;
}

type Listener = () => void;
const unauthorizedListeners = new Set<Listener>();
export function onUnauthorized(listener: Listener): () => void {
  unauthorizedListeners.add(listener);
  return () => unauthorizedListeners.delete(listener);
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { [HEADER_PLATFORM]: 'web' };
  if (body !== undefined) headers['content-type'] = 'application/json';
  if (state.storeId) headers[HEADER_STORE] = state.storeId;
  if (state.csrf && method !== 'GET') headers[HEADER_CSRF] = state.csrf;

  let res: Response;
  try {
    res = await fetch(path, { method, headers, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', 'Sin conexión con Necta');
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as unknown;
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiErrorBody>;
    if (res.status === 401 && !path.endsWith('/auth/login')) unauthorizedListeners.forEach((l) => l());
    throw new ApiError(res.status, err.code ?? 'INTERNAL_ERROR', err.message ?? 'Error inesperado', err.details);
  }
  return data as T;
}

export const http = {
  get: <T>(path: string) => request<T>('GET', path),
  post: <T>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body),
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body),
  delete: <T>(path: string, body: unknown) => request<T>('DELETE', path, body),
};

/** Mensaje para la dueña a partir de un error de la API. */
export function errorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) return 'Algo salió mal. Intenta de nuevo.';
  switch (error.code) {
    case 'NETWORK_ERROR':
      return 'Sin conexión. Tu formulario sigue aquí: guárdalo cuando vuelva la señal.';
    case 'PAYMENT_EXCEEDS_PENDING':
      return 'El monto es mayor a lo que falta pagar de esa cuenta.';
    case 'DEBT_ALREADY_SETTLED':
      return 'Esa cuenta ya está pagada.';
    case 'FUTURE_DATE_NOT_ALLOWED':
      return 'Un movimiento ya hecho no puede tener fecha futura.';
    case 'VERSION_CONFLICT':
      return 'Alguien cambió esto desde otro dispositivo. Revisa los datos actuales y vuelve a intentar.';
    case 'VALIDATION_ERROR':
      return 'Revisa los datos del formulario.';
    case 'UNAUTHENTICATED':
      return 'Tu sesión venció. Vuelve a ingresar.';
    default:
      return error.message;
  }
}
