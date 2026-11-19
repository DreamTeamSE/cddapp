/**
 * Software composition for roadmap issues #7–#12.
 * Firmware/BLE hardware adapters remain separate; this module is the phone-side glue.
 */
import { createRequire } from 'node:module';

import type { CompleteSensorWindow } from '../../types/measurement.ts';
import {
  buildSyncRecordingFromCompleteWindow,
  type SyncBuilderMeta,
} from '../device/sync-recording-builder.ts';
import {
  encodeRecordingChunks,
  RecordingTransferAssembler,
  RECORDING_TRANSFER_CONTRACT,
  type RecordingChunkEnvelope,
  type TransferStatus,
} from '../device/recording-transfer.ts';
import { IntervalScheduler, DEFAULT_SCHEDULER_CONFIG, type SchedulerConfig } from './interval-scheduler.ts';

const require = createRequire(import.meta.url);
const syncContract = require('../recordings/syncContract.js') as typeof import('../recordings/syncContract');
const qualityGate = require('../recordings/qualityGate.js') as typeof import('../recordings/qualityGate');
const motionSelection = require('../device/motion-selection.js') as typeof import('../device/motion-selection');
const estimateHistory = require('../readings/estimate-history.js') as typeof import('../readings/estimate-history');
const motionTrigger = require('../device/motion-trigger.js') as typeof import('../device/motion-trigger');
const imuDenoise = require('../device/imu-denoise.js') as typeof import('../device/imu-denoise');

export function createPrototypePipeline(options: {
  schedulerConfig?: SchedulerConfig;
  maxQueuedRecordings?: number;
  history?: { modelId?: string };
} = {}) {
  const scheduler = new IntervalScheduler(options.schedulerConfig ?? DEFAULT_SCHEDULER_CONFIG);
  const transfer = new RecordingTransferAssembler(options.maxQueuedRecordings ?? 8);
  const history = estimateHistory.createEstimateHistory(options.history);
  return {
    contract: syncContract.CONTRACT,
    transferContract: RECORDING_TRANSFER_CONTRACT,
    preprocessingVersion: syncContract.PREPROCESSING_VERSION,
    scheduler,
    transfer,
    history,
    motionTrigger: motionTrigger.getMotionTriggerConfig(),
    imuDenoise: imuDenoise.getImuDenoiseConfig(),
    /** Reassembled BLE window → validated sync JSON (issue #27 phone glue). */
    buildFromCompleteWindow(window: CompleteSensorWindow, meta: SyncBuilderMeta) {
      return buildSyncRecordingFromCompleteWindow(window, meta);
    },
    inspect(recording: unknown) {
      return syncContract.inspectSyncRecording(syncContract.validateRecording(recording));
    },
    selectMotion(imuSamples: Parameters<typeof motionSelection.selectLowMotionSegments>[0], motionOptions?: Parameters<typeof motionSelection.selectLowMotionSegments>[1]) {
      return motionSelection.selectLowMotionSegments(imuSamples, motionOptions);
    },
    assess(recording: unknown, qualityOptions?: Parameters<typeof qualityGate.assessRecordingQuality>[1]) {
      return qualityGate.assessRecordingQuality(syncContract.validateRecording(recording), qualityOptions);
    },
    prepare(recording: unknown, qualityOptions?: Parameters<typeof qualityGate.prepareAcceptedWindow>[1]) {
      const validated = syncContract.validateRecording(recording);
      const denoise = imuDenoise.maybeDenoisePpg(
        validated.ppg.samples.map((row) => row[2]),
        validated.imu.samples,
        imuDenoise.getImuDenoiseConfig(),
      );
      if (denoise.applied) throw new Error('IMU denoise must remain disabled until #15 evaluation.');
      return qualityGate.prepareAcceptedWindow(validated, qualityOptions);
    },
    encodeForBle(recordingJson: string, recordingId: string, intervalId: string, chunkSize?: number) {
      return encodeRecordingChunks(recordingJson, recordingId, intervalId, chunkSize);
    },
    acceptBleChunk(envelope: RecordingChunkEnvelope, nowMs?: number): TransferStatus {
      return transfer.accept(envelope, nowMs);
    },
    /**
     * Quality-gated AnyPPG watch path. Pass createAdapter + head from the host/native layer.
     * Does not fabricate BP when quality rejects.
     */
    async runWatch(
      input: unknown,
      watchOptions: {
        createAdapter: () => Promise<{ run: (normalized: Float32Array) => Promise<{ features: Float32Array; inferenceMs: number }>; release: () => Promise<void> }>;
        head: unknown;
        modelSha256?: string | null;
        channel?: 'red' | 'infrared';
        motionRmsMax?: number;
        shouldCancel?: () => boolean;
      },
    ) {
      // Host/Node uses watchInference.js; Metro resolves the .native.ts shim separately.
      const watchInference = require('../anyppg/watchInference.js') as {
        runWatchRecording: (input: unknown, options: typeof watchOptions) => Promise<Record<string, unknown>>;
      };
      return watchInference.runWatchRecording(input, watchOptions);
    },
  };
}

export { RECORDING_TRANSFER_CONTRACT };
