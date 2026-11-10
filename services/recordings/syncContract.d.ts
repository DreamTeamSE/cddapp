export const CONTRACT: 'cdd_ppg_imu_recording_v1';
export const PREPROCESSING_VERSION: 'anyppg_watch_prep_v1';
export const MAX_FILE_BYTES: number;
export const MAX_PPG_SAMPLES: number;
export const MAX_IMU_SAMPLES: number;

export type PpgProvenance = 'raw_adc' | 'firmware_filtered';
export type SyncChannel = {
  available: boolean;
  wavelengthNm: number | null;
  units: string;
  provenance: PpgProvenance;
  adcMin: number | null;
  adcMax: number | null;
};

export type SyncRecording = {
  schemaVersion: 1;
  kind: typeof CONTRACT;
  recordingId: string;
  deviceId: string;
  sessionId: string;
  intervalId: string;
  captureStartedAt: string;
  uploadedAt: string | null;
  ppg: {
    sampleRateHz: number;
    timingSource: 'sensor' | 'sample_clock';
    channels: { red: SyncChannel; infrared: SyncChannel };
    samples: [number, number, number | null, number | null, 0 | 1][];
  };
  imu: {
    accelSampleRateHz: number;
    gyroSampleRateHz: number;
    accelUnits: 'm/s^2';
    gyroUnits: 'rad/s';
    timingSource: 'sensor' | 'sample_clock';
    samples: [number, number, number | null, number | null, number | null, number | null, number | null, number | null, 0 | 1][];
  };
  alignment: {
    clockDomain: 'device_monotonic';
    ppgImuToleranceMs: number;
    ppgEpochOffsetMs: number;
    imuEpochOffsetMs: number;
  };
  sensorSettings: Record<string, unknown>;
  transfer: {
    schemaVersion: 1;
    chunkCount: number;
    chunkIndex: number;
    payloadSha256: string | null;
    encoding: 'json_recording_v1';
  };
  qualityHints?: Record<string, unknown>;
};

export type SyncInspection = {
  schemaVersion: 1;
  contract: string;
  preprocessingVersion: string;
  recordingId: string;
  deviceId: string;
  sessionId: string;
  intervalId: string;
  ppgSampleRateHz: number;
  accelSampleRateHz: number;
  gyroSampleRateHz: number;
  ppg: { missing: number; duplicate: number; order: number; nonIncreasing: number; declaredMissing: number; count: number };
  imu: { missing: number; duplicate: number; order: number; nonIncreasing: number; declaredMissing: number; count: number };
  alignmentOk: boolean;
  schemaAccepted: boolean;
  blockers: string[];
  warnings: string[];
  hardwareValidated: false;
  modelInferenceRun: false;
};

export function validateRecording(value: unknown): SyncRecording;
export function parseSyncRecordingJson(json: string): SyncRecording;
export function inspectSyncRecording(recording: SyncRecording): SyncInspection;
export function makeDemoSyncRecording(overrides?: Record<string, unknown>): SyncRecording;
