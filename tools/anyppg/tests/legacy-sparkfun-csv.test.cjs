/* global __dirname */
/**
 * Regression against the legacy SparkFun Bio Hub CSV (CDD_DataCollection.zip).
 * NOT validation of AFE4404 / SFH 7050A / BMI270, IMU sync, BLE, or cuff accuracy.
 */
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = path.resolve(__dirname, '../../..');
const fixtureDir = path.join(root, 'tests/fixtures/anyppg');
const csvPath = path.join(fixtureDir, 'legacy_sparkfun_ac_20260923.csv');
const reference = require('../../../tests/fixtures/anyppg/legacy_sparkfun_ac_reference.json');
const provenance = require('../../../tests/fixtures/anyppg/provenance.json');
const {parseSerialCsv, inspectSerialCsv} = require('../../../services/recordings/serialCsv');
const {prepareRecording, standardizeWindow, applyHead, runRecording, MODEL_ID} = require('../../../services/anyppg/core');
const head = require('../../../assets/models/anyppg/ridge_head.json');
const manifest = require('../../../assets/models/anyppg/manifest.json');

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function sha256Float32(arr) {
  return crypto.createHash('sha256').update(Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength)).digest('hex');
}

test('legacy SparkFun fixture is present and provenance excludes new-watch claims', () => {
  assert.equal(fs.existsSync(csvPath), true);
  assert.equal(sha256File(csvPath), reference.csvSha256);
  assert.equal(sha256File(csvPath), provenance.csvSha256);
  assert.equal(provenance.hardware.imuPresent, false);
  assert.equal(provenance.hardware.pairedCuffPresent, false);
  assert.equal(provenance.hardware.notNewWatchStack, true);
  assert.equal(reference.newWatchHardware, false);
  assert.equal(reference.bpAccuracyEvaluated, false);
  assert.equal(reference.hardwareValidated, false);
});

test('parses and inspects the actual legacy AC CSV without inventing a sample clock', () => {
  const recording = parseSerialCsv(fs.readFileSync(csvPath, 'utf8'));
  assert.equal(recording.kind, 'cdd_serial_csv_v1');
  assert.equal(recording.format, 'legacy_ac');
  assert.equal(recording.rows.length, reference.sampleCount);
  const inspection = inspectSerialCsv(recording);
  assert.equal(inspection.sampleCount, 1322);
  assert.equal(inspection.elapsedSeconds, reference.elapsedSeconds);
  assert.equal(inspection.declaredSensorRateHz, null);
  assert.equal(inspection.intervalMs.max, reference.maxLoggedGapMs);
  assert.equal(inspection.modelInferenceRun, false);
});

test('AnyPPG preparation + per-chunk normalization stay bit-stable on the legacy CSV', () => {
  const recording = parseSerialCsv(fs.readFileSync(csvPath, 'utf8'));
  const prepared = prepareRecording(recording);
  assert.equal(prepared.gridSamples, reference.gridSamples);
  assert.deepEqual(prepared.starts, reference.starts);
  const observed = [];
  for (const {channel, signal} of prepared.channels) {
    for (const start of prepared.starts) {
      const normalized = standardizeWindow(signal.subarray(start, start + 3750));
      observed.push({
        channel,
        startSample: start,
        startSeconds: start / 125,
        lastSampleSeconds: (start + 3749) / 125,
        normalizedSha256: sha256Float32(normalized),
      });
    }
  }
  assert.equal(observed.length, 4);
  for (let i = 0; i < 4; i++) {
    assert.equal(observed[i].channel, reference.windows[i].channel);
    assert.equal(observed[i].startSample, reference.windows[i].startSample);
    assert.equal(observed[i].normalizedSha256, reference.windows[i].normalizedSha256);
  }
});

test('legacy CSV stays on the AnyPPG serial path and is not a sync PPG+IMU recording', () => {
  const recording = parseSerialCsv(fs.readFileSync(csvPath, 'utf8'));
  assert.equal(recording.format, 'legacy_ac');
  assert.doesNotThrow(() => prepareRecording(recording));
  const sync = require('../../../services/recordings/syncContract');
  assert.throws(() => sync.parseSyncRecordingJson(fs.readFileSync(csvPath, 'utf8')), /Invalid JSON|Unsupported/);
});

test('host ONNX Runtime reproduces documented AnyPPG SBP/DBP for the legacy CSV', async (t) => {
  let ort;
  try {
    ort = require('onnxruntime-node');
  } catch {
    t.skip('onnxruntime-node is not installed; parse/normalize regressions above still ran.');
    return;
  }
  const {createAdapter} = require('../../../services/anyppg/ort');
  const recording = parseSerialCsv(fs.readFileSync(csvPath, 'utf8'));
  const modelPath = path.join(root, 'assets/models/anyppg/anyppg_encoder.onnx');
  const report = await runRecording({
    recording,
    head,
    manifest,
    createAdapter: async () => createAdapter({ort, uri: modelPath}),
  });
  assert.equal(report.modelId, MODEL_ID);
  assert.equal(report.windows.length, 4);
  assert.equal(report.bpAccuracyEvaluated, false);
  assert.equal(report.qualityValidated, false);
  assert.equal(report.sensorCompatibilityVerified, false);
  for (let i = 0; i < 4; i++) {
    const got = report.windows[i];
    const exp = reference.windows[i];
    assert.equal(got.channel, exp.channel);
    assert.ok(Math.abs(got.startSeconds - exp.startSeconds) < 1e-9);
    assert.ok(Math.abs(got.sbp - exp.expectedSbp) <= reference.toleranceMmhg, `SBP window ${i}: ${got.sbp} vs ${exp.expectedSbp}`);
    assert.ok(Math.abs(got.dbp - exp.expectedDbp) <= reference.toleranceMmhg, `DBP window ${i}: ${got.dbp} vs ${exp.expectedDbp}`);
  }
  assert.throws(() => applyHead(new Float32Array(1536), {...head, model: 'wrong'}), /Wrong saved BP head/);
});
