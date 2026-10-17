import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { ApiError } from '../api/client';
import { api } from '../api/endpoints';

export const keys = {
  forecast: ['forecast'] as const,
  banks: ['banks'] as const,
  counterparties: ['counterparties'] as const,
  receivables: ['receivables'] as const,
  payables: ['payables'] as const,
  movements: ['movements'] as const,
  commitments: ['commitments'] as const,
  alerts: ['alerts'] as const,
};

export const useForecast = () => useQuery({ queryKey: keys.forecast, queryFn: api.forecast });
export const useBanks = () => useQuery({ queryKey: keys.banks, queryFn: api.banks });
export const useCounterparties = () => useQuery({ queryKey: keys.counterparties, queryFn: api.counterparties });
export const useReceivables = () => useQuery({ queryKey: keys.receivables, queryFn: api.receivables });
export const usePayables = () => useQuery({ queryKey: keys.payables, queryFn: api.payables });
export const useMovements = () => useQuery({ queryKey: keys.movements, queryFn: api.movements });
export const useCommitments = () => useQuery({ queryKey: keys.commitments, queryFn: api.commitments });
export const useAlerts = () => useQuery({ queryKey: keys.alerts, queryFn: api.alerts });

const newId = () => `web_${crypto.randomUUID()}`;

/**
 * Un clientMutationId por intento de guardado: se conserva en reintentos (si la respuesta se
 * perdió, el servidor no duplica) y se renueva solo después de un guardado exitoso.
 */
export function useMutationId(): [string, () => void] {
  const [id, setId] = useState(newId);
  const renew = useCallback(() => setId(newId()), []);
  return [id, renew];
}

/** Envía una operación y, al confirmarse, vuelve a consultar todo lo que depende de ella. */
export function useRecord<TArgs>(fn: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (args: TArgs) => {
      const result = await fn(args);
      const first = (result as { results?: { status: string; error?: { code: string; message: string } }[] })?.results?.[0];
      if (first && first.status !== 'applied' && first.status !== 'duplicate') {
        throw new ApiError(422, (first.error?.code ?? 'INTERNAL_ERROR') as never, first.error?.message ?? 'Rechazado');
      }
      return result;
    },
    networkMode: 'always',
    onSuccess: () => queryClient.invalidateQueries(),
  });
}
