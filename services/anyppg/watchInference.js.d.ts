export function rejectSparkFunCsv(input: unknown): void;
export function runWatchRecording(
  input: unknown,
  options: {
    createAdapter: () => Promise<{ run: (normalized: Float32Array) => Promise<{ features: Float32Array; inferenceMs: number }>; release: () => Promise<void> }>;
    shouldCancel?: () => boolean;
    channel?: 'red' | 'infrared';
    motionRmsMax?: number;
    head?: unknown;
    modelSha256?: string;
  },
): Promise<Record<string, unknown>>;
