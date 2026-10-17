// eslint-disable-next-line @typescript-eslint/no-require-imports
const { DatabaseSync } = require('node:sqlite') as typeof import('node:sqlite');
import type { SqlDatabase, SqlExecutor, SqlParam } from '../src/db/sql';

/**
 * SQLite real (el de Node) con la misma interfaz que usa la app. Permite probar transacciones,
 * persistencia en archivo y reapertura (reinicio de la app) sin el módulo nativo.
 */
export function openNodeSqlite(path = ':memory:'): SqlDatabase {
  const db = new DatabaseSync(path);
  let queue: Promise<unknown> = Promise.resolve();

  const exec: SqlExecutor = {
    async execAsync(source) {
      db.exec(source);
    },
    async runAsync(source, params: SqlParam[]) {
      const r = db.prepare(source).run(...params);
      return { changes: Number(r.changes) };
    },
    async getAllAsync<T>(source: string, params: SqlParam[]) {
      return db.prepare(source).all(...params) as T[];
    },
    async getFirstAsync<T>(source: string, params: SqlParam[]) {
      return (db.prepare(source).get(...params) as T | undefined) ?? null;
    },
  };

  return {
    ...exec,
    // Serializa las transacciones exclusivas como lo hace el módulo nativo.
    withExclusiveTransactionAsync(task) {
      const run = queue.then(async () => {
        db.exec('BEGIN IMMEDIATE');
        try {
          await task(exec);
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
      });
      queue = run.catch(() => undefined);
      return run;
    },
    async closeAsync() {
      db.close();
    },
  };
}
