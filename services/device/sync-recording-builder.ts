/**
 * CompleteSensorWindow → cdd_ppg_imu_recording_v1 builder stub (issue #27).
 * Does not invent BLE wire framing — maps an already-reassembled window into sync JSON.
 */
import { createRequire } from 'node:module';

import type { CompleteSensorWindow, WindowChannel } from '../../types/measurement.ts';

const require = createRequire(import.meta.url);
const syncContract = require('../recordings/syncContract.js') as {
  CONTRACT: string;
  validateRecording: (input: unknown) => unknown;
};

/** Canonical channel IDs the builder understands (aliases accepted too). */
export const SYNC_BUILDER_CHANNEL_IDS = {
  red: ['ppg.red', 'red'],
  infrared: ['ppg.infrared', 'infrared', 'ir'],
  ax: ['imu.ax', 'ax', 'accel.x'],
  ay: ['imu.ay', 'ay', 'accel.y'],
  az: ['imu.az', 'az', 'accel.z'],
  gx: ['imu.gx', 'gx', 'gyro.x'],
  gy: ['imu.gy', 'gy', 'gyro.y'],
  gz: ['imu.gz', 'gz', 'gyro.z'],
} as const;

export type SyncBuilderMeta = {
  readonly recordingId: string;
  readonly deviceId?: string;
  readonly sessionId?: string;
  readonly intervalId?: string;
  readonly captureStartedAt?: string;
  readonly ppgSampleRateHz?: number;
  readonly accelSampleRateHz?: number;
  readonly gyroSampleRateHz?: number;
  readonly provenance?: 'raw_adc' | 'firmware_filtered';
  readonly redWavelengthNm?: number | null;
  readonly infraredWavelengthNm?: number | null;
  readonly adcMin?: number | null;
  readonly adcMax?: number | null;
  readonly ppgImuToleranceMs?: number;
};

function need(ok: unknown, message: string): asserts ok {
  if (!ok) throw new Error(message);
}

function findChannel(window: CompleteSensorWindow, aliases: readonly string[]): WindowChannel | null {
  for (const id of aliases) {
    const found = window.channels.find((ch) => ch.channelId === id);
    if (found) return found;
  }
  return null;
}

function sampleRateHz(channel: WindowChannel | null, fallback: number): number {
  const rate = channel?.timing.sampleRateHz;
  if (typeof rate === 'number' && Number.isFinite(rate) && rate >= 1) return rate;
  return fallback;
}

function offsetsMs(channel: WindowChannel, rateHz: number): number[] {
  const base = channel.timing.firstSampleOffsetMs ?? 0;
  const step = 1000 / rateHz;
  return channel.samples.map((_, i) => Math.fround(base + i * step));
}

function toUtcIso(ms: number): string {
  return new Date(ms).toISOString();
}

/**
 * Build a validated `cdd_ppg_imu_recording_v1` object from a reassembled sensor window.
 * Requires at least one PPG channel (red and/or IR) and accelerometer X/Y/Z.
 */
export function buildSyncRecordingFromCompleteWindow(
  window: CompleteSensorWindow,
  meta: SyncBuilderMeta,
) {
  need(window && typeof window === 'object', 'CompleteSensorWindow required.');
  need(meta && typeof meta.recordingId === 'string' && meta.recordingId.length > 0, 'recordingId required.');

  const red = findChannel(window, SYNC_BUILDER_CHANNEL_IDS.red);
  const infrared = findChannel(window, SYNC_BUILDER_CHANNEL_IDS.infrared);
  need(red || infrared, 'Window must include ppg.red and/or ppg.infrared samples.');

  const ax = findChannel(window, SYNC_BUILDER_CHANNEL_IDS.ax);
  const ay = findChannel(window, SYNC_BUILDER_CHANNEL_IDS.ay);
  const az = findChannel(window, SYNC_BUILDER_CHANNEL_IDS.az);
  need(ax && ay && az, 'Window must include imu.ax, imu.ay, and imu.az samples.');
  need(
    ax.samples.length === ay.samples.length && ay.samples.length === az.samples.length,
    'Accelerometer channels must have equal length.',
  );

  const gx = findChannel(window, SYNC_BUILDER_CHANNEL_IDS.gx);
  const gy = findChannel(window, SYNC_BUILDER_CHANNEL_IDS.gy);
  const gz = findChannel(window, SYNC_BUILDER_CHANNEL_IDS.gz);
  const hasGyro = Boolean(gx && gy && gz);
  if (hasGyro) {
    need(
      gx!.samples.length === gy!.samples.length
      && gy!.samples.length === gz!.samples.length
      && gx!.samples.length === ax.samples.length,
      'Gyro channels must match accelerometer length when present.',
    );
  }

  const ppgPrimary = red ?? infrared!;
  const ppgRate = meta.ppgSampleRateHz ?? sampleRateHz(ppgPrimary, 100);
  const accelRate = meta.accelSampleRateHz ?? sampleRateHz(ax, 100);
  const gyroRate = meta.gyroSampleRateHz ?? (hasGyro ? sampleRateHz(gx, accelRate) : accelRate);

  if (red && infrared) {
    need(red.samples.length === infrared.samples.length, 'Red and infrared sample counts must match.');
  }
  const ppgCount = (red ?? infrared)!.samples.length;
  need(ppgCount >= 2, 'PPG stream needs at least 2 samples.');
  need(ax.samples.length >= 2, 'IMU stream needs at least 2 samples.');

  const provenance = meta.provenance ?? 'raw_adc';
  const adcMin = meta.adcMin === undefined ? 0 : meta.adcMin;
  const adcMax = meta.adcMax === undefined ? 1048575 : meta.adcMax;
  const captureStartedAt = meta.captureStartedAt
    ?? (window.acquisitionTime.kind === 'wall-clock'
      ? toUtcIso(window.acquisitionTime.timestampMs)
      : toUtcIso(window.firstReceivedAtMs));

  const ppgTimes = offsetsMs(ppgPrimary, ppgRate);
  const ppgSamples = [];
  for (let i = 0; i < ppgCount; i += 1) {
    const redVal = red ? red.samples[i]! : null;
    const irVal = infrared ? infrared.samples[i]! : null;
    ppgSamples.push([i, ppgTimes[i]!, redVal, irVal, 0]);
  }

  const imuTimes = offsetsMs(ax, accelRate);
  const imuSamples = [];
  for (let i = 0; i < ax.samples.length; i += 1) {
    imuSamples.push([
      i,
      imuTimes[i]!,
      ax.samples[i]!,
      ay.samples[i]!,
      az.samples[i]!,
      hasGyro ? gx!.samples[i]! : 0,
      hasGyro ? gy!.samples[i]! : 0,
      hasGyro ? gz!.samples[i]! : 0,
      0,
    ]);
  }

  const recording = {
    schemaVersion: 1,
    kind: syncContract.CONTRACT,
    recordingId: meta.recordingId,
    deviceId: meta.deviceId ?? window.identity.deviceId,
    sessionId: meta.sessionId ?? window.identity.acquisitionId,
    intervalId: meta.intervalId ?? window.identity.windowId,
    captureStartedAt,
    uploadedAt: null,
    ppg: {
      sampleRateHz: ppgRate,
      timingSource: 'sample_clock',
      channels: {
        red: {
          available: Boolean(red),
          wavelengthNm: meta.redWavelengthNm === undefined ? (red ? 660 : null) : meta.redWavelengthNm,
          units: red?.unit ?? 'adc_counts',
          provenance,
          adcMin,
          adcMax,
        },
        infrared: {
          available: Boolean(infrared),
          wavelengthNm: meta.infraredWavelengthNm === undefined ? (infrared ? 950 : null) : meta.infraredWavelengthNm,
          units: infrared?.unit ?? 'adc_counts',
          provenance,
          adcMin,
          adcMax,
        },
      },
      samples: ppgSamples,
    },
    imu: {
      accelSampleRateHz: accelRate,
      gyroSampleRateHz: gyroRate,
      accelUnits: 'm/s^2',
      gyroUnits: 'rad/s',
      timingSource: 'sample_clock',
      samples: imuSamples,
    },
    alignment: {
      clockDomain: 'device_monotonic',
      ppgImuToleranceMs: meta.ppgImuToleranceMs ?? 5,
      ppgEpochOffsetMs: 0,
      imuEpochOffsetMs: 0,
    },
    sensorSettings: {
      optical: {
        afe: 'AFE4404',
        emitter: 'SFH7050A',
        ledCurrentMa: null,
        gain: 'unconfirmed',
        site: 'wrist_unconfirmed',
      },
      imu: { model: 'BMI270', accelRangeG: null, gyroRangeDps: null },
      firmwareVersion: 'unconfirmed',
      builtFrom: 'CompleteSensorWindow',
    },
    transfer: {
      schemaVersion: 1,
      chunkCount: 1,
      chunkIndex: 0,
      payloadSha256: null,
      encoding: 'json_recording_v1',
    },
    qualityHints: {
      syntheticBuilder: true,
      packetCount: window.manifest.packetCount,
      channelIds: window.channels.map((ch) => ch.channelId),
    },
  };

  return syncContract.validateRecording(recording);
}
