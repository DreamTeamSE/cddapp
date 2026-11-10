/**
 * Scheduled acquisition state machine (issue #9).
 * Default period is 15 minutes. Firmware must persist the same states; this module is the shared contract.
 * 15-minute scheduling is a goal — not a hardware-verified feature.
 */

export type IntervalOutcome = 'scheduled' | 'collecting' | 'pending_processing' | 'pending_upload' | 'accepted' | 'missed' | 'failed';

export interface IntervalRecord {
  readonly intervalId: string;
  readonly plannedStartMs: number;
  readonly state: IntervalOutcome;
  readonly recordingId: string | null;
  readonly reason: string | null;
  readonly updatedAtMs: number;
}

export interface SchedulerConfig {
  readonly periodMs: number;
  readonly acquisitionDurationMs: number;
  readonly maxRetries: number;
  readonly searchWindowMs: number;
}

export const DEFAULT_SCHEDULER_CONFIG: SchedulerConfig = {
  periodMs: 15 * 60 * 1000,
  acquisitionDurationMs: 30 * 1000,
  maxRetries: 3,
  searchWindowMs: 5 * 60 * 1000,
};

function intervalIdFor(plannedStartMs: number): string {
  const iso = new Date(plannedStartMs).toISOString().replace(/[:.]/g, '');
  return `interval-${iso}`;
}

export class IntervalScheduler {
  private readonly config: SchedulerConfig;
  private readonly intervals = new Map<string, IntervalRecord>();
  private activeIntervalId: string | null = null;
  private anchorMs: number | null = null;

  constructor(config: SchedulerConfig = DEFAULT_SCHEDULER_CONFIG) {
    if (!Number.isFinite(config.periodMs) || config.periodMs <= 0) throw new RangeError('periodMs must be positive.');
    if (!Number.isInteger(config.maxRetries) || config.maxRetries < 0) throw new RangeError('maxRetries invalid.');
    this.config = config;
  }

  /** Anchor the schedule to a wall/device clock so delayed captures do not drift subsequent IDs. */
  anchor(nowMs: number): void {
    if (!Number.isFinite(nowMs)) throw new RangeError('nowMs must be finite.');
    this.anchorMs = nowMs - (nowMs % this.config.periodMs);
  }

  getConfig(): SchedulerConfig {
    return this.config;
  }

  listIntervals(): readonly IntervalRecord[] {
    return [...this.intervals.values()].sort((a, b) => a.plannedStartMs - b.plannedStartMs);
  }

  get(intervalId: string): IntervalRecord | null {
    return this.intervals.get(intervalId) ?? null;
  }

  ensureDue(nowMs: number): IntervalRecord {
    if (this.anchorMs === null) this.anchor(nowMs);
    const planned = this.anchorMs! + Math.floor((nowMs - this.anchorMs!) / this.config.periodMs) * this.config.periodMs;
    const intervalId = intervalIdFor(planned);
    const existing = this.intervals.get(intervalId);
    if (existing) return existing;
    const record: IntervalRecord = {
      intervalId,
      plannedStartMs: planned,
      state: 'scheduled',
      recordingId: null,
      reason: null,
      updatedAtMs: nowMs,
    };
    this.intervals.set(intervalId, record);
    return record;
  }

  beginCollection(intervalId: string, nowMs: number): IntervalRecord {
    const current = this.require(intervalId);
    if (this.activeIntervalId && this.activeIntervalId !== intervalId) {
      throw new Error('Overlapping capture jobs are prohibited.');
    }
    if (current.state !== 'scheduled' && current.state !== 'failed') {
      throw new Error(`Cannot collect from state ${current.state}.`);
    }
    if (nowMs - current.plannedStartMs > this.config.searchWindowMs) {
      return this.transition(intervalId, { state: 'missed', reason: 'search_window_exceeded', updatedAtMs: nowMs });
    }
    this.activeIntervalId = intervalId;
    return this.transition(intervalId, { state: 'collecting', reason: null, updatedAtMs: nowMs });
  }

  markPendingUpload(intervalId: string, recordingId: string, nowMs: number): IntervalRecord {
    this.require(intervalId);
    if (!recordingId.trim()) throw new Error('recordingId required.');
    this.activeIntervalId = null;
    return this.transition(intervalId, {
      state: 'pending_upload',
      recordingId,
      reason: 'captured_awaiting_upload',
      updatedAtMs: nowMs,
    });
  }

  markPendingProcessing(intervalId: string, nowMs: number): IntervalRecord {
    this.require(intervalId);
    return this.transition(intervalId, { state: 'pending_processing', reason: null, updatedAtMs: nowMs });
  }

  markAccepted(intervalId: string, nowMs: number): IntervalRecord {
    this.require(intervalId);
    this.activeIntervalId = null;
    return this.transition(intervalId, { state: 'accepted', reason: null, updatedAtMs: nowMs });
  }

  markFailed(intervalId: string, reason: string, nowMs: number): IntervalRecord {
    this.require(intervalId);
    this.activeIntervalId = null;
    return this.transition(intervalId, { state: 'failed', reason, updatedAtMs: nowMs });
  }

  markMissed(intervalId: string, reason: string, nowMs: number): IntervalRecord {
    this.require(intervalId);
    this.activeIntervalId = null;
    return this.transition(intervalId, { state: 'missed', reason, updatedAtMs: nowMs });
  }

  /** Restore persisted records after restart without duplicating interval IDs. */
  restore(records: readonly IntervalRecord[]): void {
    for (const record of records) {
      if (this.intervals.has(record.intervalId)) continue;
      this.intervals.set(record.intervalId, record);
      if (record.state === 'collecting') this.activeIntervalId = record.intervalId;
    }
  }

  private require(intervalId: string): IntervalRecord {
    const current = this.intervals.get(intervalId);
    if (!current) throw new Error(`Unknown interval ${intervalId}.`);
    return current;
  }

  private transition(intervalId: string, patch: Partial<IntervalRecord>): IntervalRecord {
    const current = this.require(intervalId);
    const next: IntervalRecord = { ...current, ...patch, intervalId: current.intervalId, plannedStartMs: current.plannedStartMs };
    this.intervals.set(intervalId, next);
    return next;
  }
}
