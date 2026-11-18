const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sync = require('../../../services/recordings/syncContract');

const fixtureDir = path.resolve(__dirname, '../../../tests/fixtures/sync-recordings');

test('valid synchronized fixture parses and inspects cleanly', () => {
  const json = fs.readFileSync(path.join(fixtureDir, 'valid.json'), 'utf8');
  const recording = sync.parseSyncRecordingJson(json);
  assert.equal(recording.kind, sync.CONTRACT);
  assert.equal(recording.imu.accelUnits, 'm/s^2');
  assert.equal(recording.imu.gyroUnits, 'rad/s');
  const report = sync.inspectSyncRecording(recording);
  assert.equal(report.schemaAccepted, true);
  assert.equal(report.hardwareValidated, false);
  assert.equal(report.modelInferenceRun, false);
});

test('missing-sample fixture remains schema-valid with declared flags', () => {
  const recording = sync.parseSyncRecordingJson(fs.readFileSync(path.join(fixtureDir, 'missing-sample.json'), 'utf8'));
  const report = sync.inspectSyncRecording(recording);
  assert.equal(report.ppg.declaredMissing, 1);
  assert.equal(report.imu.declaredMissing, 1);
  assert.equal(report.schemaAccepted, true);
});

test('out-of-order fixture is detected by inspection', () => {
  const recording = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'out-of-order.json'), 'utf8'));
  const validated = sync.validateRecording(recording);
  const report = sync.inspectSyncRecording(validated);
  assert.equal(report.schemaAccepted, false);
  assert(report.blockers.some((b) => b.includes('PPG')));
});

test('corrupted checksum field is rejected at validate time', () => {
  const recording = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'corrupted.json'), 'utf8'));
  assert.throws(() => sync.validateRecording(recording), /payloadSha256/);
});

test('incompatible schema version is rejected', () => {
  const recording = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'incompatible-version.json'), 'utf8'));
  assert.throws(() => sync.validateRecording(recording), /schemaVersion/);
});

test('demo factory rejects guessed units and preserves provenance', () => {
  const demo = sync.makeDemoSyncRecording();
  assert.equal(demo.ppg.channels.red.provenance, 'raw_adc');
  assert.equal(demo.preprocessingVersion, undefined);
  assert.equal(sync.PREPROCESSING_VERSION, 'anyppg_watch_prep_v1');
});
