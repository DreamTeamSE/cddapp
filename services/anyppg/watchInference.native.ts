import { Asset } from 'expo-asset';
import { Platform } from 'react-native';
import { createAdapter } from './ort';
import type { SyncRecording } from '../recordings/syncContract';

const head = require('../../assets/models/anyppg/ridge_head.json');
const manifest = require('../../assets/models/anyppg/manifest.json');
const { runWatchRecording, rejectSparkFunCsv } = require('./watchInference');

export { rejectSparkFunCsv };

export type WatchInferenceReport = {
  status: 'accepted' | 'rejected' | 'error';
  qualityDecision: string;
  recordingId: string;
  intervalId: string;
  ppgSampleRateHz: number;
  modelId: string;
  preprocessingVersion: string;
  processingMs: number;
  sbp?: number;
  dbp?: number;
  rejectionReasons?: string[];
  error?: string | null;
  experimental: true;
  [key: string]: unknown;
};

export async function inferWatchRecording(
  recording: SyncRecording,
  shouldCancel: () => boolean = () => false,
): Promise<WatchInferenceReport> {
  const report = await runWatchRecording(recording, {
    head,
    modelSha256: manifest.modelSha256,
    shouldCancel,
    createAdapter: async () => {
      // Metro requires a static asset path for the native model.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const asset = Asset.fromModule(require('../../assets/models/anyppg/anyppg_encoder.onnx'));
      await asset.downloadAsync();
      if (!asset.localUri) throw new Error('Bundled AnyPPG model is unavailable. Rebuild the Release app.');
      return createAdapter({ ort: await import('onnxruntime-react-native'), uri: asset.localUri });
    },
  });
  return {
    ...report,
    platform: Platform.OS,
    osVersion: String(Platform.Version),
    developmentBuild: __DEV__,
    onnxRuntimeVersion: '1.24.3',
    executionLocation: 'native_app',
    modelSha256: manifest.modelSha256,
  };
}
