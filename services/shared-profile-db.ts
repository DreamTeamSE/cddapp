import type { SqlDatabase } from './sql-database.ts';

/**
 * SQL for the shared `profile.db` that needs to know who is signed in. Kept free of expo imports
 * so tests can run it against Node's SQLite; `services/database.ts` wires it to the real file.
 */
export interface JournalEntryRow {
  readonly date: string;
  readonly bp: string;
  readonly notes: string;
  readonly updatedAtMs: number;
}

/**
 * Journal entries are keyed by user so one account never sees another's readings or notes.
 * Rows in the older unscoped `journal_entries` table predate accounts and are left untouched.
 */
export const USER_JOURNAL_SCHEMA = `
  CREATE TABLE IF NOT EXISTS user_journal_entries (
    user_id TEXT NOT NULL,
    date TEXT NOT NULL,
    bp TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    updatedAtMs INTEGER NOT NULL,
    PRIMARY KEY (user_id, date)
  );`;

export function listJournalEntries(db: SqlDatabase, userId: string): Promise<JournalEntryRow[]> {
  return db.getAllAsync<JournalEntryRow>(
    'SELECT date, bp, notes, updatedAtMs FROM user_journal_entries WHERE user_id = ? ORDER BY date DESC;',
    [userId],
  );
}

export async function upsertJournalEntry(db: SqlDatabase, userId: string, entry: JournalEntryRow): Promise<void> {
  await db.runAsync(
    `INSERT INTO user_journal_entries (user_id, date, bp, notes, updatedAtMs) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, date) DO UPDATE SET bp = excluded.bp, notes = excluded.notes, updatedAtMs = excluded.updatedAtMs;`,
    [userId, entry.date, entry.bp, entry.notes, entry.updatedAtMs],
  );
}

/**
 * Empties the shared Profile-tab row. The connection runs with secure_delete on, so the freed
 * bytes are zeroed; the checkpoint then copies clean pages into the file and empties the WAL.
 * If another reader holds the WAL the truncate is skipped and happens on a later checkpoint.
 */
export async function clearSharedProfileRow(db: SqlDatabase): Promise<void> {
  await db.runAsync('DELETE FROM profile WHERE id = 1;', []);
  await db.getFirstAsync('PRAGMA wal_checkpoint(TRUNCATE);', []);
}
