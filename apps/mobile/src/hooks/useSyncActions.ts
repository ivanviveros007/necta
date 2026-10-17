import type { OutboxItem } from '../db/localRepository';
import { retryOnRemote } from '../domain/operations';
import { useNecta } from '../app-state/NectaProvider';

/** Resolución explícita de conflictos y rechazos; nunca hay sobrescritura silenciosa. */
export function useSyncActions() {
  const { repo, newId, syncNow } = useNecta();
  return {
    async keepMine(item: OutboxItem) {
      const remote = item.remote?.entity as { version?: number } | undefined;
      if (!repo || !remote?.version) return;
      const op = retryOnRemote(newId, item.operation, remote.version);
      if (!op) return;
      await repo.replace(item.clientMutationId, op);
      void syncNow();
    },
    async keepServer(item: OutboxItem) {
      await repo?.discard(item.clientMutationId);
    },
    async discard(item: OutboxItem) {
      await repo?.discard(item.clientMutationId);
    },
  };
}
