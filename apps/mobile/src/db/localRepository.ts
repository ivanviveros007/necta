import type { PendingOperation, StoreSnapshot } from '@necta/cash-engine';
import type {
  BankEntity,
  BaselineEntity,
  Change,
  CommitmentEntity,
  CounterpartyEntity,
  EntityType,
  MovementEntity,
  OperationResult,
  PayableEntity,
  ReceivableEntity,
  SaleEntity,
  StoreInfo,
  SyncOperation,
} from '@necta/contracts';
import { MIGRATIONS, type SqlDatabase, type SqlExecutor } from './sql';

/** Estados de una operación local. Las de efecto activo se aplican una vez a la proyección provisional. */
export type OutboxStatus = 'pending' | 'sending' | 'applied' | 'conflict' | 'rejected' | 'blocked';
export const ACTIVE_STATUSES: OutboxStatus[] = ['pending', 'sending', 'applied'];

export interface OutboxItem {
  clientMutationId: string;
  localSeq: number;
  type: SyncOperation['type'];
  entityType: EntityType | null;
  entityId: string | null;
  operation: SyncOperation;
  status: OutboxStatus;
  attempts: number;
  lastError: string | null;
  errorCode: string | null;
  serverSeq: number | null;
  remote: { entityType: EntityType; entity: Record<string, unknown> } | null;
  createdAt: string;
}

interface OutboxRow {
  client_mutation_id: string;
  local_seq: number;
  type: SyncOperation['type'];
  entity_type: EntityType | null;
  entity_id: string | null;
  operation: string;
  status: OutboxStatus;
  attempts: number;
  last_error: string | null;
  error_code: string | null;
  server_seq: number | null;
  remote: string | null;
  created_at: string;
}

interface EntityRow {
  type: EntityType;
  id: string;
  data: string | null;
  local_data: string | null;
  sync_state: 'synced' | 'pending';
}

export interface LocalEntity<T> {
  value: T;
  pending: boolean;
}

export interface LocalWrite {
  entityType: EntityType;
  entityId: string;
  /** Vista local de la entidad (para listas); el estado confirmado no se toca. */
  localValue: Record<string, unknown> | null;
}

const toItem = (r: OutboxRow): OutboxItem => ({
  clientMutationId: r.client_mutation_id,
  localSeq: r.local_seq,
  type: r.type,
  entityType: r.entity_type,
  entityId: r.entity_id,
  operation: JSON.parse(r.operation) as SyncOperation,
  status: r.status,
  attempts: r.attempts,
  lastError: r.last_error,
  errorCode: r.error_code,
  serverSeq: r.server_seq,
  remote: r.remote ? JSON.parse(r.remote) : null,
  createdAt: r.created_at,
});

type Listener = () => void;

/**
 * Fuente de trabajo del móvil. Guarda el estado confirmado por el servidor (`data`), la vista local
 * (`local_data`) y la outbox. Toda escritura que afecta a ambas va en una transacción exclusiva.
 */
export class LocalRepository {
  private listeners = new Set<Listener>();

  constructor(
    readonly db: SqlDatabase,
    private readonly now: () => Date = () => new Date(),
  ) {}

  static async open(db: SqlDatabase, now?: () => Date): Promise<LocalRepository> {
    await db.execAsync(MIGRATIONS);
    const repo = new LocalRepository(db, now);
    // Si la app se cerró en medio de un envío, se reenvía (es idempotente).
    await db.runAsync(`UPDATE outbox SET status = 'pending' WHERE status = 'sending'`, []);
    return repo;
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.listeners.forEach((l) => l());
  }

  // ---------- meta ----------

  async getMeta(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>(`SELECT value FROM meta WHERE key = ?`, [key]);
    return row?.value ?? null;
  }

  async setMeta(key: string, value: string, exec: SqlExecutor = this.db): Promise<void> {
    await exec.runAsync(`INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, [key, value]);
  }

  async saveStore(store: StoreInfo): Promise<void> {
    await this.setMeta('store', JSON.stringify(store));
  }

  // ---------- captura local ----------

  /** Entidad local + operación en la outbox, en una sola transacción. */
  async record(operation: SyncOperation, write: LocalWrite | null): Promise<void> {
    await this.db.withExclusiveTransactionAsync(async (txn) => {
      const next = await txn.getFirstAsync<{ n: number }>(`SELECT COALESCE(MAX(local_seq), 0) + 1 AS n FROM outbox`, []);
      await txn.runAsync(
        `INSERT INTO outbox (client_mutation_id, local_seq, type, entity_type, entity_id, operation, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [operation.clientMutationId, next?.n ?? 1, operation.type, write?.entityType ?? null, write?.entityId ?? null, JSON.stringify(operation), this.now().toISOString()],
      );
      if (write) {
        await txn.runAsync(
          `INSERT INTO entities (type, id, local_data, sync_state) VALUES (?, ?, ?, 'pending')
           ON CONFLICT(type, id) DO UPDATE SET local_data = excluded.local_data, sync_state = 'pending'`,
          [write.entityType, write.entityId, write.localValue ? JSON.stringify(write.localValue) : null],
        );
      }
    });
    this.notify();
  }

  async outbox(): Promise<OutboxItem[]> {
    const rows = await this.db.getAllAsync<OutboxRow>(`SELECT * FROM outbox ORDER BY local_seq`, []);
    return rows.map(toItem);
  }

  /** Operación aún no final que crea la entidad (para declarar dependencias). */
  async creatorOf(entityId: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ client_mutation_id: string }>(
      `SELECT client_mutation_id FROM outbox WHERE entity_id = ? AND type IN ('sale.create', 'movement.create', 'commitment.create')
       AND status IN ('pending', 'sending') ORDER BY local_seq LIMIT 1`,
      [entityId],
    );
    return row?.client_mutation_id ?? null;
  }

  async markSending(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    await this.db.runAsync(
      `UPDATE outbox SET status = 'sending', attempts = attempts + 1 WHERE client_mutation_id IN (${ids.map(() => '?').join(',')})`,
      ids,
    );
  }

  async revertSending(error: string | null): Promise<void> {
    await this.db.runAsync(`UPDATE outbox SET status = 'pending', last_error = ? WHERE status = 'sending'`, [error]);
    this.notify();
  }

  /** Guarda el resultado por operación del push. Las aplicadas siguen contando hasta el pull. */
  async applyPushResults(results: OperationResult[]): Promise<void> {
    await this.db.withExclusiveTransactionAsync(async (txn) => {
      for (const r of results) {
        if (r.status === 'applied' || r.status === 'duplicate') {
          await txn.runAsync(`UPDATE outbox SET status = 'applied', server_seq = ?, last_error = NULL, error_code = NULL WHERE client_mutation_id = ?`, [r.seq ?? 0, r.clientMutationId]);
        } else if (r.status === 'conflict') {
          await txn.runAsync(`UPDATE outbox SET status = 'conflict', remote = ?, last_error = ?, error_code = ? WHERE client_mutation_id = ?`, [
            JSON.stringify(r.remote ?? null),
            r.error?.message ?? null,
            r.error?.code ?? 'VERSION_CONFLICT',
            r.clientMutationId,
          ]);
        } else {
          await txn.runAsync(`UPDATE outbox SET status = ?, last_error = ?, error_code = ? WHERE client_mutation_id = ?`, [
            r.status,
            r.error?.message ?? null,
            r.error?.code ?? null,
            r.clientMutationId,
          ]);
        }
      }
    });
    this.notify();
  }

  /**
   * Aplica una página del pull en una transacción: estado confirmado, cursor y borrado de las
   * operaciones ya incluidas (server_seq ≤ maxSeq). Así ningún efecto se cuenta dos veces.
   */
  async applyPullPage(changes: Change[], nextCursor: string, maxSeq: number): Promise<void> {
    await this.db.withExclusiveTransactionAsync(async (txn) => {
      for (const c of changes) {
        const e = c.entity as { id: string; version: number; seq: number; deletedAt: string | null };
        await txn.runAsync(
          `INSERT INTO entities (type, id, data, version, seq, deleted, sync_state) VALUES (?, ?, ?, ?, ?, ?, 'synced')
           ON CONFLICT(type, id) DO UPDATE SET data = excluded.data, version = excluded.version, seq = excluded.seq, deleted = excluded.deleted`,
          [c.entityType, e.id, JSON.stringify(e), e.version, e.seq, e.deletedAt ? 1 : 0],
        );
      }
      await txn.runAsync(`DELETE FROM outbox WHERE status = 'applied' AND server_seq <= ?`, [maxSeq]);
      // Vista local: se limpia cuando ya no queda ninguna operación sin conciliar sobre la entidad.
      await txn.runAsync(
        `UPDATE entities SET local_data = NULL, sync_state = 'synced'
         WHERE sync_state = 'pending' AND NOT EXISTS (
           SELECT 1 FROM outbox o WHERE o.entity_type = entities.type AND o.entity_id = entities.id
         )`,
        [],
      );
      await txn.runAsync(`DELETE FROM entities WHERE data IS NULL AND local_data IS NULL`, []);
      await this.setMeta('cursor', nextCursor, txn);
      await this.setMeta('max_seq', String(maxSeq), txn);
    });
    this.notify();
  }

  /** Resolución explícita: descarta la operación (y su vista local) sin tocar lo confirmado. */
  async discard(clientMutationId: string): Promise<void> {
    await this.db.withExclusiveTransactionAsync(async (txn) => {
      const row = await txn.getFirstAsync<OutboxRow>(`SELECT * FROM outbox WHERE client_mutation_id = ?`, [clientMutationId]);
      if (!row) return;
      await txn.runAsync(`DELETE FROM outbox WHERE client_mutation_id = ?`, [clientMutationId]);
      if (row.entity_type && row.entity_id) {
        const others = await txn.getFirstAsync<{ n: number }>(
          `SELECT COUNT(*) AS n FROM outbox WHERE entity_type = ? AND entity_id = ?`,
          [row.entity_type, row.entity_id],
        );
        if ((others?.n ?? 0) === 0) {
          await txn.runAsync(`UPDATE entities SET local_data = NULL, sync_state = 'synced' WHERE type = ? AND id = ?`, [row.entity_type, row.entity_id]);
          await txn.runAsync(`DELETE FROM entities WHERE type = ? AND id = ? AND data IS NULL`, [row.entity_type, row.entity_id]);
        }
      }
    });
    this.notify();
  }

  /** «Usar la mía»: reemplaza la operación en conflicto por una nueva sobre la versión remota, atómicamente. */
  async replace(oldClientMutationId: string, operation: SyncOperation): Promise<void> {
    await this.db.withExclusiveTransactionAsync(async (txn) => {
      const old = await txn.getFirstAsync<OutboxRow>(`SELECT * FROM outbox WHERE client_mutation_id = ?`, [oldClientMutationId]);
      if (!old) return;
      const next = await txn.getFirstAsync<{ n: number }>(`SELECT COALESCE(MAX(local_seq), 0) + 1 AS n FROM outbox`, []);
      await txn.runAsync(`DELETE FROM outbox WHERE client_mutation_id = ?`, [oldClientMutationId]);
      await txn.runAsync(
        `INSERT INTO outbox (client_mutation_id, local_seq, type, entity_type, entity_id, operation, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
        [operation.clientMutationId, next?.n ?? 1, operation.type, old.entity_type, old.entity_id, JSON.stringify(operation), this.now().toISOString()],
      );
    });
    this.notify();
  }

  /**
   * Borra la copia local confirmada y el cursor para volver a descargar todo (p. ej. tras resembrar la
   * base de demo). Se niega si hay operaciones sin conciliar: nunca se pierde un registro pendiente.
   */
  async resetLocalCopy(): Promise<void> {
    const pending = await this.db.getFirstAsync<{ n: number }>(`SELECT COUNT(*) AS n FROM outbox`, []);
    if ((pending?.n ?? 0) > 0) throw new Error('Hay registros sin enviar: sincroniza o resuélvelos antes de volver a descargar.');
    await this.db.withExclusiveTransactionAsync(async (txn) => {
      await txn.runAsync(`DELETE FROM entities`, []);
      await txn.runAsync(`DELETE FROM meta WHERE key IN ('cursor', 'max_seq', 'last_sync_at', 'server_forecast')`, []);
    });
    this.notify();
  }

  // ---------- lecturas ----------

  async entities<T>(type: EntityType): Promise<LocalEntity<T>[]> {
    const rows = await this.db.getAllAsync<EntityRow>(`SELECT type, id, data, local_data, sync_state FROM entities WHERE type = ? AND deleted = 0`, [type]);
    return rows
      .filter((r) => r.local_data !== null || r.data !== null)
      .map((r) => ({ value: JSON.parse((r.local_data ?? r.data)!) as T, pending: r.sync_state === 'pending' }))
      .filter((e) => !(e.value as { deletedAt?: string | null }).deletedAt);
  }

  /** Estado confirmado por el servidor, con la forma que usa el motor. */
  async confirmedSnapshot(): Promise<StoreSnapshot | null> {
    const storeRaw = await this.getMeta('store');
    if (!storeRaw) return null;
    const store = JSON.parse(storeRaw) as StoreInfo;
    // La fecha de negocio confirmada por el servidor en la última sincronización tiene prioridad.
    const businessDate = (await this.getMeta('business_date')) ?? store.businessDate;
    const rows = await this.db.getAllAsync<{ type: EntityType; data: string }>(`SELECT type, data FROM entities WHERE data IS NOT NULL AND deleted = 0`, []);
    const of = <T>(type: EntityType) => rows.filter((r) => r.type === type).map((r) => JSON.parse(r.data) as T);
    const baseline = of<BaselineEntity>('baseline')[0];
    return {
      currency: store.currency,
      timeZone: store.timeZone,
      businessDate,
      todayPolicy: store.todayPolicy,
      banks: of<BankEntity>('bank'),
      counterparties: of<CounterpartyEntity>('counterparty'),
      receivables: of<ReceivableEntity>('receivable'),
      payables: of<PayableEntity>('payable'),
      commitments: of<CommitmentEntity>('commitment'),
      movements: of<MovementEntity>('movement'),
      sales: of<SaleEntity>('sale'),
      baseline: baseline ? { weekdaySales: baseline.weekdaySales, weekdayExpenses: baseline.weekdayExpenses } : null,
    };
  }

  /** Operaciones cuyo efecto todavía no está en el estado confirmado. */
  async activeOperations(): Promise<PendingOperation[]> {
    const items = await this.outbox();
    return items
      .filter((i) => ACTIVE_STATUSES.includes(i.status))
      .map((i) => ({ ...i.operation, createdAt: i.createdAt }) as unknown as PendingOperation);
  }
}
