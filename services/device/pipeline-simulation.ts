/**
 * Foreground simulation of interval scheduling + BLE transfer (#9/#10).
 * Injectable clock — does not wait real 15 minutes. Not iOS background or live BLE validation.
 * Metro/React Native compatible (no node:module).
 */
import { IntervalScheduler, DEFAULT_SCHEDULER_CONFIG, type SchedulerConfig } from '../measurement/interval-scheduler.ts';
import { encodeRecordingChunks, RecordingTransferAssembler } from './recording-transfer.ts';
import { makeDemoSyncRecording } from '../recordings/syncContract.js';
import { history } from '../anyppg/sessionHistory.js';

export function createClock(startMs = Date.parse('2026-11-09T17:00:00.000Z')) {
  let now = startMs;
  return {
    nowMs: () => now,
    advanceMs: (delta: number) => {
      now += delta;
      return now;
    },
    setMs: (value: number) => {
      now = value;
      return now;
    },
  };
}

export function createPipelineSimulator(options: {
  clock?: ReturnType<typeof createClock>;
  startMs?: number;
  schedulerConfig?: SchedulerConfig;
  maxQueuedRecordings?: number;
} = {}) {
  const clock = options.clock || createClock(options.startMs);
  const scheduler = new IntervalScheduler(options.schedulerConfig || DEFAULT_SCHEDULER_CONFIG);
  const transfer = new RecordingTransferAssembler(options.maxQueuedRecordings || 8);
  const events: Array<Record<string, unknown>> = [];

  function log(type: string, detail: Record<string, unknown> = {}): Record<string, unknown> {
    const entry: Record<string, unknown> = { type, atMs: clock.nowMs(), ...detail };
    events.push(entry);
    return entry;
  }

  function ensureInterval() {
    return scheduler.ensureDue(clock.nowMs());
  }

  /** Skip periods whose interval is already terminal so scripted demos can re-run on one simulator. */
  function ensureFreshInterval() {
    let interval = ensureInterval();
    let guard = 0;
    while (interval.state !== 'scheduled' && interval.state !== 'failed' && guard < 8) {
      clock.advanceMs(DEFAULT_SCHEDULER_CONFIG.periodMs);
      interval = ensureInterval();
      guard += 1;
    }
    if (interval.state !== 'scheduled' && interval.state !== 'failed') {
      throw new Error(`Unable to allocate a fresh scheduled interval (state=${interval.state}).`);
    }
    return interval;
  }

  function simulateSuccessfulCapture() {
    const interval = ensureFreshInterval();
    scheduler.beginCollection(interval.intervalId, clock.nowMs());
    clock.advanceMs(30_000);
    const recording = makeDemoSyncRecording({
      seconds: 32,
      motion: 'low',
      recordingId: `sim-ok-${interval.intervalId}`,
      intervalId: interval.intervalId,
      captureStartedAt: new Date(clock.nowMs() - 30_000).toISOString(),
    });
    scheduler.markPendingUpload(interval.intervalId, recording.recordingId, clock.nowMs());
    const json = JSON.stringify(recording);
    const chunks = encodeRecordingChunks(json, recording.recordingId, recording.intervalId, 800);
    let complete: { status: string } | null = null;
    for (const chunk of chunks) {
      const status = transfer.accept(chunk, clock.nowMs());
      if (status.status === 'complete') complete = status;
    }
    scheduler.markPendingProcessing(interval.intervalId, clock.nowMs());
    scheduler.markAccepted(interval.intervalId, clock.nowMs());
    return log('capture_success', {
      intervalId: interval.intervalId,
      recordingId: recording.recordingId,
      chunkCount: chunks.length,
      transferComplete: complete?.status === 'complete',
      intervalState: scheduler.get(interval.intervalId)?.state,
    });
  }

  function simulateExcessiveMotion() {
    const interval = ensureFreshInterval();
    scheduler.beginCollection(interval.intervalId, clock.nowMs());
    clock.advanceMs(10_000);
    scheduler.markMissed(interval.intervalId, 'imu:high_motion', clock.nowMs());
    history.markMissed(interval.intervalId, 'imu:high_motion', clock.nowMs());
    return log('capture_missed_motion', {
      intervalId: interval.intervalId,
      intervalState: scheduler.get(interval.intervalId)?.state,
      historyState: history.getInterval(interval.intervalId)?.state,
    });
  }

  function simulateMissedWindow() {
    const interval = ensureFreshInterval();
    clock.advanceMs(DEFAULT_SCHEDULER_CONFIG.searchWindowMs + 1);
    const missed = scheduler.beginCollection(interval.intervalId, clock.nowMs());
    if (missed.state !== 'missed') scheduler.markMissed(interval.intervalId, 'search_window_exceeded', clock.nowMs());
    history.markMissed(interval.intervalId, 'search_window_exceeded', clock.nowMs());
    return log('capture_missed_timeout', {
      intervalId: interval.intervalId,
      intervalState: scheduler.get(interval.intervalId)?.state,
    });
  }

  function simulateInterruptedBleThenRetry() {
    const interval = ensureFreshInterval();
    scheduler.beginCollection(interval.intervalId, clock.nowMs());
    const recording = makeDemoSyncRecording({
      seconds: 3,
      recordingId: `sim-ble-${interval.intervalId}`,
      intervalId: interval.intervalId,
    });
    scheduler.markPendingUpload(interval.intervalId, recording.recordingId, clock.nowMs());
    const chunks = encodeRecordingChunks(JSON.stringify(recording), recording.recordingId, recording.intervalId, 200);
    const partial = transfer.accept(chunks[0]!, clock.nowMs());
    log('ble_interrupted', {
      intervalId: interval.intervalId,
      status: partial.status,
      received: 'received' in partial ? partial.received : null,
      total: 'total' in partial ? partial.total : null,
    });
    let complete: { status: string } | null = null;
    for (const chunk of chunks) {
      const status = transfer.accept(chunk, clock.nowMs());
      if (status.status === 'complete') complete = status;
      if (status.status === 'duplicate_chunk') log('ble_duplicate_chunk', { sequence: chunk.sequence });
    }
    const dup = transfer.accept(chunks[0]!, clock.nowMs());
    scheduler.markAccepted(interval.intervalId, clock.nowMs());
    return log('ble_retry_complete', {
      intervalId: interval.intervalId,
      complete: complete?.status === 'complete',
      duplicateRecording: dup.status === 'duplicate_recording',
      intervalState: scheduler.get(interval.intervalId)?.state,
    });
  }

  function simulateAppRestart() {
    const snapshot = scheduler.listIntervals();
    const restored = new IntervalScheduler(options.schedulerConfig || DEFAULT_SCHEDULER_CONFIG);
    restored.restore(snapshot);
    return log('app_restart_restored', {
      restoredCount: restored.listIntervals().length,
      states: restored.listIntervals().map((item) => ({ intervalId: item.intervalId, state: item.state })),
    });
  }

  function advanceOnePeriod() {
    clock.advanceMs(DEFAULT_SCHEDULER_CONFIG.periodMs);
    return log('clock_advanced_period', { nowMs: clock.nowMs(), next: ensureInterval() });
  }

  function runScriptedDemo() {
    const results = [
      simulateSuccessfulCapture(),
      advanceOnePeriod(),
      simulateExcessiveMotion(),
      advanceOnePeriod(),
      simulateInterruptedBleThenRetry(),
      advanceOnePeriod(),
      simulateMissedWindow(),
      simulateAppRestart(),
    ];
    return {
      schemaVersion: 1,
      mode: 'foreground_simulation',
      backgroundExecutionValidated: false,
      liveBleValidated: false,
      watchFirmwareSchedulingValidated: false,
      events: results,
      allEvents: events.slice(),
      intervals: scheduler.listIntervals(),
      historyIntervals: history.listIntervals(),
    };
  }

  return {
    clock,
    scheduler,
    transfer,
    events,
    ensureInterval,
    simulateSuccessfulCapture,
    simulateExcessiveMotion,
    simulateMissedWindow,
    simulateInterruptedBleThenRetry,
    simulateAppRestart,
    advanceOnePeriod,
    runScriptedDemo,
  };
}

export const DEFAULT_PERIOD_MS = DEFAULT_SCHEDULER_CONFIG.periodMs;
