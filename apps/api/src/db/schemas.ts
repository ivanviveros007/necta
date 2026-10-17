import { Schema } from 'mongoose';

/**
 * Colecciones de Necta. Las entidades sincronizables llevan `version` (escritura condicional),
 * `seq` (posición en el log de cambios de la tienda) y `deletedAt` (borrado lógico).
 */
const syncFields = {
  storeId: { type: String, required: true, index: true },
  version: { type: Number, required: true, default: 1 },
  seq: { type: Number, required: true, default: 0 },
  updatedAt: { type: Date, required: true, default: () => new Date() },
  deletedAt: { type: Date, default: null },
};

function syncSchema(definition: Record<string, unknown>): Schema {
  const schema = new Schema({ _id: { type: String, required: true }, ...syncFields, ...definition }, { versionKey: false });
  schema.index({ storeId: 1, seq: 1 });
  return schema;
}

export const UserSchema = new Schema(
  {
    _id: { type: String, required: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true },
    name: { type: String, required: true },
    storeIds: { type: [String], default: [] },
  },
  { versionKey: false },
);

export const StoreSchema = new Schema(
  {
    _id: { type: String, required: true },
    ownerId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    currency: { type: String, required: true },
    timeZone: { type: String, required: true },
    lastDailyReviewDate: { type: String, default: null },
  },
  { versionKey: false },
);

export const BankSchema = syncSchema({
  name: { type: String, required: true },
  storedLedgerBalance: { type: Number, required: true },
  reconstructedBalance: { type: Number, required: true },
  openingBalance: { type: Number, required: true, default: 0 },
  balanceAsOf: { type: Date, default: null },
});

export const CounterpartySchema = syncSchema({
  name: { type: String, required: true },
  kind: { type: String, enum: ['customer', 'supplier'], required: true },
  aggregated: { type: Boolean, default: false },
  history: {
    payments: { type: Number, default: 0 },
    onTime: { type: Number, default: 0 },
    avgDaysLate: { type: Number, default: null },
  },
});

const DebtPaymentSchema = new Schema(
  {
    clientMutationId: { type: String, required: true },
    bankId: { type: String, required: true },
    amount: { type: Number, required: true },
    method: { type: String, required: true },
    paymentDate: { type: String, required: true },
  },
  { _id: false },
);

export const ReceivableSchema = syncSchema({
  counterpartyId: { type: String, default: null },
  counterpartyName: { type: String, required: true },
  totalAmount: { type: Number, required: true },
  pendingAmount: { type: Number, required: true },
  creditDueBy: { type: String, default: null },
  dueHint: { type: String, default: null },
  sourceSaleId: { type: String, default: null },
  payments: { type: [DebtPaymentSchema], default: [] },
});

export const PayableSchema = syncSchema({
  counterpartyId: { type: String, default: null },
  counterpartyName: { type: String, required: true },
  totalAmount: { type: Number, required: true },
  pendingAmount: { type: Number, required: true },
  creditDueBy: { type: String, default: null },
  dueHint: { type: String, default: null },
  negotiable: { type: Boolean, default: true },
  payments: { type: [DebtPaymentSchema], default: [] },
});

export const MovementSchema = syncSchema({
  kind: { type: String, enum: ['income', 'expense'], required: true },
  amount: { type: Number, required: true },
  bankId: { type: String, required: true },
  date: { type: String, required: true },
  description: { type: String, default: '' },
  affectsBalance: { type: Boolean, required: true },
  clientMutationId: { type: String, required: true },
});
MovementSchema.index({ storeId: 1, date: 1 });

export const CommitmentSchema = syncSchema({
  direction: { type: String, enum: ['inflow', 'outflow'], required: true },
  concept: { type: String, required: true },
  amount: { type: Number, required: true },
  schedule: { type: Schema.Types.Mixed, required: true },
  negotiable: { type: Boolean, default: false },
});

export const SaleSchema = syncSchema({
  customerId: { type: String, required: true },
  items: { type: Schema.Types.Mixed, required: true },
  payments: { type: Schema.Types.Mixed, default: [] },
  totalAmount: { type: Number, required: true },
  paidAmount: { type: Number, required: true },
  saleDate: { type: String, required: true },
  expiresAt: { type: String, default: null },
  clientMutationId: { type: String, required: true },
});
SaleSchema.index({ storeId: 1, saleDate: 1 });

export const BaselineSchema = syncSchema({
  weekdaySales: { type: [Number], required: true },
  weekdayExpenses: { type: [Number], required: true },
});

export const BankAdjustmentSchema = new Schema(
  {
    _id: { type: String, required: true },
    storeId: { type: String, required: true, index: true },
    bankId: { type: String, required: true },
    userId: { type: String, required: true },
    previousBalance: { type: Number, required: true },
    newBalance: { type: Number, required: true },
    reason: { type: String, required: true },
    createdAt: { type: Date, required: true },
  },
  { versionKey: false },
);

/** Registro de idempotencia: (storeId, clientMutationId) único, en la misma transacción que los efectos. */
export const OperationSchema = new Schema(
  {
    storeId: { type: String, required: true },
    clientMutationId: { type: String, required: true },
    type: { type: String, required: true },
    payloadHash: { type: String, required: true },
    seq: { type: Number, required: true },
    result: { type: Schema.Types.Mixed, required: true },
    userId: { type: String, required: true },
    platform: { type: String, default: null },
    createdAt: { type: Date, required: true },
  },
  { versionKey: false },
);
OperationSchema.index({ storeId: 1, clientMutationId: 1 }, { unique: true });

export const CounterSchema = new Schema(
  { _id: { type: String, required: true }, seq: { type: Number, required: true, default: 0 } },
  { versionKey: false },
);

export const ForecastSnapshotSchema = new Schema(
  {
    storeId: { type: String, required: true },
    computedAt: { type: Date, required: true },
    cutoff: { type: String, required: true },
    dataVersion: { type: Number, required: true },
    status: { type: String, required: true },
    result: { type: Schema.Types.Mixed, required: true },
  },
  { versionKey: false },
);
ForecastSnapshotSchema.index({ storeId: 1, computedAt: -1 });

export const AlertSchema = new Schema(
  {
    _id: { type: String, required: true },
    storeId: { type: String, required: true },
    dedupKey: { type: String, required: true },
    kind: { type: String, required: true },
    scenario: { type: String, required: true },
    severity: { type: String, required: true },
    shortfallDate: { type: String, required: true },
    amount: { type: Number, required: true },
    headline: { type: String, required: true },
    detail: { type: String, required: true },
    status: { type: String, enum: ['active', 'resolved'], required: true },
    acknowledgedAt: { type: Date, default: null },
    notifiedCount: { type: Number, default: 0 },
    lastNotifiedAmount: { type: Number, default: 0 },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { versionKey: false },
);
AlertSchema.index({ storeId: 1, dedupKey: 1 }, { unique: true });

export const NotificationDeliverySchema = new Schema(
  {
    _id: { type: String, required: true },
    storeId: { type: String, required: true },
    alertId: { type: String, required: true },
    userId: { type: String, required: true },
    channel: { type: String, enum: ['push', 'email'], required: true },
    round: { type: Number, default: 1 },
    status: { type: String, required: true },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: null },
    receiptCheckAt: { type: Date, default: null },
    ticketId: { type: String, default: null },
    receipt: { type: String, default: null },
    lastError: { type: String, default: null },
    recipient: { type: String, required: true },
    subject: { type: String, required: true },
    body: { type: String, required: true },
    createdAt: { type: Date, required: true },
    updatedAt: { type: Date, required: true },
  },
  { versionKey: false },
);
NotificationDeliverySchema.index({ status: 1, nextAttemptAt: 1 });

export const ReviewQueueSchema = new Schema(
  {
    _id: { type: String, required: true },
    dueAt: { type: Date, required: true },
    reasons: { type: [String], default: [] },
  },
  { versionKey: false },
);

export const DeviceSchema = new Schema(
  {
    _id: { type: String, required: true },
    userId: { type: String, required: true, index: true },
    expoPushToken: { type: String, required: true, unique: true },
    platform: { type: String, required: true },
    timeZone: { type: String, required: true },
    updatedAt: { type: Date, required: true },
  },
  { versionKey: false },
);

export const PreferenceSchema = new Schema(
  {
    _id: { type: String, required: true },
    receivableDueSoon: { type: Boolean, default: true },
    receivableOverdue: { type: Boolean, default: true },
    payableDueSoon: { type: Boolean, default: true },
    cashShortfall: { type: Boolean, default: true },
    emailFallback: { type: Boolean, default: true },
  },
  { versionKey: false },
);

export const MODELS = {
  User: 'User',
  Store: 'Store',
  Bank: 'Bank',
  Counterparty: 'Counterparty',
  Receivable: 'Receivable',
  Payable: 'Payable',
  Movement: 'Movement',
  Commitment: 'Commitment',
  Sale: 'Sale',
  Baseline: 'Baseline',
  BankAdjustment: 'BankAdjustment',
  Operation: 'Operation',
  Counter: 'Counter',
  ForecastSnapshot: 'ForecastSnapshot',
  Alert: 'Alert',
  NotificationDelivery: 'NotificationDelivery',
  ReviewQueue: 'ReviewQueue',
  Device: 'Device',
  Preference: 'Preference',
} as const;

export const MODEL_DEFINITIONS = [
  { name: MODELS.User, schema: UserSchema },
  { name: MODELS.Store, schema: StoreSchema },
  { name: MODELS.Bank, schema: BankSchema },
  { name: MODELS.Counterparty, schema: CounterpartySchema },
  { name: MODELS.Receivable, schema: ReceivableSchema },
  { name: MODELS.Payable, schema: PayableSchema },
  { name: MODELS.Movement, schema: MovementSchema },
  { name: MODELS.Commitment, schema: CommitmentSchema },
  { name: MODELS.Sale, schema: SaleSchema },
  { name: MODELS.Baseline, schema: BaselineSchema },
  { name: MODELS.BankAdjustment, schema: BankAdjustmentSchema },
  { name: MODELS.Operation, schema: OperationSchema },
  { name: MODELS.Counter, schema: CounterSchema },
  { name: MODELS.ForecastSnapshot, schema: ForecastSnapshotSchema },
  { name: MODELS.Alert, schema: AlertSchema },
  { name: MODELS.NotificationDelivery, schema: NotificationDeliverySchema },
  { name: MODELS.ReviewQueue, schema: ReviewQueueSchema },
  { name: MODELS.Device, schema: DeviceSchema },
  { name: MODELS.Preference, schema: PreferenceSchema },
];
