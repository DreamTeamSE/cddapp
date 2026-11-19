'use strict';
/**
 * Watch-path orchestration: motion selection → crop window → quality gate → AnyPPG prep.
 * Native ONNX execution is injected by watchInference.native.ts.
 * Never fabricates BP when quality rejects. SparkFun CSV is not accepted here.
 * PDF Stage 5: try motion-selected 30 s windows (best RMS first) before giving up.
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
 * @param {{createAdapter: Function, shouldCancel?: Function, channel?: 'red'|'infrared', motionRmsMax?: number, head?: object, modelSha256?: string|null}} options
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
      selectedWindow: null,
      processingMs: Date.now() - started,
      estimate: null,
      error: reason,
    };
  }

  const channel = options.channel ?? 'red';
  const motionRmsMax = options.motionRmsMax ?? 0.35;
  let assessment = null;
  let prepared = null;
  let selectedWindow = null;
  const windowAttempts = [];

  for (const candidate of motion.selected) {
    const windowOpts = {
      channel,
      motionRmsMax,
      windowStartMs: candidate.startMs,
      windowEndMs: candidate.endMs,
    };
    const attempt = assessRecordingQuality(recording, windowOpts);
    windowAttempts.push({
      startMs: candidate.startMs,
      endMs: candidate.endMs,
      motionRms: candidate.motionRms,
      accepted: attempt.accepted,
      rejectionReasons: attempt.rejectionReasons,
    });
    if (!attempt.accepted) continue;
    assessment = attempt;
    selectedWindow = { startMs: candidate.startMs, endMs: candidate.endMs, motionRms: candidate.motionRms };
    prepared = prepareAcceptedWindow(recording, windowOpts);
    break;
  }

  if (!assessment || !prepared || !selectedWindow) {
    const reasons = windowAttempts.length
      ? windowAttempts.flatMap((a) => a.rejectionReasons.map((r) => `window[${a.startMs}-${a.endMs}]:${r}`))
      : ['imu:no_quality_window'];
    const reason = recordRejection(recording, reasons, 'failed');
    return {
      ...debugBase,
      status: 'rejected',
      qualityDecision: 'rejected',
      rejectionReasons: reasons,
      windowAttempts,
      selectedWindow: null,
      processingMs: Date.now() - started,
      estimate: null,
      error: reason,
    };
  }

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
      selectedWindow,
      signalProvenance: prepared.signalProvenance,
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
    signalProvenance: prepared.signalProvenance,
    windowStartMs: selectedWindow.startMs,
    windowEndMs: selectedWindow.endMs,
  });

  return {
    ...debugBase,
    status: 'accepted',
    qualityDecision: 'accepted_for_anyppg_input',
    rejectionReasons: [],
    motionRms: assessment.motionRms,
    channel: assessment.channel,
    selectedWindow,
    signalProvenance: prepared.signalProvenance,
    windowAttempts,
    inferenceMs,
    processingMs: Date.now() - started,
    estimate,
    sbp: bp[0],
    dbp: bp[1],
    error: null,
  };
}

module.exports = { runWatchRecording, rejectSparkFunCsv };
