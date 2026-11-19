'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeDemoSyncRecording } = require('../../../services/recordings/syncContract');
const { assessRecordingQuality } = require('../../../services/recordings/qualityGate');
const { runWatchRecording } = require('../../../services/anyppg/watchInference');
const head = require('../../../assets/models/anyppg/ridge_head.json');

function fakeAdapter() {
  return {
    async run(normalized) {
      assert.equal(normalized.length, 3750);
      return { features: new Float32Array(1536).fill(0), inferenceMs: 1 };
    },
    async release() {},
  };
}

test('quality: flat red with good IR fails on red and passes on infrared', () => {
  const recording = makeDemoSyncRecording({
    seconds: 32,
    motion: 'low',
    flatlineChannels: ['red'],
    recordingId: 'fallback-quality-1',
  });
  const red = assessRecordingQuality(recording, { channel: 'red' });
  const ir = assessRecordingQuality(recording, { channel: 'infrared' });
  assert.equal(red.accepted, false);
  assert.ok(red.rejectionReasons.some((r) => r.startsWith('ppg:')));
  assert.equal(ir.accepted, true);
  assert.equal(ir.channel, 'infrared');
});

test('watch inference falls back to IR when red fails quality (no fusion)', async () => {
  const recording = makeDemoSyncRecording({
    seconds: 32,
    motion: 'low',
    flatlineChannels: ['red'],
    recordingId: 'fallback-infer-1',
  });
  const report = await runWatchRecording(recording, {
    createAdapter: async () => fakeAdapter(),
    head,
    modelSha256: 'test',
  });
  assert.equal(report.status, 'accepted');
  assert.equal(report.channel, 'infrared');
  assert.equal(report.estimate.channel, 'infrared');
  assert.equal(report.channelPolicy, 'red_then_infrared_no_fusion');
  assert.ok(report.windowAttempts.some((a) => a.channel === 'red' && a.accepted === false));
  assert.ok(report.windowAttempts.some((a) => a.channel === 'infrared' && a.accepted === true));
});

test('watch inference reports both failed when red and IR are flat', async () => {
  const recording = makeDemoSyncRecording({
    seconds: 32,
    motion: 'low',
    flatline: true,
    recordingId: 'fallback-both-fail',
  });
  const report = await runWatchRecording(recording, {
    createAdapter: async () => fakeAdapter(),
    head,
  });
  assert.equal(report.status, 'rejected');
  assert.equal(report.estimate, null);
  assert.ok(report.windowAttempts.some((a) => a.channel === 'red'));
  assert.ok(report.windowAttempts.some((a) => a.channel === 'infrared'));
});

test('pinning options.channel disables IR fallback', async () => {
  const recording = makeDemoSyncRecording({
    seconds: 32,
    motion: 'low',
    flatlineChannels: ['red'],
    recordingId: 'fallback-pinned-red',
  });
  const report = await runWatchRecording(recording, {
    createAdapter: async () => fakeAdapter(),
    head,
    channel: 'red',
  });
  assert.equal(report.status, 'rejected');
  assert.ok(report.windowAttempts.every((a) => a.channel === 'red'));
});
