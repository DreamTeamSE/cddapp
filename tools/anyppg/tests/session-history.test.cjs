const test = require('node:test');
const assert = require('node:assert/strict');
const {recordCsvReport, history} = require('../../../services/anyppg/sessionHistory');

test('CSV AnyPPG reports are recorded into prototype history without journal writes', () => {
  const before = history.listEstimates().length;
  const saved = recordCsvReport({
    complete: true,
    startedAt: '2026-11-09T22:00:00.000Z',
    synthetic: false,
    modelSha256: 'abc',
    calibrationApplied: false,
    windows: [
      {channel: 'red', startSeconds: 0, lastSampleSeconds: 29.992, sbp: 100.1, dbp: 70.2, inferenceMs: 1},
      {channel: 'infrared', startSeconds: 0, lastSampleSeconds: 29.992, sbp: 101.1, dbp: 71.2, inferenceMs: 1},
    ],
  });
  assert.equal(saved.length, 2);
  assert.equal(saved[0].sourceKind, 'imported_csv');
  assert.equal(saved[0].experimental, true);
  assert.equal(history.listEstimates().length, before + 2);
});
