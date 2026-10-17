/**
 * Subconjunto de la API de expo-sqlite que usa la app. En el teléfono lo implementa
 * `SQLiteDatabase`; en las pruebas, un adaptador sobre el SQLite de Node (`node:sqlite`).
 */
export type SqlParam = string | number | null;

export interface SqlExecutor {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqlParam[]): Promise<{ changes: number }>;
  getAllAsync<T>(source: string, params: SqlParam[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params: SqlParam[]): Promise<T | null>;
}

export interface SqlDatabase extends SqlExecutor {
  /** Transacción exclusiva: solo lo hecho con `txn` participa; el resto espera o falla. */
  withExclusiveTransactionAsync(task: (txn: SqlExecutor) => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

export const SCHEMA_VERSION = 1;

export const MIGRATIONS = `
PRAGMA journal_mode = WAL;
CREATE TABLE IF NOT EXISTS entities (
  type TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT,
  local_data TEXT,
  version INTEGER NOT NULL DEFAULT 0,
  seq INTEGER NOT NULL DEFAULT 0,
  deleted INTEGER NOT NULL DEFAULT 0,
  sync_state TEXT NOT NULL DEFAULT 'synced',
  PRIMARY KEY (type, id)
);
CREATE TABLE IF NOT EXISTS outbox (
  client_mutation_id TEXT PRIMARY KEY NOT NULL,
  local_seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  entity_type TEXT,
  entity_id TEXT,
  operation TEXT NOT NULL,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  error_code TEXT,
  server_seq INTEGER,
  remote TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_status ON outbox (status, local_seq);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
`;
