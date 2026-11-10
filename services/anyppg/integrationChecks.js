'use strict';
/**
 * Host/Node software integration checks for AnyPPG + watch pipeline wiring.
 * Physical iPhone ONNX execution is reported separately by the in-app panel.
 */
const {makeDemoSyncRecording, parseSyncRecordingJson, CONTRACT} = require('../recordings/syncContract');
const {assessRecordingQuality} = require('../recordings/qualityGate');
const {selectLowMotionSegments} = require('../device/motion-selection');
const {runWatchRecording, rejectSparkFunCsv} = require('./watchInference');
const {history} = require('./sessionHistory');

function check(name, fn) {
  const started = Date.now();
  try {
    const detail = fn() || {};
    return { name, passed: true, ms: Date.now() - started, ...detail };
  } catch (error) {
    return { name, passed: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

async function checkAsync(name, fn) {
  const started = Date.now();
  try {
    const detail = (await fn()) || {};
    return { name, passed: true, ms: Date.now() - started, ...detail };
  } catch (error) {
    return { name, passed: false, ms: Date.now() - started, error: error instanceof Error ? error.message : String(error) };
  }
}

async function runSoftwareIntegrationChecks(options = {}) {
  const results = [];

  results.push(check('sync_contract_parses_synthetic_fixture', () => {
    const recording = makeDemoSyncRecording({ seconds: 3, recordingId: 'integ-sync-short' });
    const again = parseSyncRecordingJson(JSON.stringify(recording));
    if (again.kind !== CONTRACT) throw new Error('Unexpected kind');
    return { recordingId: again.recordingId };
  }));

  results.push(check('legacy_csv_rejected_as_watch_recording', () => {
    try {
      rejectSparkFunCsv({ kind: 'cdd_serial_csv_v1', format: 'legacy_ac', rows: [[0, 1, 2], [8, 3, 4]] });
      throw new Error('Expected SparkFun CSV rejection');
    } catch (error) {
      if (!String(error).includes('SparkFun') && !String(error).includes('synchronized')) throw error;
    }
    return { rejected: true };
  }));

  results.push(check('high_motion_fixture_rejected_by_quality_gate', () => {
    const recording = makeDemoSyncRecording({ seconds: 32, motion: 'high', recordingId: 'integ-high-motion' });
    const motion = selectLowMotionSegments(recording.imu.samples, {
      windowDurationSec: 30,
      stepSec: 5,
      maxCandidates: 1,
      motionRmsMax: 0.35,
    });
    const assessment = assessRecordingQuality(recording, { motionRmsMax: 0.2 });
    if (assessment.accepted) throw new Error('High-motion fixture must not be accepted');
    return { motionAllBad: motion.allBad, reasons: assessment.rejectionReasons };
  }));

  results.push(check('low_motion_30s_fixture_passes_quality_gate', () => {
    const recording = makeDemoSyncRecording({ seconds: 32, motion: 'low', recordingId: 'integ-low-motion' });
    const assessment = assessRecordingQuality(recording);
    if (!assessment.accepted) throw new Error('Expected acceptance: ' + assessment.rejectionReasons.join('; '));
    return { motionRms: assessment.motionRms, channel: assessment.channel };
  }));

  results.push(check('history_idempotent_estimates_and_missed_intervals', () => {
    const before = history.listEstimates().length;
    const first = history.saveEstimate({
      recordingId: 'integ-hist-1',
      intervalId: 'integ-interval-1',
      captureStartedAt: '2026-11-09T18:00:00.000Z',
      sbp: 110,
      dbp: 70,
      channel: 'red',
      preprocessingVersion: 'anyppg_watch_prep_v1',
      qualityStatus: 'accepted',
      sourceKind: 'watch_live',
    });
    const second = history.saveEstimate({
      recordingId: 'integ-hist-1',
      intervalId: 'integ-interval-1',
      captureStartedAt: '2026-11-09T18:00:00.000Z',
      sbp: 999,
      dbp: 999,
      channel: 'red',
      preprocessingVersion: 'anyppg_watch_prep_v1',
      qualityStatus: 'accepted',
      sourceKind: 'watch_live',
    });
    if (first.sbp !== second.sbp) throw new Error('Duplicate estimate mutated values');
    history.markMissed('integ-interval-miss', 'simulation');
    if (history.getInterval('integ-interval-miss')?.state !== 'missed') throw new Error('Missed interval not recorded');
    if (history.getInterval('integ-interval-miss')?.estimateId) throw new Error('Missed interval must not invent an estimate');
    return { estimatesAdded: history.listEstimates().length - before, idempotent: true };
  }));

  if (options.createAdapter) {
    results.push(await checkAsync('watch_inference_rejects_without_fabricating_bp_on_high_motion', async () => {
      const recording = makeDemoSyncRecording({ seconds: 32, motion: 'high', recordingId: 'integ-infer-reject' });
      const report = await runWatchRecording(recording, {
        createAdapter: options.createAdapter,
        head: options.head,
        modelSha256: options.modelSha256,
      });
      if (report.status === 'accepted') throw new Error('High motion must not produce accepted BP');
      return { status: report.status, reasons: report.rejectionReasons };
    }));

    results.push(await checkAsync('watch_inference_accepts_low_motion_synthetic_when_adapter_provided', async () => {
      const recording = makeDemoSyncRecording({ seconds: 32, motion: 'low', recordingId: 'integ-infer-ok' });
      const report = await runWatchRecording(recording, {
        createAdapter: options.createAdapter,
        head: options.head,
        modelSha256: options.modelSha256,
      });
      if (report.status !== 'accepted') throw new Error(report.error || report.rejectionReasons?.join('; ') || 'expected accepted');
      if (!Number.isFinite(report.sbp) || !Number.isFinite(report.dbp)) throw new Error('BP missing');
      return { status: report.status, sbp: report.sbp, dbp: report.dbp, processingMs: report.processingMs };
    }));
  }

  const passed = results.filter((item) => item.passed).length;
  return {
    schemaVersion: 1,
    physicalIphoneValidated: false,
    liveBleValidated: false,
    newWatchHardwareValidated: false,
    passed,
    failed: results.length - passed,
    total: results.length,
    results,
  };
}

module.exports = { runSoftwareIntegrationChecks };
