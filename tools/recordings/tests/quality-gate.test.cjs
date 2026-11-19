const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sync = require('../../../services/recordings/syncContract');
const quality = require('../../../services/recordings/qualityGate');
const {selectLowMotionSegments} = require('../../../services/device/motion-selection');
const {standardizeWindow} = require('../../../services/anyppg/core');

const FIXTURES = path.join(__dirname, '../../../tests/fixtures/sync-recordings');

function loadFixture(name) {
  return sync.parseSyncRecordingJson(fs.readFileSync(path.join(FIXTURES, name), 'utf8'));
}

function makeThirtySecondRecording(edit) {
  const recording = sync.makeDemoSyncRecording({
    seconds: 32,
    motion: 'low',
    recordingId: 'sync-quality-001',
  });
  if (edit) edit(recording);
  return sync.validateRecording(recording);
}

test('accepts a clean 30s+ low-motion recording and prepares AnyPPG-shaped input', () => {
  const recording = makeThirtySecondRecording();
  const assessment = quality.assessRecordingQuality(recording);
  assert.equal(assessment.accepted, true);
  assert.equal(assessment.bpAccuracyConfidence, null);
  assert.equal(assessment.signalProvenance, 'raw_adc');
  const prepared = quality.prepareAcceptedWindow(recording);
  assert.equal(prepared.samples.length, 3750);
  assert.equal(prepared.normalized.length, 3750);
  assert.equal(prepared.preprocessingVersion, 'anyppg_watch_prep_v1');
  assert.equal(prepared.rawUnmodified, true);
  assert.equal(prepared.doubleFilterAvoided, false);
  assert.deepEqual(Array.from(prepared.normalized), Array.from(standardizeWindow(prepared.samples)));
});

test('rejects flat PPG even when IMU motion is low', () => {
  const recording = makeThirtySecondRecording((r) => {
    for (const row of r.ppg.samples) { row[2] = 100; row[3] = 100; }
  });
  const assessment = quality.assessRecordingQuality(recording);
  assert.equal(assessment.accepted, false);
  assert(assessment.rejectionReasons.some((x) => x.includes('flatline') || x.includes('schema')));
  assert.throws(() => quality.prepareAcceptedWindow(recording), /rejected/);
});

test('rejects high-motion windows', () => {
  const recording = makeThirtySecondRecording((r) => {
    for (let i = 0; i < r.imu.samples.length; i++) {
      r.imu.samples[i][2] = Math.sin(i) * 5;
      r.imu.samples[i][3] = Math.cos(i) * 5;
      r.imu.samples[i][4] = 9.81;
    }
  });
  const assessment = quality.assessRecordingQuality(recording, { motionRmsMax: 0.2 });
  assert.equal(assessment.accepted, false);
  assert(assessment.rejectionReasons.includes('imu:high_motion'));
});

test('refuses to interpolate across a large unobserved gap', () => {
  const recording = makeThirtySecondRecording((r) => {
    for (let i = 50; i < r.ppg.samples.length; i++) r.ppg.samples[i][1] += 100;
  });
  const assessment = quality.assessRecordingQuality(recording);
  assert.equal(assessment.accepted, false);
  assert(assessment.rejectionReasons.some((x) => x.includes('gap') || x.includes('schema') || x.includes('duration')));
});

test('file fixture accept-low-motion-32s passes quality and prep', () => {
  const recording = loadFixture('accept-low-motion-32s.json');
  const assessment = quality.assessRecordingQuality(recording);
  assert.equal(assessment.accepted, true);
  const prepared = quality.prepareAcceptedWindow(recording);
  assert.equal(prepared.samples.length, 3750);
});

test('file fixture reject-high-motion-32s fails quality', () => {
  const recording = loadFixture('reject-high-motion-32s.json');
  const assessment = quality.assessRecordingQuality(recording, { motionRmsMax: 0.2 });
  assert.equal(assessment.accepted, false);
  assert(assessment.rejectionReasons.includes('imu:high_motion'));
});

test('file fixture reject-flatline-32s fails quality', () => {
  const recording = loadFixture('reject-flatline-32s.json');
  const assessment = quality.assessRecordingQuality(recording);
  assert.equal(assessment.accepted, false);
  assert(assessment.rejectionReasons.some((x) => x.includes('flatline') || x.includes('schema')));
});

test('mixed-motion fixture: full file fails, cropped quiet window passes', () => {
  const recording = loadFixture('mixed-motion-needs-window-select.json');
  const full = quality.assessRecordingQuality(recording, { motionRmsMax: 0.35 });
  assert.equal(full.accepted, false, 'full recording includes noisy start');
  assert(full.rejectionReasons.includes('imu:high_motion'));

  const motion = selectLowMotionSegments(recording.imu.samples, {
    windowDurationSec: 30,
    stepSec: 1,
    maxCandidates: 3,
    motionRmsMax: 0.35,
  });
  assert.equal(motion.allBad, false);
  assert.ok(motion.selected[0].startMs >= 9000, 'best window should start after noisy prefix');

  const best = motion.selected[0];
  const windowed = quality.assessRecordingQuality(recording, {
    motionRmsMax: 0.35,
    windowStartMs: best.startMs,
    windowEndMs: best.endMs,
  });
  assert.equal(windowed.accepted, true, windowed.rejectionReasons.join('; '));
  const prepared = quality.prepareAcceptedWindow(recording, {
    windowStartMs: best.startMs,
    windowEndMs: best.endMs,
  });
  assert.equal(prepared.samples.length, 3750);

  const sliced = quality.sliceRecordingByTimeRange(recording, best.startMs, best.endMs);
  assert.ok(sliced.ppg.samples.length >= 2900);
  assert.equal(sliced.ppg.samples[0][0], 0);
});

test('firmware_filtered provenance is recorded and avoids claiming rawUnmodified', () => {
  const recording = loadFixture('firmware-filtered-32s.json');
  assert.equal(recording.ppg.channels.red.provenance, 'firmware_filtered');
  const prepared = quality.prepareAcceptedWindow(recording);
  assert.equal(prepared.signalProvenance, 'firmware_filtered');
  assert.equal(prepared.rawUnmodified, false);
  assert.equal(prepared.doubleFilterAvoided, true);
  assert.equal(prepared.samples.length, 3750);
});

test('resampleToTarget golden: 100 Hz sine → 125 Hz × 30 s = 3750 samples', () => {
  const hz = 100;
  const seconds = 30;
  const series = [];
  for (let i = 0; i <= hz * seconds; i++) {
    const t = (i * 1000) / hz;
    series.push({ t, v: Math.sin((2 * Math.PI * 1.0 * i) / hz) });
  }
  const out = quality.resampleToTarget(series, 125, 30);
  assert.equal(out.length, 3750);
  assert.equal(quality.WINDOW_SAMPLES, 3750);
  assert.equal(quality.TARGET_HZ, 125);
  // First sample matches series origin value.
  assert.ok(Math.abs(out[0] - series[0].v) < 1e-12);
  // Midpoint at 15 s should land on a 100 Hz sample (exact index 1500 at 100 Hz).
  const midT = series[0].t + 15000;
  const midOut = out[Math.round(15 * 125)];
  const left = series.find((s) => s.t === midT) || series[1500];
  assert.ok(Math.abs(midOut - left.v) < 1e-9);
});

test('resampleToTarget refuses gaps larger than MAX_INTERP_GAP_MS', () => {
  const series = [
    { t: 0, v: 0 },
    { t: 10, v: 1 },
    { t: 60, v: 2 },
  ];
  assert.throws(() => quality.resampleToTarget(series, 125, 0.05), /Gap|extrapolate|Non-increasing/i);
});
