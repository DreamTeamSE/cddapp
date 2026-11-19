import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrototypePipeline } from '../../services/measurement/prototype-pipeline.ts';

const fixture = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/sync-recordings/valid.json'), 'utf8'),
);

test('prototype pipeline composes sync contract, transfer, scheduler, and disabled experiments', () => {
  const pipeline = createPrototypePipeline();
  const inspection = pipeline.inspect(fixture);
  assert.equal(inspection.contract, 'cdd_ppg_imu_recording_v1');
  assert.equal(pipeline.motionTrigger.enabled, false);
  assert.equal(pipeline.imuDenoise.enabled, false);
  const chunks = pipeline.encodeForBle(JSON.stringify(fixture), fixture.recordingId, fixture.intervalId, 400);
  let complete = false;
  for (const chunk of chunks) {
    if (pipeline.acceptBleChunk(chunk).status === 'complete') complete = true;
  }
  assert.equal(complete, true);
  assert.equal(pipeline.scheduler.ensureDue(Date.parse(fixture.captureStartedAt)).state, 'scheduled');
});

test('prototype pipeline runWatch rejects high-motion without fabricating BP', async () => {
  const { makeDemoSyncRecording } = await import('../../services/recordings/syncContract.js');
  const pipeline = createPrototypePipeline();
  const recording = makeDemoSyncRecording({ seconds: 32, motion: 'high', recordingId: 'pipe-high-1' });
  const report = await pipeline.runWatch(recording, {
    createAdapter: async () => {
      throw new Error('adapter must not run on rejected motion');
    },
    head: { bias: [0, 0], weights: [[0], [0]], featureMean: [0], featureStd: [1] },
  });
  assert.notEqual(report.status, 'accepted');
  assert.equal(report.estimate, null);
});

test('prototype pipeline builds sync JSON from a complete sensor window', () => {
  const pipeline = createPrototypePipeline();
  const n = 100;
  const rate = 100;
  const samples = Array.from({ length: n }, (_, i) => Math.fround(500000 + i));
  const zeros = Array.from({ length: n }, () => 0.01);
  const window = {
    identity: { source: 'bracelet' as const, deviceId: 'd1', acquisitionId: 'a1', windowId: 'w1' },
    manifest: {
      contractVersion: 'fixture',
      packetCount: 1,
      channels: [
        { channelId: 'ppg.red', sampleCount: n },
        { channelId: 'ppg.infrared', sampleCount: n },
        { channelId: 'imu.ax', sampleCount: n },
        { channelId: 'imu.ay', sampleCount: n },
        { channelId: 'imu.az', sampleCount: n },
      ],
    },
    channels: [
      { channelId: 'ppg.red', samples, unit: 'adc_counts', timing: { sampleRateHz: rate, firstSampleOffsetMs: 0 } },
      { channelId: 'ppg.infrared', samples, unit: 'adc_counts', timing: { sampleRateHz: rate, firstSampleOffsetMs: 0 } },
      { channelId: 'imu.ax', samples: zeros, unit: 'm/s^2', timing: { sampleRateHz: rate, firstSampleOffsetMs: 0 } },
      { channelId: 'imu.ay', samples: zeros, unit: 'm/s^2', timing: { sampleRateHz: rate, firstSampleOffsetMs: 0 } },
      { channelId: 'imu.az', samples: Array.from({ length: n }, () => 9.81), unit: 'm/s^2', timing: { sampleRateHz: rate, firstSampleOffsetMs: 0 } },
    ],
    acquisitionTime: { kind: 'wall-clock' as const, timestampMs: Date.parse('2026-11-09T17:00:00.000Z'), synchronized: true },
    firstReceivedAtMs: Date.parse('2026-11-09T17:00:00.000Z'),
    lastReceivedAtMs: Date.parse('2026-11-09T17:00:01.000Z'),
    diagnostics: { receivedPacketCount: 1, identicalDuplicateCount: 0 },
  };
  const recording = pipeline.buildFromCompleteWindow(window, { recordingId: 'pipe-builder-1' }) as { kind: string };
  assert.equal(recording.kind, pipeline.contract);
});
