import type { SensorRecording } from './recordingCore';
import type { SerialRecording } from './serialCsv';
import type { SyncRecording } from './syncContract';
export async function pickRecording(): Promise<SensorRecording | SerialRecording | SyncRecording | null> {
  throw new Error('Use the installed iPhone app to choose a recording file, to inspect CSV or JSON.');
}
