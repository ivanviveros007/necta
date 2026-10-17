import { z } from 'zod';
import { AmountSchema, ClientMutationIdSchema, IdSchema, LocalDateSchema, type ErrorCode } from './common';
import {
  BankEntitySchema,
  BaselineEntitySchema,
  BaselineInputSchema,
  CommitmentChangesSchema,
  CommitmentEntitySchema,
  CommitmentInputSchema,
  CounterpartyEntitySchema,
  MovementChangesSchema,
  MovementEntitySchema,
  MovementInputSchema,
  PayableEntitySchema,
  PaymentMethodSchema,
  ReceivableEntitySchema,
  SaleEntitySchema,
  SaleSchema,
} from './records';

const base = {
  clientMutationId: ClientMutationIdSchema,
  dependsOn: z.array(ClientMutationIdSchema).max(50).default([]),
};
const versioned = { ...base, entityId: IdSchema, baseVersion: z.number().int().min(1) };
const debtPayment = z.object({
  bankId: IdSchema,
  amount: AmountSchema,
  method: PaymentMethodSchema.default('efectivo'),
  paymentDate: LocalDateSchema,
});

export const SyncOperationSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('movement.create'), payload: z.object({ movement: MovementInputSchema }) }),
  z.object({ ...versioned, type: z.literal('movement.update'), payload: z.object({ changes: MovementChangesSchema }) }),
  z.object({ ...versioned, type: z.literal('movement.delete'), payload: z.object({}).default({}) }),
  z.object({ ...base, type: z.literal('sale.create'), payload: z.object({ sale: SaleSchema.extend({ id: IdSchema }) }) }),
  z.object({ ...base, entityId: IdSchema, type: z.literal('receivable.payment'), payload: debtPayment }),
  z.object({ ...base, entityId: IdSchema, type: z.literal('payable.payment'), payload: debtPayment }),
  z.object({ ...base, type: z.literal('commitment.create'), payload: z.object({ commitment: CommitmentInputSchema }) }),
  z.object({ ...versioned, type: z.literal('commitment.update'), payload: z.object({ changes: CommitmentChangesSchema }) }),
  z.object({ ...versioned, type: z.literal('commitment.delete'), payload: z.object({}).default({}) }),
  z.object({ ...base, baseVersion: z.number().int().min(0), type: z.literal('baseline.update'), payload: BaselineInputSchema }),
  z.object({
    ...base,
    entityId: IdSchema,
    type: z.literal('bank.adjustment'),
    payload: z.object({ newBalance: z.number().int(), reason: z.string().trim().min(3).max(200) }),
  }),
]);
export type SyncOperation = z.infer<typeof SyncOperationSchema>;
export type SyncOperationInput = z.input<typeof SyncOperationSchema>;
export type SyncOperationType = SyncOperation['type'];

export const SyncPushRequestSchema = z.object({
  operations: z.array(SyncOperationSchema).min(1).max(100),
});

export type OperationStatus = 'applied' | 'duplicate' | 'conflict' | 'rejected' | 'blocked';

export interface OperationResult {
  clientMutationId: string;
  status: OperationStatus;
  /** seq del cambio en el log de la tienda (applied/duplicate). */
  seq?: number;
  entityType?: EntityType;
  entity?: unknown;
  error?: { code: ErrorCode; message: string };
  /** Estado remoto vigente cuando hay conflicto de versión. */
  remote?: unknown;
}

export interface SyncPushResponse {
  results: OperationResult[];
}

export const ENTITY_TYPES = [
  'bank',
  'counterparty',
  'receivable',
  'payable',
  'movement',
  'commitment',
  'sale',
  'baseline',
] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];

export const ChangeSchema = z.discriminatedUnion('entityType', [
  z.object({ entityType: z.literal('bank'), entity: BankEntitySchema }),
  z.object({ entityType: z.literal('counterparty'), entity: CounterpartyEntitySchema }),
  z.object({ entityType: z.literal('receivable'), entity: ReceivableEntitySchema }),
  z.object({ entityType: z.literal('payable'), entity: PayableEntitySchema }),
  z.object({ entityType: z.literal('movement'), entity: MovementEntitySchema }),
  z.object({ entityType: z.literal('commitment'), entity: CommitmentEntitySchema }),
  z.object({ entityType: z.literal('sale'), entity: SaleEntitySchema }),
  z.object({ entityType: z.literal('baseline'), entity: BaselineEntitySchema }),
]);
export type Change = z.infer<typeof ChangeSchema>;

export const SyncPullResponseSchema = z.object({
  changes: z.array(ChangeSchema),
  nextCursor: z.string(),
  hasMore: z.boolean(),
  /** seq máximo incluido en esta página (para reconciliar operaciones aplicadas). */
  maxSeq: z.number().int().min(0),
  serverTime: z.string(),
});
export type SyncPullResponse = z.infer<typeof SyncPullResponseSchema>;

/** Cursor opaco: base64url de { v: 1, seq }. */
export function encodeCursor(seq: number): string {
  const json = JSON.stringify({ v: 1, seq });
  return base64UrlEncode(json);
}

export function decodeCursor(cursor: string | undefined | null): number | null {
  if (!cursor) return 0;
  try {
    const parsed = JSON.parse(base64UrlDecode(cursor)) as { v?: number; seq?: number };
    if (parsed.v !== 1 || !Number.isInteger(parsed.seq) || (parsed.seq ?? -1) < 0) return null;
    return parsed.seq ?? null;
  } catch {
    return null;
  }
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function base64UrlEncode(text: string): string {
  const bytes = Array.from(text, (c) => c.charCodeAt(0) & 0xff);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a = 0, b = 0, c = 0] = [bytes[i], bytes[i + 1], bytes[i + 2]];
    const n = (a << 16) | (b << 8) | c;
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!;
    if (i + 1 < bytes.length) out += ALPHABET[(n >> 6) & 63]!;
    if (i + 2 < bytes.length) out += ALPHABET[n & 63]!;
  }
  return out;
}

function base64UrlDecode(value: string): string {
  if (!/^[A-Za-z0-9\-_]+$/.test(value)) throw new Error('cursor');
  let out = '';
  let buffer = 0;
  let bits = 0;
  for (const ch of value) {
    buffer = (buffer << 6) | ALPHABET.indexOf(ch);
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return out;
}
