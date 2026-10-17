import { z } from 'zod';
import { AmountSchema, ClientMutationIdSchema, IdSchema, LocalDateSchema, NonNegativeAmountSchema, SyncMetaSchema } from './common';

// ---------- Contratos existentes del anexo (nombres de campo reales) ----------

export const SaleItemSchema = z.object({
  itemId: IdSchema,
  quantitiesSold: z.number().positive(),
  finalPrice: z.number().int().min(0),
});

export const PaymentMethodSchema = z.enum(['efectivo', 'transferencia', 'tarjeta', 'otro']);

export const SalePaymentSchema = z.object({
  bankId: IdSchema,
  amount: AmountSchema,
  method: PaymentMethodSchema.default('efectivo'),
  paymentDate: LocalDateSchema,
});

export const SaleSchema = z.object({
  /** Extensión: id generado por el cliente; la cuenta por cobrar usa el mismo id. */
  id: IdSchema.optional(),
  customerId: IdSchema,
  items: z.array(SaleItemSchema).min(1),
  payments: z.array(SalePaymentSchema).default([]),
  saleDate: LocalDateSchema,
  expiresAt: LocalDateSchema.nullish(),
});
export type SaleInput = z.infer<typeof SaleSchema>;

export const SaleBatchRequestSchema = z.object({
  batchId: IdSchema,
  sales: z
    .array(z.object({ clientMutationId: ClientMutationIdSchema, sale: SaleSchema }))
    .min(1)
    .max(200),
});
export type SaleBatchRequest = z.infer<typeof SaleBatchRequestSchema>;

/** POST /v2/receivables/:id/payments y /v2/payables/:id/payments (clientMutationId es extensión). */
export const DebtPaymentRequestSchema = z.object({
  clientMutationId: ClientMutationIdSchema,
  bankId: IdSchema,
  amount: AmountSchema,
  method: PaymentMethodSchema.default('efectivo'),
  paymentDate: LocalDateSchema,
});
export type DebtPaymentRequest = z.infer<typeof DebtPaymentRequestSchema>;

export const BankProjectionSchema = z.object({
  storedLedgerBalance: z.number().int(),
  projectedBalance: z.number().int(),
  alignmentDelta: z.number().int(),
});
export type BankProjection = z.infer<typeof BankProjectionSchema>;

// ---------- Extensiones ----------

export const MovementKindSchema = z.enum(['income', 'expense']);

export const MovementInputSchema = z.object({
  id: IdSchema,
  kind: MovementKindSchema,
  amount: AmountSchema,
  bankId: IdSchema,
  date: LocalDateSchema,
  description: z.string().trim().max(200).default(''),
});
export type MovementInput = z.infer<typeof MovementInputSchema>;

export const MovementCreateRequestSchema = z.object({
  clientMutationId: ClientMutationIdSchema,
  movement: MovementInputSchema,
});

export const MovementChangesSchema = z
  .object({
    amount: AmountSchema.optional(),
    description: z.string().trim().max(200).optional(),
    date: LocalDateSchema.optional(),
  })
  .refine((c) => Object.keys(c).length > 0, 'Sin cambios');

export const VersionedChangeRequestSchema = <T extends z.ZodTypeAny>(changes: T) =>
  z.object({ clientMutationId: ClientMutationIdSchema, baseVersion: z.number().int().min(1), changes });

export const MovementUpdateRequestSchema = VersionedChangeRequestSchema(MovementChangesSchema);
export const DeleteRequestSchema = z.object({ clientMutationId: ClientMutationIdSchema, baseVersion: z.number().int().min(1) });

export const ScheduleSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('once'), date: LocalDateSchema }),
  z.object({
    kind: z.literal('monthly'),
    daysOfMonth: z.array(z.number().int().min(1).max(31)).min(1).max(4),
    startDate: LocalDateSchema,
    endDate: LocalDateSchema.nullish(),
  }),
]);
export type ScheduleInput = z.infer<typeof ScheduleSchema>;

export const CommitmentInputSchema = z.object({
  id: IdSchema,
  direction: z.enum(['inflow', 'outflow']),
  concept: z.string().trim().min(1).max(120),
  amount: AmountSchema,
  schedule: ScheduleSchema,
  negotiable: z.boolean().default(false),
});
export type CommitmentInput = z.infer<typeof CommitmentInputSchema>;

export const CommitmentCreateRequestSchema = z.object({
  clientMutationId: ClientMutationIdSchema,
  commitment: CommitmentInputSchema,
});

export const CommitmentChangesSchema = z
  .object({
    concept: z.string().trim().min(1).max(120).optional(),
    amount: AmountSchema.optional(),
    schedule: ScheduleSchema.optional(),
    negotiable: z.boolean().optional(),
  })
  .refine((c) => Object.keys(c).length > 0, 'Sin cambios');
export const CommitmentUpdateRequestSchema = VersionedChangeRequestSchema(CommitmentChangesSchema);

export const WeekAmountsSchema = z.array(NonNegativeAmountSchema).length(7);
export const BaselineInputSchema = z.object({ weekdaySales: WeekAmountsSchema, weekdayExpenses: WeekAmountsSchema });
export const BaselineUpdateRequestSchema = z.object({
  clientMutationId: ClientMutationIdSchema,
  baseVersion: z.number().int().min(0),
  baseline: BaselineInputSchema,
});

export const BankAdjustmentRequestSchema = z.object({
  clientMutationId: ClientMutationIdSchema,
  newBalance: z.number().int(),
  reason: z.string().trim().min(3).max(200),
});

// ---------- Entidades tal como las devuelve la API / el pull ----------

export const BankEntitySchema = SyncMetaSchema.extend({
  id: IdSchema,
  name: z.string(),
  storedLedgerBalance: z.number().int(),
  reconstructedBalance: z.number().int(),
  balanceAsOf: z.string().nullable(),
});
export type BankEntity = z.infer<typeof BankEntitySchema>;

export const PaymentHistorySchema = z.object({
  payments: z.number().int().min(0),
  onTime: z.number().int().min(0),
  avgDaysLate: z.number().nullable(),
});

export const CounterpartyEntitySchema = SyncMetaSchema.extend({
  id: IdSchema,
  name: z.string(),
  kind: z.enum(['customer', 'supplier']),
  aggregated: z.boolean(),
  history: PaymentHistorySchema,
});
export type CounterpartyEntity = z.infer<typeof CounterpartyEntitySchema>;

export const DebtPaymentEntitySchema = z.object({
  clientMutationId: z.string(),
  bankId: z.string(),
  amount: z.number().int(),
  method: z.string(),
  paymentDate: LocalDateSchema,
});

export const ReceivableEntitySchema = SyncMetaSchema.extend({
  id: IdSchema,
  counterpartyId: z.string().nullable(),
  counterpartyName: z.string(),
  totalAmount: z.number().int(),
  pendingAmount: z.number().int(),
  creditDueBy: LocalDateSchema.nullable(),
  dueHint: z.string().nullable(),
  payments: z.array(DebtPaymentEntitySchema),
});
export type ReceivableEntity = z.infer<typeof ReceivableEntitySchema>;

export const PayableEntitySchema = ReceivableEntitySchema.extend({ negotiable: z.boolean() });
export type PayableEntity = z.infer<typeof PayableEntitySchema>;

export const MovementEntitySchema = SyncMetaSchema.extend({
  id: IdSchema,
  kind: MovementKindSchema,
  amount: z.number().int(),
  bankId: z.string(),
  date: LocalDateSchema,
  description: z.string(),
  affectsBalance: z.boolean(),
});
export type MovementEntity = z.infer<typeof MovementEntitySchema>;

export const CommitmentEntitySchema = SyncMetaSchema.extend(CommitmentInputSchema.shape);
export type CommitmentEntity = z.infer<typeof CommitmentEntitySchema>;

export const SaleEntitySchema = SyncMetaSchema.extend({
  id: IdSchema,
  customerId: z.string(),
  totalAmount: z.number().int(),
  paidAmount: z.number().int(),
  saleDate: LocalDateSchema,
  expiresAt: LocalDateSchema.nullable(),
});
export type SaleEntity = z.infer<typeof SaleEntitySchema>;

export const BaselineEntitySchema = SyncMetaSchema.extend({
  id: IdSchema,
  weekdaySales: z.array(z.number().int()),
  weekdayExpenses: z.array(z.number().int()),
});
export type BaselineEntity = z.infer<typeof BaselineEntitySchema>;

export const StoreInfoSchema = z.object({
  id: IdSchema,
  name: z.string(),
  currency: z.string(),
  timeZone: z.string(),
  businessDate: LocalDateSchema,
  todayPolicy: z.enum(['fullDay', 'none']),
});
export type StoreInfo = z.infer<typeof StoreInfoSchema>;
