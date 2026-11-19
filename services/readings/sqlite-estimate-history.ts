/**
 * SQLite-backed prototype BP estimate / interval history (issue #26).
 * Separate from the health journal. Missed/failed intervals never invent a BP reading.
 */
import { createRequire } from 'node:module';

import type { SqlDatabase, SqlValue } from '../sql-database.ts';
import type {
  EstimateHistory,
  IntervalHistoryRecord,
  IntervalHistoryState,
  PrototypeEstimate,
} from './estimate-history.d.ts';

const require = createRequire(import.meta.url);
const { createEstimateHistory } = require('./estimate-history.js') as {
  createEstimateHistory: (options?: { modelId?: string }) => EstimateHistory;
};

const SCHEMA_VERSION = 1;
const STATES: readonly IntervalHistoryState[] = [
  'pending', 'pending_upload', 'pending_processing', 'accepted', 'missed', 'failed',
];

const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS prototype_estimates (
     id TEXT PRIMARY KEY NOT NULL,
     recording_id TEXT NOT NULL,
     interval_id TEXT NOT NULL,
     capture_started_at TEXT NOT NULL,
     sbp REAL NOT NULL,
     dbp REAL NOT NULL,
     unit TEXT NOT NULL,
     channel TEXT NOT NULL CHECK (channel IN ('red', 'infrared')),
     model_id TEXT NOT NULL,
     model_hash TEXT,
     preprocessing_version TEXT NOT NULL,
     quality_status TEXT NOT NULL,
     calibration_status TEXT NOT NULL,
     source_kind TEXT NOT NULL CHECK (source_kind IN ('watch_live', 'imported_csv')),
     signal_provenance TEXT,
     window_start_ms REAL,
     window_end_ms REAL,
     experimental INTEGER NOT NULL DEFAULT 1,
     prototype_label TEXT NOT NULL,
     created_at_ms INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS prototype_intervals (
     interval_id TEXT PRIMARY KEY NOT NULL,
     state TEXT NOT NULL,
     reason TEXT,
     updated_at_ms INTEGER NOT NULL,
     estimate_id TEXT
   );
   CREATE INDEX IF NOT EXISTS prototype_estimates_by_interval ON prototype_estimates (interval_id);
   CREATE INDEX IF NOT EXISTS prototype_estimates_by_created ON prototype_estimates (created_at_ms);`,
];

function need(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

export async function migrateEstimateHistory(db: SqlDatabase): Promise<void> {
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version', []);
  const current = row?.user_version ?? 0;
  if (current > SCHEMA_VERSION) {
    throw new Error(`estimate history schema v${current} is newer than this app (v${SCHEMA_VERSION}).`);
  }
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[version]!);
      await db.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
  }
}

type EstimateRow = {
  id: string;
  recording_id: string;
  interval_id: string;
  capture_started_at: string;
  sbp: number;
  dbp: number;
  unit: string;
  channel: 'red' | 'infrared';
  model_id: string;
  model_hash: string | null;
  preprocessing_version: string;
  quality_status: string;
  calibration_status: string;
  source_kind: 'watch_live' | 'imported_csv';
  signal_provenance: string | null;
  window_start_ms: number | null;
  window_end_ms: number | null;
  experimental: number;
  prototype_label: string;
  created_at_ms: number;
};

type IntervalRow = {
  interval_id: string;
  state: IntervalHistoryState;
  reason: string | null;
  updated_at_ms: number;
  estimate_id: string | null;
};

function rowToEstimate(row: EstimateRow): PrototypeEstimate {
  return {
    id: row.id,
    recordingId: row.recording_id,
    intervalId: row.interval_id,
    captureStartedAt: row.capture_started_at,
    sbp: row.sbp,
    dbp: row.dbp,
    unit: 'mmHg',
    channel: row.channel,
    modelId: row.model_id,
    modelHash: row.model_hash,
    preprocessingVersion: row.preprocessing_version,
    qualityStatus: 'accepted',
    calibrationStatus: row.calibration_status,
    sourceKind: row.source_kind,
    signalProvenance: (row.signal_provenance as PrototypeEstimate['signalProvenance']) ?? null,
    windowStartMs: row.window_start_ms,
    windowEndMs: row.window_end_ms,
    experimental: true,
    prototypeLabel: 'experimental_prototype_estimate',
    createdAtMs: row.created_at_ms,
  };
}

function rowToInterval(row: IntervalRow): IntervalHistoryRecord {
  return {
    intervalId: row.interval_id,
    state: row.state,
    reason: row.reason,
    updatedAtMs: row.updated_at_ms,
    estimateId: row.estimate_id,
  };
}

export type SqliteEstimateHistory = {
  readonly saveEstimate: (input: Parameters<EstimateHistory['saveEstimate']>[0]) => Promise<PrototypeEstimate>;
  readonly markMissed: (intervalId: string, reason: string, nowMs?: number) => Promise<IntervalHistoryRecord>;
  readonly markFailed: (intervalId: string, reason: string, nowMs?: number) => Promise<IntervalHistoryRecord>;
  readonly upsertInterval: (
    intervalId: string,
    state: IntervalHistoryState,
    reason?: string | null,
    nowMs?: number,
  ) => Promise<IntervalHistoryRecord>;
  readonly getEstimate: (id: string) => Promise<PrototypeEstimate | null>;
  readonly listEstimates: () => Promise<PrototypeEstimate[]>;
  readonly listIntervals: () => Promise<IntervalHistoryRecord[]>;
  readonly getInterval: (intervalId: string) => Promise<IntervalHistoryRecord | null>;
  /** Copy all rows into a sync in-memory history (for app launch). */
  readonly hydrateMemory: (memory: EstimateHistory) => Promise<{ estimates: number; intervals: number }>;
};

export async function createSqliteEstimateHistory(
  db: SqlDatabase,
  options: { modelId?: string } = {},
): Promise<SqliteEstimateHistory> {
  await migrateEstimateHistory(db);
  const modelId = options.modelId ?? 'anyppg_frozen_ridge_raw_v1';

  async function writeInterval(
    intervalId: string,
    state: IntervalHistoryState,
    reason: string | null = null,
    nowMs = Date.now(),
    estimateId?: string | null,
  ): Promise<IntervalHistoryRecord> {
    need(typeof intervalId === 'string' && intervalId.length > 0, 'intervalId required.');
    need(STATES.includes(state), 'Invalid interval state.');
    const existing = await db.getFirstAsync<IntervalRow>(
      'SELECT interval_id, state, reason, updated_at_ms, estimate_id FROM prototype_intervals WHERE interval_id = ?',
      [intervalId],
    );
    const nextEstimateId = estimateId !== undefined ? estimateId : (existing?.estimate_id ?? null);
    await db.runAsync(
      `INSERT INTO prototype_intervals (interval_id, state, reason, updated_at_ms, estimate_id)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(interval_id) DO UPDATE SET
         state = excluded.state,
         reason = excluded.reason,
         updated_at_ms = excluded.updated_at_ms,
         estimate_id = excluded.estimate_id`,
      [intervalId, state, reason, nowMs, nextEstimateId],
    );
    return {
      intervalId,
      state,
      reason,
      updatedAtMs: nowMs,
      estimateId: nextEstimateId,
    };
  }

  async function listEstimates(): Promise<PrototypeEstimate[]> {
    const rows = await db.getAllAsync<EstimateRow>(
      'SELECT * FROM prototype_estimates ORDER BY created_at_ms ASC',
      [],
    );
    return rows.map(rowToEstimate);
  }

  async function listIntervals(): Promise<IntervalHistoryRecord[]> {
    const rows = await db.getAllAsync<IntervalRow>(
      'SELECT interval_id, state, reason, updated_at_ms, estimate_id FROM prototype_intervals ORDER BY updated_at_ms ASC',
      [],
    );
    return rows.map(rowToInterval);
  }

  const store: SqliteEstimateHistory = {
    async saveEstimate(input) {
      need(input && typeof input === 'object', 'estimate required.');
      const {
        recordingId, intervalId, captureStartedAt, sbp, dbp, channel,
        modelHash, preprocessingVersion, qualityStatus, calibrationStatus, sourceKind,
        signalProvenance, windowStartMs, windowEndMs,
      } = input;
      need(typeof recordingId === 'string' && recordingId, 'recordingId required.');
      need(typeof intervalId === 'string' && intervalId, 'intervalId required.');
      need(qualityStatus === 'accepted', 'Only quality-accepted recordings may create BP estimates.');
      need(Number.isFinite(sbp) && Number.isFinite(dbp), 'sbp/dbp must be finite.');
      need(channel === 'red' || channel === 'infrared', 'channel invalid.');
      need(sourceKind === 'watch_live' || sourceKind === 'imported_csv', 'sourceKind invalid.');
      if (signalProvenance != null) {
        need(signalProvenance === 'raw_adc' || signalProvenance === 'firmware_filtered', 'signalProvenance invalid.');
      }
      const id = `${recordingId}:${channel}`;
      const existing = await db.getFirstAsync<EstimateRow>(
        'SELECT * FROM prototype_estimates WHERE id = ?',
        [id],
      );
      if (existing) return rowToEstimate(existing);

      const createdAtMs = Date.now();
      const params: SqlValue[] = [
        id, recordingId, intervalId, captureStartedAt, sbp, dbp, 'mmHg', channel, modelId,
        modelHash ?? null, preprocessingVersion, 'accepted', calibrationStatus ?? 'none', sourceKind,
        signalProvenance ?? null, windowStartMs ?? null, windowEndMs ?? null, 1,
        'experimental_prototype_estimate', createdAtMs,
      ];
      await db.withTransactionAsync(async () => {
        await db.runAsync(
          `INSERT INTO prototype_estimates (
             id, recording_id, interval_id, capture_started_at, sbp, dbp, unit, channel, model_id,
             model_hash, preprocessing_version, quality_status, calibration_status, source_kind,
             signal_provenance, window_start_ms, window_end_ms, experimental, prototype_label, created_at_ms
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params,
        );
        await writeInterval(intervalId, 'accepted', null, createdAtMs, id);
      });
      const saved = await db.getFirstAsync<EstimateRow>('SELECT * FROM prototype_estimates WHERE id = ?', [id]);
      need(saved, 'Failed to persist estimate.');
      return rowToEstimate(saved);
    },

    markMissed(intervalId, reason, nowMs = Date.now()) {
      // Preserve any prior estimateId (missed must not invent a new reading).
      return writeInterval(intervalId, 'missed', reason, nowMs);
    },

    markFailed(intervalId, reason, nowMs = Date.now()) {
      return writeInterval(intervalId, 'failed', reason, nowMs);
    },

    upsertInterval(intervalId, state, reason = null, nowMs = Date.now()) {
      return writeInterval(intervalId, state, reason ?? null, nowMs);
    },

    async getEstimate(id) {
      const row = await db.getFirstAsync<EstimateRow>('SELECT * FROM prototype_estimates WHERE id = ?', [id]);
      return row ? rowToEstimate(row) : null;
    },

    listEstimates,
    listIntervals,

    async getInterval(intervalId) {
      const row = await db.getFirstAsync<IntervalRow>(
        'SELECT interval_id, state, reason, updated_at_ms, estimate_id FROM prototype_intervals WHERE interval_id = ?',
        [intervalId],
      );
      return row ? rowToInterval(row) : null;
    },

    async hydrateMemory(memory) {
      const intervals = await listIntervals();
      const estimates = await listEstimates();
      for (const interval of intervals) {
        if (interval.state === 'accepted') continue;
        memory.upsertInterval(interval.intervalId, interval.state, interval.reason, interval.updatedAtMs);
      }
      for (const estimate of estimates) {
        memory.saveEstimate({
          recordingId: estimate.recordingId,
          intervalId: estimate.intervalId,
          captureStartedAt: estimate.captureStartedAt,
          sbp: estimate.sbp,
          dbp: estimate.dbp,
          channel: estimate.channel,
          modelHash: estimate.modelHash,
          preprocessingVersion: estimate.preprocessingVersion,
          qualityStatus: 'accepted',
          calibrationStatus: estimate.calibrationStatus,
          sourceKind: estimate.sourceKind,
          signalProvenance: estimate.signalProvenance,
          windowStartMs: estimate.windowStartMs,
          windowEndMs: estimate.windowEndMs,
        });
      }
      return { estimates: estimates.length, intervals: intervals.length };
    },
  };

  return store;
}

export type PersistedEstimateHistory = EstimateHistory & {
  /** Resolves when queued SQLite writes finish. */
  readonly flush: () => Promise<void>;
};

/**
 * Sync EstimateHistory API backed by SQLite writes (survives reopen via hydrate).
 * Reads hit memory; writes update memory immediately and enqueue SQLite persistence.
 */
export async function createPersistedEstimateHistory(
  db: SqlDatabase,
  options: { modelId?: string } = {},
): Promise<PersistedEstimateHistory> {
  const sqlite = await createSqliteEstimateHistory(db, options);
  const memory = createEstimateHistory(options);
  await sqlite.hydrateMemory(memory);

  let chain: Promise<void> = Promise.resolve();
  const enqueue = (task: () => Promise<unknown>) => {
    chain = chain.then(task).then(() => undefined);
    return chain;
  };

  return {
    saveEstimate(input) {
      const saved = memory.saveEstimate(input);
      enqueue(() => sqlite.saveEstimate(input));
      return saved;
    },
    markMissed(intervalId, reason, nowMs) {
      const record = memory.markMissed(intervalId, reason, nowMs);
      enqueue(() => sqlite.markMissed(intervalId, reason, record.updatedAtMs));
      return record;
    },
    markFailed(intervalId, reason, nowMs) {
      const record = memory.markFailed(intervalId, reason, nowMs);
      enqueue(() => sqlite.markFailed(intervalId, reason, record.updatedAtMs));
      return record;
    },
    upsertInterval(intervalId, state, reason, nowMs) {
      const record = memory.upsertInterval(intervalId, state, reason, nowMs);
      enqueue(() => sqlite.upsertInterval(intervalId, state, reason ?? null, record.updatedAtMs));
      return record;
    },
    getEstimate: (id) => memory.getEstimate(id),
    listEstimates: () => memory.listEstimates(),
    listIntervals: () => memory.listIntervals(),
    getInterval: (intervalId) => memory.getInterval(intervalId),
    flush: () => chain,
  };
}
