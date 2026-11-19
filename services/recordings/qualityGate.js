'use strict';
/**
 * Phone-side PPG quality gate + AnyPPG-compatible resampling for sync recordings.
 * Quality labels are data-quality assessments, not BP accuracy confidence.
 * Issue #16 beat normalization is intentionally not used here.
 * PDF Stage 5 (clean window): callers should pass windowStartMs/windowEndMs from motion selection.
 */
const {inspectSyncRecording, PREPROCESSING_VERSION, validateRecording} = require('./syncContract');
const {standardizeWindow} = require('../anyppg/core');

const TARGET_HZ = 125;
const WINDOW_SAMPLES = 3750;
const MAX_INTERP_GAP_MS = 40; // reject larger unobserved gaps instead of inventing physiology

const need = (ok, message) => { if (!ok) throw new Error(message); };
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

function channelValues(recording, channel, windowStartMs = null, windowEndMs = null) {
  const col = channel === 'red' ? 2 : 3;
  return recording.ppg.samples
    .filter((row) => {
      if (row[4] !== 0 || row[col] === null) return false;
      const t = row[1] + recording.alignment.ppgEpochOffsetMs;
      if (windowStartMs !== null && t < windowStartMs) return false;
      if (windowEndMs !== null && t > windowEndMs) return false;
      return true;
    })
    .map((row) => ({t: row[1] + recording.alignment.ppgEpochOffsetMs, v: row[col]}));
}

/**
 * Crop a sync recording to [startMs, endMs] (device monotonic offsets + epoch).
 * Reindexes sequences so schema sequence-gap checks stay valid on the slice.
 */
function sliceRecordingByTimeRange(input, startMs, endMs) {
  const recording = validateRecording(input);
  need(finite(startMs) && finite(endMs) && endMs > startMs, 'Window start/end must be finite with end > start.');
  const ppgEpoch = recording.alignment.ppgEpochOffsetMs;
  const imuEpoch = recording.alignment.imuEpochOffsetMs;
  const ppgSamples = recording.ppg.samples
    .filter((row) => {
      const t = row[1] + ppgEpoch;
      return t >= startMs && t <= endMs;
    })
    .map((row, i) => [i, row[1], row[2], row[3], row[4]]);
  const imuSamples = recording.imu.samples
    .filter((row) => {
      const t = row[1] + imuEpoch;
      return t >= startMs && t <= endMs;
    })
    .map((row, i) => [i, row[1], row[2], row[3], row[4], row[5], row[6], row[7], row[8]]);
  need(ppgSamples.length >= 2, 'Sliced PPG window has insufficient samples.');
  need(imuSamples.length >= 2, 'Sliced IMU window has insufficient samples.');
  return validateRecording({
    ...recording,
    ppg: { ...recording.ppg, samples: ppgSamples },
    imu: { ...recording.imu, samples: imuSamples },
    qualityHints: {
      ...(recording.qualityHints && typeof recording.qualityHints === 'object' ? recording.qualityHints : {}),
      slicedWindow: { startMs, endMs },
    },
  });
}

function channelProvenance(recording, channel) {
  return recording.ppg.channels[channel].provenance;
}

function detectPpgIssues(series, adcMin, adcMax, sampleRateHz) {
  const reasons = [];
  if (series.length < 2) return ['insufficient_ppg_samples'];
  const values = series.map((s) => s.v);
  let min = Infinity, max = -Infinity, m2 = 0, rail = 0, run = 1, maxRun = 1;
  let mean = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    min = Math.min(min, v); max = Math.max(max, v);
    const delta = v - mean; mean += delta / (i + 1); m2 += delta * (v - mean);
    if (adcMin !== null && (v <= adcMin || v >= adcMax)) rail++;
    if (i && v === values[i - 1]) { run++; maxRun = Math.max(maxRun, run); } else run = 1;
  }
  const std = Math.sqrt(Math.max(0, m2 / values.length));
  if (min === max || std < 1e-6) reasons.push('flatline');
  if (maxRun >= Math.max(2, Math.ceil(sampleRateHz))) reasons.push('constant_run');
  if (rail > 0) reasons.push('clipping_or_saturation');
  let maxGap = 0;
  for (let i = 1; i < series.length; i++) maxGap = Math.max(maxGap, series[i].t - series[i - 1].t);
  if (maxGap > MAX_INTERP_GAP_MS) reasons.push('gap_too_large');
  return reasons;
}

function accelMotionRms(recording, startMs, endMs, removeGravity = true) {
  const rows = recording.imu.samples.filter((row) => {
    const t = row[1] + recording.alignment.imuEpochOffsetMs;
    return row[8] === 0 && t >= startMs && t <= endMs && row[2] !== null;
  });
  if (rows.length < 2) return {ok: false, rms: null, reason: 'insufficient_imu'};
  let sumSq = 0;
  for (const row of rows) {
    let ax = row[2], ay = row[3], az = row[4];
    if (removeGravity) {
      // Approximate gravity removal using vector magnitude toward 9.81 along dominant axis is avoided;
      // subtract mean per axis inside the window instead.
    }
  }
  const mean = [0, 0, 0];
  for (const row of rows) { mean[0] += row[2]; mean[1] += row[3]; mean[2] += row[4]; }
  mean[0] /= rows.length; mean[1] /= rows.length; mean[2] /= rows.length;
  for (const row of rows) {
    const dx = row[2] - (removeGravity ? mean[0] : 0);
    const dy = row[3] - (removeGravity ? mean[1] : 0);
    const dz = row[4] - (removeGravity ? mean[2] : 0);
    sumSq += dx * dx + dy * dy + dz * dz;
  }
  return {ok: true, rms: Math.sqrt(sumSq / rows.length), reason: null};
}

function resampleToTarget(series, targetHz, durationSeconds) {
  need(series.length >= 2, 'Cannot resample without samples.');
  const origin = series[0].t;
  const length = Math.round(durationSeconds * targetHz);
  const out = new Float64Array(length);
  let right = 1;
  for (let i = 0; i < length; i++) {
    const t = origin + (i * 1000) / targetHz;
    while (right < series.length - 1 && series[right].t < t) right++;
    const left = right - 1;
    const dt = series[right].t - series[left].t;
    need(dt > 0, 'Non-increasing PPG times during resample.');
    need(t >= series[left].t && t <= series[right].t, 'Refusing to extrapolate outside observed PPG span.');
    need(series[right].t - series[left].t <= MAX_INTERP_GAP_MS, 'Gap exceeds interpolation limit.');
    const slope = (series[right].v - series[left].v) / dt;
    out[i] = series[left].v + slope * (t - series[left].t);
  }
  return out;
}

/**
 * Assess a synchronized recording for AnyPPG readiness.
 * Low IMU motion alone never implies acceptance.
 * Optional windowStartMs/windowEndMs limit PPG/IMU checks to a motion-selected slice.
 */
function assessRecordingQuality(input, options = {}) {
  const recording = validateRecording(input);
  const schema = inspectSyncRecording(recording);
  const motionRmsMax = options.motionRmsMax ?? 0.35;
  const preferredChannel = options.channel ?? 'red';
  const windowStartMs = options.windowStartMs ?? null;
  const windowEndMs = options.windowEndMs ?? null;
  const reasons = [];
  if (!schema.schemaAccepted) reasons.push(...schema.blockers.map((b) => 'schema:' + b));

  const available = {
    red: recording.ppg.channels.red.available,
    infrared: recording.ppg.channels.infrared.available,
  };
  need(available[preferredChannel], 'Requested PPG channel is not available.');

  const series = channelValues(recording, preferredChannel, windowStartMs, windowEndMs);
  const spanMs = series.length ? series[series.length - 1].t - series[0].t : 0;
  if (spanMs < 30000) reasons.push('duration_below_30s');

  const ppgReasons = detectPpgIssues(
    series,
    recording.ppg.channels[preferredChannel].adcMin,
    recording.ppg.channels[preferredChannel].adcMax,
    recording.ppg.sampleRateHz,
  );
  reasons.push(...ppgReasons.map((r) => 'ppg:' + r));

  const motionStart = windowStartMs ?? (series[0]?.t ?? 0);
  const motionEnd = windowEndMs ?? (motionStart + 30000);
  const motion = accelMotionRms(recording, motionStart, motionEnd, true);
  if (!motion.ok) reasons.push('imu:' + motion.reason);
  else if (motion.rms > motionRmsMax) reasons.push('imu:high_motion');

  const provenance = channelProvenance(recording, preferredChannel);
  const accepted = reasons.length === 0;
  return {
    schemaVersion: 1,
    preprocessingVersion: PREPROCESSING_VERSION,
    recordingId: recording.recordingId,
    intervalId: recording.intervalId,
    channel: preferredChannel,
    accepted,
    rejectionReasons: reasons,
    motionRms: motion.rms,
    motionRmsMax,
    windowStartMs,
    windowEndMs,
    signalProvenance: provenance,
    qualityLabel: accepted ? 'accepted_for_anyppg_input' : 'rejected',
    // Explicitly not a clinical confidence score:
    bpAccuracyConfidence: null,
    hardwareValidated: false,
  };
}

function prepareAcceptedWindow(input, options = {}) {
  const recording = validateRecording(input);
  const assessment = assessRecordingQuality(recording, options);
  need(assessment.accepted, 'Recording rejected: ' + assessment.rejectionReasons.join('; '));
  const channel = assessment.channel;
  const series = channelValues(recording, channel, options.windowStartMs ?? null, options.windowEndMs ?? null);
  // Resample the first full 30 s of the (possibly motion-cropped) series onto the AnyPPG grid.
  const signal = resampleToTarget(series, TARGET_HZ, 30);
  need(signal.length === WINDOW_SAMPLES, 'Resampled window must be 3750 samples.');
  const normalized = standardizeWindow(signal);
  const provenance = assessment.signalProvenance;
  // firmware_filtered: rate convert + gate + chunk norm only — never apply a second undocumented filter.
  return {
    assessment,
    preprocessingVersion: PREPROCESSING_VERSION,
    modelSamplingRateHz: TARGET_HZ,
    channel,
    samples: signal,
    normalized,
    signalProvenance: provenance,
    rawUnmodified: provenance === 'raw_adc',
    doubleFilterAvoided: provenance === 'firmware_filtered',
  };
}

module.exports = {
  TARGET_HZ,
  WINDOW_SAMPLES,
  MAX_INTERP_GAP_MS,
  assessRecordingQuality,
  prepareAcceptedWindow,
  sliceRecordingByTimeRange,
  channelValues,
  accelMotionRms,
  resampleToTarget,
};
