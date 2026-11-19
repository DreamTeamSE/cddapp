import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createRequire } from 'node:module';

import type { CompleteSensorWindow } from '../../types/measurement.ts';
import { buildSyncRecordingFromCompleteWindow } from '../../services/device/sync-recording-builder.ts';

const require = createRequire(import.meta.url);
const syncContract = require('../../services/recordings/syncContract.js') as {
  CONTRACT: string;
  validateRecording: (input: unknown) => { kind: string; ppg: { samples: unknown[] }; imu: { samples: unknown[] } };
};

function syntheticWindow(overrides: {
  redFlat?: boolean;
  omitRed?: boolean;
  omitIr?: boolean;
  omitAccel?: boolean;
  samples?: number;
} = {}): CompleteSensorWindow {
  const n = overrides.samples ?? 300;
  const rate = 100;
  const wave = (i: number) => Math.fround(500000 + 2000 * Math.sin((2 * Math.PI * 1.2 * i) / rate));
  const redSamples = Array.from({ length: n }, (_, i) => (overrides.redFlat ? 100 : wave(i)));
  const irSamples = Array.from({ length: n }, (_, i) => Math.fround(wave(i) * 0.98));
  const ax = Array.from({ length: n }, () => 0.01);
  const ay = Array.from({ length: n }, () => -0.02);
  const az = Array.from({ length: n }, () => 9.81);
  const gx = Array.from({ length: n }, () => 0.001);
  const gy = Array.from({ length: n }, () => -0.002);
  const gz = Array.from({ length: n }, () => 0);

  const channels = [];
  if (!overrides.omitRed) {
    channels.push({
      channelId: 'ppg.red',
      samples: redSamples,
      unit: 'adc_counts',
      timing: { sampleRateHz: rate, firstSampleOffsetMs: 0 },
    });
  }
  if (!overrides.omitIr) {
    channels.push({
      channelId: 'ppg.infrared',
      samples: irSamples,
      unit: 'adc_counts',
      timing: { sampleRateHz: rate, firstSampleOffsetMs: 0 },
    });
  }
  if (!overrides.omitAccel) {
    for (const [id, samples] of [
      ['imu.ax', ax], ['imu.ay', ay], ['imu.az', az],
      ['imu.gx', gx], ['imu.gy', gy], ['imu.gz', gz],
    ] as const) {
      channels.push({
        channelId: id,
        samples,
        unit: id.startsWith('imu.a') ? 'm/s^2' : 'rad/s',
        timing: { sampleRateHz: rate, firstSampleOffsetMs: 0 },
      });
    }
  }

  return {
    identity: {
      source: 'bracelet',
      deviceId: 'proto-watch-001',
      acquisitionId: 'acq-1',
      windowId: 'window-1',
    },
    manifest: {
      contractVersion: 'fixture',
      packetCount: 1,
      channels: channels.map((ch) => ({ channelId: ch.channelId, sampleCount: ch.samples.length })),
    },
    channels,
    acquisitionTime: { kind: 'wall-clock', timestampMs: Date.parse('2026-11-09T17:00:00.000Z'), synchronized: true },
    firstReceivedAtMs: Date.parse('2026-11-09T17:00:00.000Z'),
    lastReceivedAtMs: Date.parse('2026-11-09T17:00:03.000Z'),
    diagnostics: { receivedPacketCount: 1, identicalDuplicateCount: 0 },
  };
}

describe('sync recording builder (#27)', () => {
  it('maps a complete window into a validateRecording-accepted sync JSON', () => {
    const recording = buildSyncRecordingFromCompleteWindow(syntheticWindow(), {
      recordingId: 'builder-demo-001',
      intervalId: 'interval-builder-1',
    }) as ReturnType<typeof syncContract.validateRecording>;
    assert.equal(recording.kind, syncContract.CONTRACT);
    assert.equal(recording.ppg.samples.length, 300);
    assert.equal(recording.imu.samples.length, 300);
    // Round-trip through the same validator used by the watch path.
    syncContract.validateRecording(recording);
  });

  it('rejects incomplete windows instead of inventing half-recordings', () => {
    assert.throws(
      () => buildSyncRecordingFromCompleteWindow(syntheticWindow({ omitAccel: true }), { recordingId: 'bad-1' }),
      /imu\.ax/,
    );
    assert.throws(
      () => buildSyncRecordingFromCompleteWindow(syntheticWindow({ omitRed: true, omitIr: true }), { recordingId: 'bad-2' }),
      /ppg\.red/,
    );
    assert.throws(
      () => buildSyncRecordingFromCompleteWindow(syntheticWindow(), { recordingId: '' }),
      /recordingId/,
    );
  });
});
