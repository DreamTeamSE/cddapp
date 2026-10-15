import type { SavedReading } from '../../types/measurement.ts';
import type { SqlDatabase, SqlValue } from '../sql-database.ts';
import type { CachedHealthRecord, HealthDataCache } from './aws-sync-service.ts';
import { rolling24HourCutoff, type RollingPpgCache, type TimestampedPpgWindow } from './rolling-ppg-cache.ts';

/**
 * pending → waiting for upload; synced → uploaded, kept until it ages out;
 * failed → upload gave up, needs a retry; corrupt → stored data unreadable, set aside so it can't block uploads.
 */
export type CacheRecordStatus = 'pending' | 'synced' | 'failed' | 'corrupt';
export type CacheStatusCounts = Readonly<Record<CacheRecordStatus, number>>;

export interface PpgCacheStore extends RollingPpgCache, HealthDataCache {
  /** Same as append, plus an optional prediction saved from this window. */
  readonly appendWithReading: (window: TimestampedPpgWindow, reading?: SavedReading) => Promise<void>;
  /**
   * Deletes uploaded/failed/corrupt windows older than 24 hours, and windows that never uploaded
   * once they pass maxUnsyncedAgeMs (7 days by default) so storage can't grow without limit.
   */
  readonly pruneExpired: () => Promise<number>;
  readonly markFailed: (ids: readonly string[], error: string) => Promise<void>;
  /** Moves failed windows back to pending so the next sync tries them again. */
  readonly retryFailed: () => Promise<number>;
  readonly countByStatus: () => Promise<CacheStatusCounts>;
}

export interface PpgCacheOptions {
  /** Every row belongs to one signed-in user; another account on the same phone never sees it. */
  readonly userId: string;
  readonly nowMs?: () => number;
  /** Upper bound on samples per window, checked before anything is stored. */
  readonly maxSamplesPerWindow?: number;
  /** How long a window that never uploaded is kept before it is dropped. */
  readonly maxUnsyncedAgeMs?: number;
}

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_SAMPLES = 125 * 60 * 3; // three minutes at 125 Hz, well above one 30-second window
const ID_BATCH = 500; // stays far below SQLite's bound-parameter limit
const DAY_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_MAX_UNSYNCED_AGE_MS = 7 * DAY_MS;
/** Windows stamped further ahead than this mean a broken clock; storing them would defeat pruning. */
const MAX_FUTURE_SKEW_MS = DAY_MS;

const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ppg_windows (
     user_id TEXT NOT NULL,
     id TEXT NOT NULL,
     recorded_at_ms INTEGER NOT NULL,
     values_json TEXT NOT NULL,
     reading_json TEXT,
     status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'failed', 'corrupt')),
     attempts INTEGER NOT NULL DEFAULT 0,
     last_error TEXT,
     synced_at_ms INTEGER,
     created_at_ms INTEGER NOT NULL,
     PRIMARY KEY (user_id, id)
   );
   CREATE INDEX IF NOT EXISTS ppg_windows_by_status ON ppg_windows (user_id, status, recorded_at_ms);
   CREATE INDEX IF NOT EXISTS ppg_windows_by_time ON ppg_windows (user_id, recorded_at_ms);`,
];

interface WindowRow {
  id: string;
  recorded_at_ms: number;
  values_json: string;
  reading_json: string | null;
}

/** Creates or upgrades the cache table. Safe to call on every launch. */
export async function migratePpgCache(db: SqlDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  const current = row?.user_version ?? 0;
  if (current > SCHEMA_VERSION) throw new Error(`ppg cache schema v${current} is newer than this app (v${SCHEMA_VERSION}).`);
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[version]);
      await db.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

/** Returns null instead of throwing so one damaged row can be set aside rather than failing a whole read. */
function parseNumbers(json: string): number[] | null {
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) && value.length > 0 && value.every((sample) => typeof sample === 'number' && Number.isFinite(sample)) ? value : null;
  } catch {
    return null;
  }
}

function parseReading(json: string | null): { ok: true; reading?: SavedReading } | { ok: false } {
  if (json === null) return { ok: true };
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ok: true, reading: value as SavedReading } : { ok: false };
  } catch {
    return { ok: false };
  }
}

function batches<T>(items: readonly T[]): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += ID_BATCH) result.push(items.slice(index, index + ID_BATCH));
  return result;
}

const placeholders = (count: number) => Array(count).fill('?').join(', ');

/** Call migratePpgCache(db) once before using the returned store. */
export function createSqlitePpgCache(db: SqlDatabase, options: PpgCacheOptions): PpgCacheStore {
  if (!options.userId.trim()) throw new RangeError('A user ID is required for the PPG cache.');
  const userId = options.userId;
  const now = options.nowMs ?? Date.now;
  const maxSamples = options.maxSamplesPerWindow ?? DEFAULT_MAX_SAMPLES;
  const maxUnsyncedAgeMs = options.maxUnsyncedAgeMs ?? DEFAULT_MAX_UNSYNCED_AGE_MS;
  if (!(maxUnsyncedAgeMs >= DAY_MS)) throw new RangeError('Unsynced windows must be kept at least 24 hours.');

  const validate = (window: TimestampedPpgWindow) => {
    if (!window.id.trim() || window.id.length > 200) throw new RangeError('PPG window ID must be a non-empty string up to 200 characters.');
    if (!Number.isFinite(window.recordedAtMs) || window.recordedAtMs < 0) throw new RangeError('PPG window time must be a finite, nonnegative timestamp.');
    if (window.recordedAtMs > now() + MAX_FUTURE_SKEW_MS) throw new RangeError('PPG window time is more than a day in the future; check the device clock.');
    if (window.values.length === 0 || window.values.length > maxSamples) throw new RangeError(`PPG window must contain 1–${maxSamples} samples.`);
    if (!window.values.every(Number.isFinite)) throw new RangeError('PPG samples must be finite numbers.');
  };

  const updateIds = async (ids: readonly string[], sql: (marks: string) => string, leading: SqlValue[]) => {
    if (ids.length === 0) return;
    await db.withTransactionAsync(async () => {
      for (const chunk of batches(ids)) await db.runAsync(sql(placeholders(chunk.length)), [...leading, userId, ...chunk]);
    });
  };

  const pruneBefore = async (cutoffMs: number): Promise<number> => {
    if (!Number.isFinite(cutoffMs)) throw new RangeError('Prune cutoff must be finite.');
    const result = await db.runAsync(
      `DELETE FROM ppg_windows WHERE user_id = ? AND recorded_at_ms < ? AND status != 'pending'`,
      [userId, cutoffMs],
    );
    return result.changes;
  };
  const pruneExpired = async (): Promise<number> => {
    const settled = await pruneBefore(rolling24HourCutoff(now()));
    const stale = await db.runAsync(
      `DELETE FROM ppg_windows WHERE user_id = ? AND status = 'pending' AND recorded_at_ms < ?`,
      [userId, now() - maxUnsyncedAgeMs],
    );
    if (stale.changes > 0) console.warn(`Dropped ${stale.changes} PPG windows that never uploaded within the retention limit.`);
    return settled + stale.changes;
  };

  const quarantine = async (ids: readonly string[]) => {
    if (ids.length === 0) return;
    console.warn(`Set aside ${ids.length} unreadable PPG windows.`);
    await updateIds(ids, (marks) => `UPDATE ppg_windows SET status = 'corrupt', last_error = 'Stored data is unreadable' WHERE user_id = ? AND id IN (${marks})`, []);
  };

  const appendWithReading = async (window: TimestampedPpgWindow, reading?: SavedReading) => {
    validate(window);
    // Re-sending the same window (e.g. after a BLE reconnect) is ignored instead of duplicated.
    await db.runAsync(
      `INSERT INTO ppg_windows (user_id, id, recorded_at_ms, values_json, reading_json, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, id) DO NOTHING`,
      [userId, window.id, window.recordedAtMs, JSON.stringify(window.values), reading ? JSON.stringify(reading) : null, now()],
    );
    await pruneExpired();
  };

  return {
    append: (window) => appendWithReading(window),
    appendWithReading,

    async listSince(sinceMs) {
      const rows = await db.getAllAsync<WindowRow>(
        `SELECT id, recorded_at_ms, values_json, reading_json FROM ppg_windows
         WHERE user_id = ? AND recorded_at_ms >= ? AND status != 'corrupt' ORDER BY recorded_at_ms ASC, id ASC`,
        [userId, sinceMs],
      );
      const windows: TimestampedPpgWindow[] = [];
      const bad: string[] = [];
      for (const row of rows) {
        const values = parseNumbers(row.values_json);
        if (values) windows.push({ id: row.id, recordedAtMs: row.recorded_at_ms, values });
        else bad.push(row.id);
      }
      await quarantine(bad);
      return windows;
    },

    pruneBefore,
    pruneExpired,

    async countPending() {
      const row = await db.getFirstAsync<{ count: number }>(
        `SELECT COUNT(*) AS count FROM ppg_windows WHERE user_id = ? AND status = 'pending'`,
        [userId],
      );
      return row?.count ?? 0;
    },

    async listPending(limit) {
      if (!Number.isInteger(limit) || limit <= 0) throw new RangeError('Pending limit must be a positive integer.');
      // Oldest first, so uploads happen in the order readings were taken. Unreadable rows are set
      // aside and the query repeats, so a damaged row can never stall the queue behind it.
      while (true) {
        const rows = await db.getAllAsync<WindowRow>(
          `SELECT id, recorded_at_ms, values_json, reading_json FROM ppg_windows
           WHERE user_id = ? AND status = 'pending' ORDER BY recorded_at_ms ASC, id ASC LIMIT ?`,
          [userId, limit],
        );
        const records: CachedHealthRecord[] = [];
        const bad: string[] = [];
        for (const row of rows) {
          const ppg = parseNumbers(row.values_json);
          const reading = parseReading(row.reading_json);
          if (!ppg || !reading.ok) { bad.push(row.id); continue; }
          records.push({ id: row.id, recordedAtMs: row.recorded_at_ms, ppg, ...(reading.reading ? { reading: reading.reading } : {}) });
        }
        await quarantine(bad);
        if (records.length > 0 || bad.length === 0) return records;
      }
    },

    markSynced: (ids, syncedAtMs) => updateIds(
      ids,
      (marks) => `UPDATE ppg_windows SET status = 'synced', synced_at_ms = ?, last_error = NULL WHERE user_id = ? AND id IN (${marks})`,
      [syncedAtMs],
    ),

    markFailed: (ids, error) => updateIds(
      ids,
      (marks) => `UPDATE ppg_windows SET status = 'failed', attempts = attempts + 1, last_error = ?
                  WHERE user_id = ? AND status IN ('pending', 'failed') AND id IN (${marks})`,
      [error.slice(0, 500)],
    ),

    async retryFailed() {
      const result = await db.runAsync(`UPDATE ppg_windows SET status = 'pending' WHERE user_id = ? AND status = 'failed'`, [userId]);
      return result.changes;
    },

    async countByStatus() {
      const rows = await db.getAllAsync<{ status: CacheRecordStatus; count: number }>(
        `SELECT status, COUNT(*) AS count FROM ppg_windows WHERE user_id = ? GROUP BY status`,
        [userId],
      );
      const counts = { pending: 0, synced: 0, failed: 0, corrupt: 0 };
      for (const row of rows) counts[row.status] = row.count;
      return counts;
    },
  };
}
