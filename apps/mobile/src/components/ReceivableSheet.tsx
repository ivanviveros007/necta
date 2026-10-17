import { useCallback } from 'react';
import { useRecordContext } from '../hooks/useRecordContext';
import { ReceivableSheetContent } from './collect';
import { Sheet } from './sync';

/** Hoja de un cobro (Ya pagó / Paga otro día), reutilizable desde cualquier pantalla. */
export function ReceivableSheet({ receivableId, onClose }: { receivableId: string | null; onClose: () => void }) {
  const close = useCallback(() => onClose(), [onClose]);
  const ctx = useRecordContext(close);
  const receivable = receivableId ? ctx?.snapshot.receivables.find((r) => r.id === receivableId) : undefined;
  return (
    <Sheet open={Boolean(receivable)} onClose={close}>
      {receivable && ctx ? <ReceivableSheetContent receivable={receivable} ctx={ctx} onClose={close} /> : null}
    </Sheet>
  );
}
