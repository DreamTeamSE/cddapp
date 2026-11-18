import type { SyncRecording } from '../recordings/syncContract';
import type { WatchInferenceReport } from './watchInference.native';

export type { WatchInferenceReport };

export function rejectSparkFunCsv(input: unknown): void {
  if (input && typeof input === 'object' && (input as { kind?: string }).kind === 'cdd_serial_csv_v1') {
    throw new Error('Legacy SparkFun CSV is not a synchronized PPG+IMU watch recording. Use the CSV AnyPPG card instead.');
  }
}

export async function inferWatchRecording(
  _recording: SyncRecording,
  _shouldCancel: () => boolean = () => false,
): Promise<WatchInferenceReport> {
  throw new Error('Watch inference needs the installed native app with ONNX Runtime. Use the iPhone development or Release build.');
}
