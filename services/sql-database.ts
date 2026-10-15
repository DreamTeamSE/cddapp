/**
 * The subset of expo-sqlite's async database API that repositories need. Keeping it structural
 * lets tests run the same SQL against Node's built-in SQLite instead of a hand-written fake.
 */
export type SqlValue = string | number | null;
export interface SqlDatabase {
  execAsync(source: string): Promise<void>;
  runAsync(source: string, params: SqlValue[]): Promise<{ changes: number }>;
  getAllAsync<T>(source: string, params: SqlValue[]): Promise<T[]>;
  getFirstAsync<T>(source: string, params: SqlValue[]): Promise<T | null>;
  withTransactionAsync(task: () => Promise<void>): Promise<void>;
}

/**
 * True only when SQLite reports the file is not a readable database (SQLITE_NOTADB): a plaintext
 * file opened with a key, or an encrypted file opened with a different key. Transient errors
 * (busy, locked, I/O) return false so callers never discard data because of them.
 */
export function isWrongKeyError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /file is not a database|SQLITE_NOTADB|Error code 26:/i.test(message);
}
