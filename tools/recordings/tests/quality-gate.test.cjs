const test = require('node:test');
const assert = require('node:assert/strict');
const sync = require('../../../services/recordings/syncContract');
const quality = require('../../../services/recordings/qualityGate');
const {standardizeWindow} = require('../../../services/anyppg/core');

function makeThirtySecondRecording(edit) {
  const ppgRate = 100;
  const imuRate = 100;
  const seconds = 32;
  const ppgSamples = [];
  const imuSamples = [];
  for (let i = 0; i < ppgRate * seconds; i++) {
    const t = (i * 1000) / ppgRate;
    const wave = Math.fround(500000 + 2500 * Math.sin((2 * Math.PI * 1.15 * i) / ppgRate));
    ppgSamples.push([i, t, wave, Math.fround(wave * 0.97), 0]);
  }
  for (let i = 0; i < imuRate * seconds; i++) {
    const t = (i * 1000) / imuRate;
    imuSamples.push([i, t, 0.02, -0.01, 9.81, 0, 0, 0, 0]);
  }
  const recording = sync.makeDemoSyncRecording({
    recordingId: 'sync-quality-001',
    ppg: {
      sampleRateHz: ppgRate,
      timingSource: 'sample_clock',
      channels: {
        red: { available: true, wavelengthNm: 660, units: 'adc_counts', provenance: 'raw_adc', adcMin: 0, adcMax: 1048575 },
        infrared: { available: true, wavelengthNm: 950, units: 'adc_counts', provenance: 'raw_adc', adcMin: 0, adcMax: 1048575 },
      },
      samples: ppgSamples,
    },
    imu: {
      accelSampleRateHz: imuRate,
      gyroSampleRateHz: imuRate,
      accelUnits: 'm/s^2',
      gyroUnits: 'rad/s',
      timingSource: 'sample_clock',
      samples: imuSamples,
    },
  });
  if (edit) edit(recording);
  return sync.validateRecording(recording);
}

test('accepts a clean 30s+ low-motion recording and prepares AnyPPG-shaped input', () => {
  const recording = makeThirtySecondRecording();
  const assessment = quality.assessRecordingQuality(recording);
  assert.equal(assessment.accepted, true);
  assert.equal(assessment.bpAccuracyConfidence, null);
  const prepared = quality.prepareAcceptedWindow(recording);
  assert.equal(prepared.samples.length, 3750);
  assert.equal(prepared.normalized.length, 3750);
  assert.equal(prepared.preprocessingVersion, 'anyppg_watch_prep_v1');
  // Chunk norm must match AnyPPG standardizeWindow on the same resampled series.
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
    // Create a >40 ms gap by deleting a stretch of samples and leaving a sequence hole undeclared → schema fails,
    // or shift timestamps after index 50.
    for (let i = 50; i < r.ppg.samples.length; i++) r.ppg.samples[i][1] += 100;
  });
  const assessment = quality.assessRecordingQuality(recording);
  assert.equal(assessment.accepted, false);
  assert(assessment.rejectionReasons.some((x) => x.includes('gap') || x.includes('schema') || x.includes('duration')));
});
