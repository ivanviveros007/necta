import type { TodayItem } from '@necta/cash-engine';
import type { MovementEntity, SyncOperation } from '@necta/contracts';
import { useNecta } from '../app-state/NectaProvider';
import { movementDelete, movementUpdate, paymentVoid } from '../domain/operations';

export interface MovementChanges {
  amount: number;
  description: string;
  date: string;
}

export class EditNotAllowedError extends Error {}

/**
 * Corregir o borrar un ingreso/gasto, según su estado:
 * - creado en el teléfono y aún sin enviar → se reemplaza la operación de alta (un solo envío);
 * - enviándose → hay que esperar la confirmación;
 * - confirmado → edición con la versión conocida; si ya había una edición sin enviar, se reemplaza.
 */
export function useMovementEditor() {
  const { repo, newId, syncNow } = useNecta();

  async function pendingEditOf(movementId: string) {
    const outbox = (await repo!.outbox()).filter((o) => o.entityId === movementId && o.status === 'pending');
    return outbox.find((o) => o.type === 'movement.update' || o.type === 'movement.delete') ?? null;
  }

  async function confirmedMovement(movementId: string): Promise<MovementEntity> {
    const all = await repo!.entities<MovementEntity>('movement');
    const confirmed = await repo!.confirmedSnapshot();
    const m = confirmed?.movements.find((x) => x.id === movementId) as MovementEntity | undefined;
    const local = all.find((x) => x.value.id === movementId)?.value;
    if (!m && !local) throw new EditNotAllowedError('No se encontró el movimiento');
    return (m ?? local)!;
  }

  function assertEditable(item: TodayItem) {
    if (!item.movementId) throw new EditNotAllowedError('Este registro no se puede editar');
    if (item.state === 'pending' && !item.pendingClientMutationId) {
      throw new EditNotAllowedError('Se está enviando. Podrás corregirlo en unos segundos.');
    }
  }

  return {
    async save(item: TodayItem, changes: MovementChanges) {
      assertEditable(item);
      if (item.pendingClientMutationId) {
        const create = (await repo!.outbox()).find((o) => o.clientMutationId === item.pendingClientMutationId);
        if (!create || create.operation.type !== 'movement.create') throw new EditNotAllowedError('Se está enviando. Podrás corregirlo en unos segundos.');
        const movement = { ...create.operation.payload.movement, ...changes };
        await repo!.replace(create.clientMutationId, { ...create.operation, clientMutationId: newId(), payload: { movement } } as SyncOperation);
      } else {
        const current = await confirmedMovement(item.movementId!);
        const previous = await pendingEditOf(current.id);
        const draft = movementUpdate(newId, current, changes);
        if (previous && 'baseVersion' in previous.operation) {
          await repo!.replace(previous.clientMutationId, { ...draft.operation, baseVersion: previous.operation.baseVersion } as SyncOperation);
        } else {
          await repo!.record(draft.operation, draft.write);
        }
      }
      void syncNow();
    },
    /** Anular un cobro/pago: si aún no se envió se quita de la cola; si ya se confirmó, operación de anulación. */
    async voidPayment(item: TodayItem) {
      if (!item.payment) throw new EditNotAllowedError('Este registro no es un cobro ni un pago');
      if (item.pendingClientMutationId) {
        await repo!.discard(item.pendingClientMutationId);
        return;
      }
      if (item.state === 'pending') throw new EditNotAllowedError('Se está enviando. Podrás anularlo en unos segundos.');
      const draft = paymentVoid(newId, item.payment);
      await repo!.record(draft.operation, draft.write);
      void syncNow();
    },
    async remove(item: TodayItem) {
      assertEditable(item);
      if (item.pendingClientMutationId) {
        await repo!.discard(item.pendingClientMutationId);
        return;
      }
      const current = await confirmedMovement(item.movementId!);
      const previous = await pendingEditOf(current.id);
      const draft = movementDelete(newId, current);
      if (previous && 'baseVersion' in previous.operation) {
        await repo!.replace(previous.clientMutationId, { ...draft.operation, baseVersion: previous.operation.baseVersion } as SyncOperation);
      } else {
        await repo!.record(draft.operation, draft.write);
      }
      void syncNow();
    },
  };
}
