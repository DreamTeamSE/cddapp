import type { SyncRecording } from './syncContract';

export const TARGET_HZ: 125;
export const WINDOW_SAMPLES: 3750;
export const MAX_INTERP_GAP_MS: number;

export type QualityAssessment = {
  schemaVersion: 1;
  preprocessingVersion: string;
  recordingId: string;
  intervalId: string;
  channel: 'red' | 'infrared';
  accepted: boolean;
  rejectionReasons: string[];
  motionRms: number | null;
  motionRmsMax: number;
  qualityLabel: 'accepted_for_anyppg_input' | 'rejected';
  bpAccuracyConfidence: null;
  hardwareValidated: false;
};

export type PreparedWindow = {
  assessment: QualityAssessment;
  preprocessingVersion: string;
  modelSamplingRateHz: number;
  channel: 'red' | 'infrared';
  samples: Float64Array;
  normalized: Float32Array;
  rawUnmodified: true;
};

export function assessRecordingQuality(
  input: SyncRecording,
  options?: { motionRmsMax?: number; channel?: 'red' | 'infrared' },
): QualityAssessment;

export function prepareAcceptedWindow(
  input: SyncRecording,
  options?: { motionRmsMax?: number; channel?: 'red' | 'infrared' },
): PreparedWindow;

export function channelValues(
  recording: SyncRecording,
  channel: 'red' | 'infrared',
): { t: number; v: number }[];

export function accelMotionRms(
  recording: SyncRecording,
  startMs: number,
  endMs: number,
  removeGravity?: boolean,
): { ok: boolean; rms: number | null; reason: string | null };

export function resampleToTarget(
  series: { t: number; v: number }[],
  targetHz: number,
  durationSeconds: number,
): Float64Array;
