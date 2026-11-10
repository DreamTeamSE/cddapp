'use strict';
/**
 * Process-local prototype estimate history for AnyPPG outputs (#12).
 * Does not write to the health journal SQLite store.
 */
const {createEstimateHistory} = require('../readings/estimate-history');

const history = createEstimateHistory({ modelId: 'anyppg_frozen_ridge_raw_v1' });

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

module.exports = { history, recordCsvReport };
