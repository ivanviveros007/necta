import type { CommitmentInput, MovementEntity, SyncOperation } from '@necta/contracts';
import type { LocalWrite } from '../db/localRepository';

export interface Draft {
  operation: SyncOperation;
  write: LocalWrite | null;
}

export type NewId = () => string;

/** Cada operación nueva recibe un clientMutationId nuevo y estable; nunca se reutiliza ni se modifica. */
export function movementCreate(
  newId: NewId,
  input: { kind: 'income' | 'expense'; amount: number; bankId: string; date: string; description: string },
): Draft {
  const clientMutationId = newId();
  const movement = { id: `mv_${clientMutationId}`, ...input };
  return {
    operation: { type: 'movement.create', clientMutationId, dependsOn: [], payload: { movement } },
    write: { entityType: 'movement', entityId: movement.id, localValue: { ...movement, affectsBalance: true, version: 0, deletedAt: null } },
  };
}

export function movementUpdate(newId: NewId, current: MovementEntity, changes: { amount?: number; description?: string }, dependsOn: string[] = []): Draft {
  const clientMutationId = newId();
  return {
    operation: { type: 'movement.update', clientMutationId, dependsOn, entityId: current.id, baseVersion: current.version, payload: { changes } },
    write: { entityType: 'movement', entityId: current.id, localValue: { ...current, ...changes } },
  };
}

export function saleCreate(
  newId: NewId,
  input: { customerId: string; customerName: string; amount: number; paid: boolean; bankId: string; saleDate: string; expiresAt: string | null },
): Draft {
  const clientMutationId = newId();
  const id = `sale_${clientMutationId}`;
  const sale = {
    id,
    customerId: input.customerId,
    items: [{ itemId: 'venta_general', quantitiesSold: 1, finalPrice: input.amount }],
    payments: input.paid ? [{ bankId: input.bankId, amount: input.amount, method: 'efectivo' as const, paymentDate: input.saleDate }] : [],
    saleDate: input.saleDate,
    expiresAt: input.paid ? null : input.expiresAt,
  };
  return {
    operation: { type: 'sale.create', clientMutationId, dependsOn: [], payload: { sale } },
    write: { entityType: 'sale', entityId: id, localValue: { id, customerId: input.customerId, totalAmount: input.amount, paidAmount: input.paid ? input.amount : 0, saleDate: input.saleDate, expiresAt: sale.expiresAt, version: 0, deletedAt: null } },
  };
}

/** Cobro o pago de una deuda. `dependsOn` incluye la venta offline que la creó, si aún no se envió. */
export function debtPayment(
  newId: NewId,
  kind: 'receivable' | 'payable',
  debtId: string,
  input: { amount: number; bankId: string; paymentDate: string },
  dependsOn: string[],
): Draft {
  const clientMutationId = newId();
  return {
    operation: {
      type: kind === 'receivable' ? 'receivable.payment' : 'payable.payment',
      clientMutationId,
      dependsOn,
      entityId: debtId,
      payload: { ...input, method: 'efectivo' },
    },
    // El efecto (pendiente y saldo) lo calcula el motor sobre lo confirmado: no hay vista local que guardar.
    write: null,
  };
}

export function commitmentCreate(newId: NewId, input: Omit<CommitmentInput, 'id'>): Draft {
  const clientMutationId = newId();
  const commitment = { id: `cmt_${clientMutationId}`, ...input };
  return {
    operation: { type: 'commitment.create', clientMutationId, dependsOn: [], payload: { commitment } },
    write: { entityType: 'commitment', entityId: commitment.id, localValue: { ...commitment, version: 0, deletedAt: null } },
  };
}

/** Resolver un conflicto con «usar la mía»: operación nueva sobre la versión remota. */
export function retryOnRemote(newId: NewId, original: SyncOperation, remoteVersion: number): SyncOperation | null {
  if (!('baseVersion' in original) || original.type === 'baseline.update') return null;
  return { ...original, clientMutationId: newId(), baseVersion: remoteVersion } as SyncOperation;
}
