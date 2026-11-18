'use strict';
/**
 * Watch-path orchestration: motion selection → quality gate → AnyPPG window prep.
 * Native ONNX execution is injected by watchInference.native.ts.
 * Never fabricates BP when quality rejects. SparkFun CSV is not accepted here.
 */
const {validateRecording, CONTRACT, PREPROCESSING_VERSION} = require('../recordings/syncContract');
const {assessRecordingQuality, prepareAcceptedWindow} = require('../recordings/qualityGate');
const {selectLowMotionSegments} = require('../device/motion-selection');
const {applyHead, MODEL_ID} = require('./core');
const {history} = require('./sessionHistory');

const need = (ok, message) => { if (!ok) throw new Error(message); };

function rejectSparkFunCsv(input) {
  if (input && input.kind === 'cdd_serial_csv_v1') {
    throw new Error('Legacy SparkFun CSV is not a synchronized PPG+IMU watch recording. Use the CSV AnyPPG card instead.');
  }
}

function recordRejection(recording, reasons, status = 'failed') {
  const reason = Array.isArray(reasons) ? reasons.join('; ') : String(reasons);
  if (status === 'missed') history.markMissed(recording.intervalId, reason);
  else history.markFailed(recording.intervalId, reason);
  return reason;
}

/**
 * @param {object} input sync recording
 * @param {{createAdapter: Function, shouldCancel?: Function, channel?: 'red'|'infrared', motionRmsMax?: number}} options
 */
async function runWatchRecording(input, options) {
  const started = Date.now();
  rejectSparkFunCsv(input);
  const recording = validateRecording(input);
  need(recording.kind === CONTRACT, 'Expected cdd_ppg_imu_recording_v1.');
  need(typeof options?.createAdapter === 'function', 'Native AnyPPG adapter factory is required.');

  const motion = selectLowMotionSegments(recording.imu.samples, {
    windowDurationSec: 30,
    stepSec: 1,
    maxCandidates: 3,
    motionRmsMax: options.motionRmsMax ?? 0.35,
  });

  const debugBase = {
    experimental: true,
    prototypeLabel: 'experimental_prototype_estimate',
    recordingId: recording.recordingId,
    intervalId: recording.intervalId,
    deviceId: recording.deviceId,
    contract: CONTRACT,
    preprocessingVersion: PREPROCESSING_VERSION,
    modelId: MODEL_ID,
    ppgSampleRateHz: recording.ppg.sampleRateHz,
    accelSampleRateHz: recording.imu.accelSampleRateHz,
    motionCandidates: motion.selected.length,
    motionAllBad: motion.allBad,
    hardwareValidated: false,
    newWatchHardwareValidated: false,
    sensorCompatibilityVerified: false,
    bpAccuracyEvaluated: false,
  };

  if (motion.allBad) {
    const reason = recordRejection(recording, ['imu:no_low_motion_candidate'], 'missed');
    return {
      ...debugBase,
      status: 'rejected',
      qualityDecision: 'rejected',
      rejectionReasons: ['imu:no_low_motion_candidate'],
      processingMs: Date.now() - started,
      estimate: null,
      error: reason,
    };
  }

  const assessment = assessRecordingQuality(recording, {
    channel: options.channel ?? 'red',
    motionRmsMax: options.motionRmsMax ?? 0.35,
  });
  if (!assessment.accepted) {
    const reason = recordRejection(recording, assessment.rejectionReasons, 'failed');
    return {
      ...debugBase,
      status: 'rejected',
      qualityDecision: 'rejected',
      rejectionReasons: assessment.rejectionReasons,
      motionRms: assessment.motionRms,
      processingMs: Date.now() - started,
      estimate: null,
      error: reason,
    };
  }

  const prepared = prepareAcceptedWindow(recording, {
    channel: assessment.channel,
    motionRmsMax: options.motionRmsMax ?? 0.35,
  });

  let adapter;
  let cleanupFailure;
  let error;
  let bp;
  let inferenceMs = 0;
  try {
    need(!(options.shouldCancel && options.shouldCancel()), 'Watch inference cancelled.');
    adapter = await options.createAdapter();
    need(!(options.shouldCancel && options.shouldCancel()), 'Watch inference cancelled.');
    const result = await adapter.run(prepared.normalized);
    inferenceMs = result.inferenceMs;
    const head = options.head;
    need(head, 'AnyPPG ridge head is required.');
    bp = applyHead(result.features, head);
  } catch (e) {
    error = e;
  } finally {
    if (adapter) {
      try { await adapter.release(); } catch (e) { cleanupFailure = String(e); }
    }
  }
  if (error || cleanupFailure) {
    const message = [error ? String(error) : '', cleanupFailure ? 'Session cleanup failed: ' + cleanupFailure : ''].filter(Boolean).join('; ');
    recordRejection(recording, [message], 'failed');
    return {
      ...debugBase,
      status: 'error',
      qualityDecision: 'accepted_for_anyppg_input',
      rejectionReasons: [],
      motionRms: assessment.motionRms,
      processingMs: Date.now() - started,
      estimate: null,
      error: message,
    };
  }

  const estimate = history.saveEstimate({
    recordingId: recording.recordingId,
    intervalId: recording.intervalId,
    captureStartedAt: recording.captureStartedAt,
    sbp: bp[0],
    dbp: bp[1],
    channel: assessment.channel,
    modelHash: options.modelSha256 ?? null,
    preprocessingVersion: PREPROCESSING_VERSION,
    qualityStatus: 'accepted',
    calibrationStatus: 'none',
    sourceKind: 'watch_live',
  });

  return {
    ...debugBase,
    status: 'accepted',
    qualityDecision: 'accepted_for_anyppg_input',
    rejectionReasons: [],
    motionRms: assessment.motionRms,
    channel: assessment.channel,
    inferenceMs,
    processingMs: Date.now() - started,
    estimate,
    sbp: bp[0],
    dbp: bp[1],
    error: null,
  };
}

module.exports = { runWatchRecording, rejectSparkFunCsv };
