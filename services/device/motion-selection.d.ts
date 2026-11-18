export type MotionCandidate = {
  startMs: number;
  endMs: number;
  motionRms: number;
  sampleCount: number;
  gravityRemoved: boolean;
  rejectionReason: null;
};

export type MotionSelectionResult = {
  schemaVersion: 1;
  windowDurationSec: number;
  motionRmsMax: number;
  maxCandidates: number;
  selected: MotionCandidate[];
  rejectedCount: number;
  allBad: boolean;
  hardwareValidated: false;
};

export function selectLowMotionSegments(
  imuSamples: Array<[number, number, number | null, number | null, number | null, number | null, number | null, number | null, 0 | 1]>,
  options?: {
    windowDurationSec?: number;
    stepSec?: number;
    motionRmsMax?: number;
    maxCandidates?: number;
    gravityRemoved?: boolean;
  },
): MotionSelectionResult;
