'use strict';
/**
 * Low-motion contiguous segment selection for wearable candidates (issue #8).
 * Phone-side reference implementation firmware can mirror. Not hardware-validated.
 */
const need = (ok, message) => { if (!ok) throw new Error(message); };
const finite = (v) => typeof v === 'number' && Number.isFinite(v);

/**
 * @param {Array<[number, number, number|null, number|null, number|null, number|null, number|null, number|null, 0|1]>} imuSamples
 * @param {{windowDurationSec?: number, stepSec?: number, motionRmsMax?: number, maxCandidates?: number, gravityRemoved?: boolean}} [options]
 */
function selectLowMotionSegments(imuSamples, options = {}) {
  need(Array.isArray(imuSamples) && imuSamples.length >= 2, 'IMU samples required.');
  const windowDurationSec = options.windowDurationSec ?? 30;
  const stepSec = options.stepSec ?? 1;
  const motionRmsMax = options.motionRmsMax ?? 0.35;
  const maxCandidates = options.maxCandidates ?? 3;
  const gravityRemoved = options.gravityRemoved ?? true;
  need(finite(windowDurationSec) && windowDurationSec > 0, 'windowDurationSec invalid.');
  need(finite(stepSec) && stepSec > 0, 'stepSec invalid.');
  need(Number.isInteger(maxCandidates) && maxCandidates >= 1, 'maxCandidates invalid.');

  const present = imuSamples.filter((row) => row[8] === 0 && row[2] !== null && row[3] !== null && row[4] !== null);
  need(present.length >= 2, 'Insufficient present IMU samples.');
  const t0 = present[0][1];
  const tEnd = present[present.length - 1][1];
  const windowMs = windowDurationSec * 1000;
  const stepMs = stepSec * 1000;
  const candidates = [];
  const rejections = [];

  for (let start = t0; start + windowMs <= tEnd + 1e-9; start += stepMs) {
    const end = start + windowMs;
    const rows = present.filter((row) => row[1] >= start && row[1] <= end);
    if (rows.length < 2) {
      rejections.push({ startMs: start, endMs: end, reason: 'insufficient_imu', motionRms: null });
      continue;
    }
    const mean = [0, 0, 0];
    for (const row of rows) { mean[0] += row[2]; mean[1] += row[3]; mean[2] += row[4]; }
    mean[0] /= rows.length; mean[1] /= rows.length; mean[2] /= rows.length;
    let sumSq = 0;
    let spike = 0;
    for (const row of rows) {
      const dx = row[2] - (gravityRemoved ? mean[0] : 0);
      const dy = row[3] - (gravityRemoved ? mean[1] : 0);
      const dz = row[4] - (gravityRemoved ? mean[2] : 0);
      const mag = Math.sqrt(dx * dx + dy * dy + dz * dz);
      sumSq += mag * mag;
      if (mag > motionRmsMax * 4) spike++;
    }
    const rms = Math.sqrt(sumSq / rows.length);
    if (rms > motionRmsMax || spike > 0) {
      rejections.push({
        startMs: start,
        endMs: end,
        reason: spike ? 'motion_spike' : 'high_motion_rms',
        motionRms: rms,
      });
      continue;
    }
    candidates.push({
      startMs: start,
      endMs: end,
      motionRms: rms,
      sampleCount: rows.length,
      gravityRemoved,
      rejectionReason: null,
    });
  }

  candidates.sort((a, b) => a.motionRms - b.motionRms);
  const selected = candidates.slice(0, maxCandidates);
  return {
    schemaVersion: 1,
    windowDurationSec,
    motionRmsMax,
    maxCandidates,
    selected,
    rejectedCount: rejections.length,
    // Bound memory: do not return every rejection body in production callers; tests may inspect length only.
    allBad: selected.length === 0,
    hardwareValidated: false,
  };
}

module.exports = { selectLowMotionSegments };
