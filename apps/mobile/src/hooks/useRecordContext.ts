import { businessDateCaption } from '@necta/cash-engine';
import { useMemo } from 'react';
import { useLocalView, useNecta } from '../app-state/NectaProvider';

/** Lo que necesitan los formularios y hojas de registro: estado local, ids y guardado en SQLite + outbox. */
export function useRecordContext(onDone?: () => void) {
  const { record, newId, repo, simulatedDate } = useNecta();
  const view = useLocalView();
  const v = view.data;
  return useMemo(
    () =>
      v
        ? {
            snapshot: v.snapshot,
            businessDate: v.snapshot.businessDate,
            dateCaption: businessDateCaption(v.snapshot.businessDate, simulatedDate),
            newId,
            onSubmit: record,
            creatorOf: (id: string) => repo?.creatorOf(id) ?? Promise.resolve(null),
            onDone,
          }
        : null,
    [v, newId, record, repo, onDone, simulatedDate],
  );
}
