const test = require('node:test');
const assert = require('node:assert/strict');
const {createEstimateHistory} = require('../../../services/readings/estimate-history');

test('stores accepted estimates idempotently and never fabricates missed readings', () => {
  const history = createEstimateHistory();
  const first = history.saveEstimate({
    recordingId: 'rec-1',
    intervalId: 'interval-1',
    captureStartedAt: '2026-11-09T17:00:00.000Z',
    sbp: 118.5,
    dbp: 76.2,
    channel: 'red',
    modelHash: 'abc',
    preprocessingVersion: 'anyppg_watch_prep_v1',
    qualityStatus: 'accepted',
    calibrationStatus: 'none',
    sourceKind: 'watch_live',
  });
  const again = history.saveEstimate({
    recordingId: 'rec-1',
    intervalId: 'interval-1',
    captureStartedAt: '2026-11-09T17:00:00.000Z',
    sbp: 999,
    dbp: 999,
    channel: 'red',
    modelHash: 'abc',
    preprocessingVersion: 'anyppg_watch_prep_v1',
    qualityStatus: 'accepted',
    sourceKind: 'watch_live',
  });
  assert.equal(first.sbp, again.sbp);
  assert.equal(history.listEstimates().length, 1);
  assert.equal(first.experimental, true);
  assert.equal(first.prototypeLabel, 'experimental_prototype_estimate');

  assert.throws(() => history.saveEstimate({
    recordingId: 'rec-2',
    intervalId: 'interval-2',
    captureStartedAt: '2026-11-09T17:15:00.000Z',
    sbp: 120,
    dbp: 80,
    channel: 'red',
    preprocessingVersion: 'anyppg_watch_prep_v1',
    qualityStatus: 'rejected',
    sourceKind: 'watch_live',
  }), /quality-accepted/);

  const missed = history.markMissed('interval-2', 'high_motion');
  assert.equal(missed.state, 'missed');
  assert.equal(missed.estimateId, null);
  assert.equal(history.listEstimates().length, 1);
});

test('distinguishes imported CSV estimates from live watch measurements', () => {
  const history = createEstimateHistory();
  history.saveEstimate({
    recordingId: 'csv-1',
    intervalId: 'imported',
    captureStartedAt: '2026-10-08T00:00:00.000Z',
    sbp: 100,
    dbp: 70,
    channel: 'infrared',
    preprocessingVersion: 'anyppg_watch_prep_v1',
    qualityStatus: 'accepted',
    sourceKind: 'imported_csv',
  });
  assert.equal(history.listEstimates()[0].sourceKind, 'imported_csv');
});
