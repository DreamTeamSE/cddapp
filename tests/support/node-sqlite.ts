import { DatabaseSync } from 'node:sqlite';
import type { SqlDatabase, SqlValue } from '../../services/sql-database.ts';

/** Wraps Node's built-in SQLite in the async shape expo-sqlite exposes, so tests exercise real SQL. */
export function openMemorySqlite(): SqlDatabase & { close: () => void } {
  const db = new DatabaseSync(':memory:');
  return {
    async execAsync(source) { db.exec(source); },
    async runAsync(source, params: SqlValue[]) {
      const result = db.prepare(source).run(...params);
      return { changes: Number(result.changes) };
    },
    async getAllAsync<T>(source: string, params: SqlValue[]) { return db.prepare(source).all(...params) as T[]; },
    async getFirstAsync<T>(source: string, params: SqlValue[]) { return (db.prepare(source).get(...params) as T | undefined) ?? null; },
    async withTransactionAsync(task) {
      db.exec('BEGIN');
      try { await task(); db.exec('COMMIT'); }
      catch (error) { db.exec('ROLLBACK'); throw error; }
    },
    close: () => db.close(),
  };
}
