export type EstimateSourceKind = 'watch_live' | 'imported_csv';
export type IntervalHistoryState = 'pending' | 'pending_upload' | 'pending_processing' | 'accepted' | 'missed' | 'failed';

export type PrototypeEstimate = {
  id: string;
  recordingId: string;
  intervalId: string;
  captureStartedAt: string;
  sbp: number;
  dbp: number;
  unit: 'mmHg';
  channel: 'red' | 'infrared';
  modelId: string;
  modelHash: string | null;
  preprocessingVersion: string;
  qualityStatus: 'accepted';
  calibrationStatus: string;
  sourceKind: EstimateSourceKind;
  experimental: true;
  prototypeLabel: 'experimental_prototype_estimate';
  createdAtMs: number;
};

export type IntervalHistoryRecord = {
  intervalId: string;
  state: IntervalHistoryState;
  reason: string | null;
  updatedAtMs: number;
  estimateId: string | null;
};

export type EstimateHistory = {
  saveEstimate: (input: {
    recordingId: string;
    intervalId: string;
    captureStartedAt: string;
    sbp: number;
    dbp: number;
    channel: 'red' | 'infrared';
    modelHash?: string | null;
    preprocessingVersion: string;
    qualityStatus: 'accepted' | 'rejected';
    calibrationStatus?: string;
    sourceKind: EstimateSourceKind;
  }) => PrototypeEstimate;
  markMissed: (intervalId: string, reason: string, nowMs?: number) => IntervalHistoryRecord;
  markFailed: (intervalId: string, reason: string, nowMs?: number) => IntervalHistoryRecord;
  upsertInterval: (intervalId: string, state: IntervalHistoryState, reason?: string | null, nowMs?: number) => IntervalHistoryRecord;
  getEstimate: (id: string) => PrototypeEstimate | null;
  listEstimates: () => PrototypeEstimate[];
  listIntervals: () => IntervalHistoryRecord[];
  getInterval: (intervalId: string) => IntervalHistoryRecord | null;
};

export function createEstimateHistory(options?: { modelId?: string }): EstimateHistory;
