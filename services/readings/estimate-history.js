'use strict';
/**
 * Quality-gated prototype BP estimate history (issue #12).
 * In-memory/core store — intentionally separate from the journal UI DB.
 * Never fills missed intervals with the previous reading.
 */
const need = (ok, message) => { if (!ok) throw new Error(message); };

function createEstimateHistory(options = {}) {
  const estimates = new Map();
  const intervals = new Map();
  const modelId = options.modelId ?? 'anyppg_frozen_ridge_raw_v1';

  function upsertInterval(intervalId, state, reason = null, nowMs = Date.now()) {
    need(typeof intervalId === 'string' && intervalId.length > 0, 'intervalId required.');
    need(['pending', 'pending_upload', 'pending_processing', 'accepted', 'missed', 'failed'].includes(state), 'Invalid interval state.');
    const existing = intervals.get(intervalId);
    intervals.set(intervalId, {
      intervalId,
      state,
      reason,
      updatedAtMs: nowMs,
      estimateId: existing?.estimateId ?? null,
    });
    return intervals.get(intervalId);
  }

  function saveEstimate(input) {
    need(input && typeof input === 'object', 'estimate required.');
    const {
      recordingId, intervalId, captureStartedAt, sbp, dbp, channel,
      modelHash, preprocessingVersion, qualityStatus, calibrationStatus, sourceKind,
    } = input;
    need(typeof recordingId === 'string' && recordingId, 'recordingId required.');
    need(typeof intervalId === 'string' && intervalId, 'intervalId required.');
    need(qualityStatus === 'accepted', 'Only quality-accepted recordings may create BP estimates.');
    need(Number.isFinite(sbp) && Number.isFinite(dbp), 'sbp/dbp must be finite.');
    need(['red', 'infrared'].includes(channel), 'channel invalid.');
    need(['watch_live', 'imported_csv'].includes(sourceKind), 'sourceKind invalid.');
    // Idempotent on recordingId+channel
    const id = `${recordingId}:${channel}`;
    if (estimates.has(id)) return estimates.get(id);
    const estimate = {
      id,
      recordingId,
      intervalId,
      captureStartedAt,
      sbp,
      dbp,
      unit: 'mmHg',
      channel,
      modelId,
      modelHash: modelHash ?? null,
      preprocessingVersion,
      qualityStatus,
      calibrationStatus: calibrationStatus ?? 'none',
      sourceKind,
      experimental: true,
      prototypeLabel: 'experimental_prototype_estimate',
      createdAtMs: Date.now(),
    };
    estimates.set(id, estimate);
    const interval = upsertInterval(intervalId, 'accepted', null, estimate.createdAtMs);
    interval.estimateId = id;
    intervals.set(intervalId, interval);
    return estimate;
  }

  function markMissed(intervalId, reason, nowMs = Date.now()) {
    return upsertInterval(intervalId, 'missed', reason, nowMs);
  }

  function markFailed(intervalId, reason, nowMs = Date.now()) {
    return upsertInterval(intervalId, 'failed', reason, nowMs);
  }

  function getEstimate(id) { return estimates.get(id) ?? null; }
  function listEstimates() { return [...estimates.values()]; }
  function listIntervals() { return [...intervals.values()]; }
  function getInterval(intervalId) { return intervals.get(intervalId) ?? null; }

  return {
    saveEstimate,
    markMissed,
    markFailed,
    upsertInterval,
    getEstimate,
    listEstimates,
    listIntervals,
    getInterval,
  };
}

module.exports = { createEstimateHistory };
