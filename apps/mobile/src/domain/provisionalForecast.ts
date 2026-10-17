import { applyPendingOperations, buildForecastInput, computeForecast, type ForecastResult, type StoreSnapshot } from '@necta/cash-engine';
import type { LocalRepository, OutboxItem } from '../db/localRepository';

export interface LocalView {
  /** Estado confirmado + operaciones no conciliadas aplicadas una sola vez. */
  snapshot: StoreSnapshot;
  /** Solo lo confirmado por el servidor (para no listar dos veces lo pendiente). */
  confirmed: StoreSnapshot;
  outbox: OutboxItem[];
  forecast: ForecastResult;
  pendingCount: number;
  provisional: boolean;
}

/** Mismo motor que el servidor: con 0 pendientes el resultado coincide con el confirmado. */
export async function computeLocalView(repo: LocalRepository): Promise<LocalView | null> {
  const confirmed = await repo.confirmedSnapshot();
  if (!confirmed || confirmed.banks.length === 0) return null;
  const active = await repo.activeOperations();
  const outbox = await repo.outbox();
  const pendingCount = outbox.filter((o) => o.status === 'pending' || o.status === 'sending').length;
  const snapshot = applyPendingOperations(confirmed, active);
  return { snapshot, confirmed, outbox, forecast: computeForecast(buildForecastInput(snapshot)), pendingCount, provisional: active.length > 0 };
}
