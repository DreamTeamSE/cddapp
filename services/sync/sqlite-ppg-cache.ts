import type { SavedReading } from '../../types/measurement.ts';
import type { CachedHealthRecord, HealthDataCache } from './aws-sync-service.ts';
import { rolling24HourCutoff, type RollingPpgCache, type TimestampedPpgWindow } from './rolling-ppg-cache.ts';

import type { SqlDatabase, SqlValue } from '../sql-database.ts';

export type { SqlDatabase, SqlValue } from '../sql-database.ts';

/** pending → waiting for upload; synced → uploaded, kept until it ages out; failed → upload gave up, needs a retry. */
export type CacheRecordStatus = 'pending' | 'synced' | 'failed';
export type CacheStatusCounts = Readonly<Record<CacheRecordStatus, number>>;

export interface PpgCacheStore extends RollingPpgCache, HealthDataCache {
  /** Same as append, plus an optional prediction saved from this window. */
  readonly appendWithReading: (window: TimestampedPpgWindow, reading?: SavedReading) => Promise<void>;
  /** Deletes uploaded/failed windows older than 24 hours. Pending windows are kept so nothing is lost offline. */
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
}

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_SAMPLES = 125 * 60 * 3; // three minutes at 125 Hz, well above one 30-second window
const ID_BATCH = 500; // stays far below SQLite's bound-parameter limit

const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS ppg_windows (
     user_id TEXT NOT NULL,
     id TEXT NOT NULL,
     recorded_at_ms INTEGER NOT NULL,
     values_json TEXT NOT NULL,
     reading_json TEXT,
     status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'synced', 'failed')),
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

function parseNumbers(json: string): number[] {
  const value: unknown = JSON.parse(json);
  if (!Array.isArray(value) || !value.every((sample) => typeof sample === 'number' && Number.isFinite(sample))) {
    throw new Error('Stored PPG window is corrupt.');
  }
  return value;
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

  const validate = (window: TimestampedPpgWindow) => {
    if (!window.id.trim() || window.id.length > 200) throw new RangeError('PPG window ID must be a non-empty string up to 200 characters.');
    if (!Number.isFinite(window.recordedAtMs) || window.recordedAtMs < 0) throw new RangeError('PPG window time must be a finite, nonnegative timestamp.');
    if (window.values.length === 0 || window.values.length > maxSamples) throw new RangeError(`PPG window must contain 1–${maxSamples} samples.`);
    if (!window.values.every(Number.isFinite)) throw new RangeError('PPG samples must be finite numbers.');
  };

  const pruneBefore = async (cutoffMs: number): Promise<number> => {
    if (!Number.isFinite(cutoffMs)) throw new RangeError('Prune cutoff must be finite.');
    const result = await db.runAsync(
      `DELETE FROM ppg_windows WHERE user_id = ? AND recorded_at_ms < ? AND status != 'pending'`,
      [userId, cutoffMs],
    );
    return result.changes;
  };
  const pruneExpired = () => pruneBefore(rolling24HourCutoff(now()));

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

  const updateIds = async (ids: readonly string[], sql: (marks: string) => string, leading: SqlValue[]) => {
    if (ids.length === 0) return;
    await db.withTransactionAsync(async () => {
      for (const chunk of batches(ids)) await db.runAsync(sql(placeholders(chunk.length)), [...leading, userId, ...chunk]);
    });
  };

  return {
    append: (window) => appendWithReading(window),
    appendWithReading,

    async listSince(sinceMs) {
      const rows = await db.getAllAsync<WindowRow>(
        `SELECT id, recorded_at_ms, values_json, reading_json FROM ppg_windows
         WHERE user_id = ? AND recorded_at_ms >= ? ORDER BY recorded_at_ms ASC, id ASC`,
        [userId, sinceMs],
      );
      return rows.map((row) => ({ id: row.id, recordedAtMs: row.recorded_at_ms, values: parseNumbers(row.values_json) }));
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
      // Oldest first, so uploads happen in the order readings were taken.
      const rows = await db.getAllAsync<WindowRow>(
        `SELECT id, recorded_at_ms, values_json, reading_json FROM ppg_windows
         WHERE user_id = ? AND status = 'pending' ORDER BY recorded_at_ms ASC, id ASC LIMIT ?`,
        [userId, limit],
      );
      return rows.map((row): CachedHealthRecord => ({
        id: row.id,
        recordedAtMs: row.recorded_at_ms,
        ppg: parseNumbers(row.values_json),
        ...(row.reading_json ? { reading: JSON.parse(row.reading_json) as SavedReading } : {}),
      }));
    },

    markSynced: (ids, syncedAtMs) => updateIds(
      ids,
      (marks) => `UPDATE ppg_windows SET status = 'synced', synced_at_ms = ?, last_error = NULL WHERE user_id = ? AND id IN (${marks})`,
      [syncedAtMs],
    ),

    markFailed: (ids, error) => updateIds(
      ids,
      (marks) => `UPDATE ppg_windows SET status = 'failed', attempts = attempts + 1, last_error = ?
                  WHERE user_id = ? AND status != 'synced' AND id IN (${marks})`,
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
      const counts = { pending: 0, synced: 0, failed: 0 };
      for (const row of rows) counts[row.status] = row.count;
      return counts;
    },
  };
}
