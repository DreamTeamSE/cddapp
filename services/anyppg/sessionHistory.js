'use strict';
/**
 * Process-local prototype estimate history for AnyPPG outputs (#12).
 * Default is in-memory. Call attachSqlitePersistence(db) (#26) so relaunches keep data.
 * Does not write to the health journal SQLite store.
 */
const {createEstimateHistory} = require('../readings/estimate-history');

const history = createEstimateHistory({ modelId: 'anyppg_frozen_ridge_raw_v1' });
let persistenceFlush = async () => {};
let persistenceAttached = false;

/**
 * Hydrate the shared history from SQLite and dual-write future mutations (issue #26).
 * Safe to call once at app start. Mutates the exported history object in place so
 * existing `const { history } = require(...)` bindings keep working.
 * @param {import('../sql-database').SqlDatabase} db
 * @param {{modelId?: string}} [options]
 */
async function attachSqlitePersistence(db, options = {}) {
  if (persistenceAttached) return history;
  const { createSqliteEstimateHistory } = await import('../readings/sqlite-estimate-history.ts');
  const sqlite = await createSqliteEstimateHistory(db, {
    modelId: options.modelId ?? 'anyppg_frozen_ridge_raw_v1',
  });
  await sqlite.hydrateMemory(history);

  let chain = Promise.resolve();
  const enqueue = (task) => {
    chain = chain.then(task).then(() => undefined, (err) => {
      console.warn('estimate history SQLite write failed', err);
    });
    return chain;
  };

  const rawSave = history.saveEstimate.bind(history);
  const rawMissed = history.markMissed.bind(history);
  const rawFailed = history.markFailed.bind(history);
  const rawUpsert = history.upsertInterval.bind(history);

  history.saveEstimate = (input) => {
    const saved = rawSave(input);
    enqueue(() => sqlite.saveEstimate(input));
    return saved;
  };
  history.markMissed = (intervalId, reason, nowMs) => {
    const record = rawMissed(intervalId, reason, nowMs);
    enqueue(() => sqlite.markMissed(intervalId, reason, record.updatedAtMs));
    return record;
  };
  history.markFailed = (intervalId, reason, nowMs) => {
    const record = rawFailed(intervalId, reason, nowMs);
    enqueue(() => sqlite.markFailed(intervalId, reason, record.updatedAtMs));
    return record;
  };
  history.upsertInterval = (intervalId, state, reason, nowMs) => {
    const record = rawUpsert(intervalId, state, reason, nowMs);
    enqueue(() => sqlite.upsertInterval(intervalId, state, reason ?? null, record.updatedAtMs));
    return record;
  };

  persistenceFlush = () => chain;
  persistenceAttached = true;
  return history;
}

function recordCsvReport(report, options = {}) {
  if (!report?.complete || !Array.isArray(report.windows) || report.windows.length === 0) return [];
  const sourceKind = report.synthetic ? 'imported_csv' : (options.sourceKind ?? 'imported_csv');
  const recordingId = options.recordingId ?? (report.synthetic ? 'synthetic-anyppg-check' : `csv-${report.startedAt}`);
  const intervalId = options.intervalId ?? (report.synthetic ? 'synthetic' : `csv-session-${report.startedAt}`);
  const saved = [];
  for (const window of report.windows) {
    saved.push(history.saveEstimate({
      recordingId: `${recordingId}:${window.channel}:${window.startSeconds}`,
      intervalId,
      captureStartedAt: report.startedAt,
      sbp: window.sbp,
      dbp: window.dbp,
      channel: window.channel,
      modelHash: report.modelSha256 ?? null,
      preprocessingVersion: 'anyppg_csv_legacy_ac_v1',
      qualityStatus: 'accepted',
      calibrationStatus: report.calibrationApplied ? 'applied' : 'none',
      sourceKind,
    }));
  }
  return saved;
}

module.exports = {
  history,
  recordCsvReport,
  attachSqlitePersistence,
  flushHistoryPersistence: () => persistenceFlush(),
};
