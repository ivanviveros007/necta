import { z } from 'zod';

export const LocalDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha con formato YYYY-MM-DD')
  .refine((value) => {
    const [y, m, d] = value.split('-').map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
  }, 'Fecha inexistente');

/** Importe entero en la unidad de la moneda (COP sin decimales). */
export const AmountSchema = z.number().int('Monto entero').positive('Monto mayor a cero').max(100_000_000_000);
export const NonNegativeAmountSchema = z.number().int().min(0).max(100_000_000_000);

export const IdSchema = z.string().min(1).max(100).regex(/^[A-Za-z0-9_\-:.]+$/, 'Identificador inválido');
export const ClientMutationIdSchema = IdSchema;

export const ClientPlatformSchema = z.enum(['mobile', 'web']);
export type ClientPlatform = z.infer<typeof ClientPlatformSchema>;

export const HEADER_PLATFORM = 'x-client-platform';
export const HEADER_STORE = 'x-store-id';
export const HEADER_CSRF = 'x-csrf-token';
export const SESSION_COOKIE = 'necta_session';
export const CSRF_COOKIE = 'necta_csrf';

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'STORE_FORBIDDEN',
  'CSRF_REJECTED',
  'NOT_FOUND',
  'IDEMPOTENCY_PAYLOAD_MISMATCH',
  'VERSION_CONFLICT',
  'PAYMENT_EXCEEDS_PENDING',
  'DEBT_ALREADY_SETTLED',
  'PAYMENT_ALREADY_VOIDED',
  'FUTURE_DATE_NOT_ALLOWED',
  'BANK_NOT_FOUND',
  'ENTITY_DELETED',
  'DEPENDENCY_FAILED',
  'INVALID_CURSOR',
  'INTERNAL_ERROR',
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  code: ErrorCode;
  message: string;
  details?: unknown;
}

/** Campos de sincronización comunes a toda entidad que viaja en el pull. */
export const SyncMetaSchema = z.object({
  version: z.number().int().min(1),
  seq: z.number().int().min(0),
  updatedAt: z.string(),
  deletedAt: z.string().nullable(),
});
export type SyncMeta = z.infer<typeof SyncMetaSchema>;
