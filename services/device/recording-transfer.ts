/**
 * Reliable transfer helpers for synchronized recordings over BLE (issue #10).
 * Operates on already-decoded chunk envelopes matched to cdd_ppg_imu_recording_v1.
 * Wire UUID framing remains hardware-adapter territory.
 */

export const RECORDING_TRANSFER_CONTRACT = 'cdd_ppg_imu_recording_v1';

export type HashFn = (text: string) => string;

export interface RecordingChunkEnvelope {
  readonly recordingId: string;
  readonly schemaVersion: number;
  readonly contractVersion: string;
  readonly sequence: number;
  readonly totalChunks: number;
  readonly payload: string;
  readonly payloadSha256: string;
  readonly intervalId: string;
}

export type TransferStatus =
  | { readonly status: 'pending'; readonly received: number; readonly total: number }
  | { readonly status: 'duplicate_chunk' }
  | { readonly status: 'duplicate_recording'; readonly recordingId: string }
  | { readonly status: 'complete'; readonly recordingJson: string; readonly recordingId: string; readonly sha256: string }
  | { readonly status: 'rejected'; readonly reason: string };

export interface PersistedRecording {
  readonly recordingId: string;
  readonly intervalId: string;
  readonly recordingJson: string;
  readonly sha256: string;
  readonly receivedAtMs: number;
}

/** Portable FNV-1a 64-bit hex digest for integrity tests without Node crypto / RN native modules. */
export function fnv1aHex(text: string): string {
  let hash = 0xcbf29ce484222325n;
  const prime = 0x100000001b3n;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= BigInt(text.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn;
  }
  return hash.toString(16).padStart(16, '0');
}

export function encodeRecordingChunks(
  recordingJson: string,
  recordingId: string,
  intervalId: string,
  chunkSize = 1024,
  hashFn: HashFn = fnv1aHex,
): RecordingChunkEnvelope[] {
  if (!recordingJson || !recordingId || !intervalId) throw new Error('recordingJson, recordingId, and intervalId are required.');
  if (!Number.isInteger(chunkSize) || chunkSize <= 0) throw new RangeError('chunkSize must be a positive integer.');
  const totalChunks = Math.max(1, Math.ceil(recordingJson.length / chunkSize));
  const envelopes: RecordingChunkEnvelope[] = [];
  for (let sequence = 0; sequence < totalChunks; sequence += 1) {
    const payload = recordingJson.slice(sequence * chunkSize, (sequence + 1) * chunkSize);
    envelopes.push({
      recordingId,
      schemaVersion: 1,
      contractVersion: RECORDING_TRANSFER_CONTRACT,
      sequence,
      totalChunks,
      payload,
      payloadSha256: hashFn(payload),
      intervalId,
    });
  }
  return envelopes;
}

export class RecordingTransferAssembler {
  private readonly partial = new Map<string, { total: number; intervalId: string; chunks: Map<number, RecordingChunkEnvelope> }>();
  private readonly completed = new Map<string, PersistedRecording>();
  private readonly maxQueuedRecordings: number;
  private readonly hashFn: HashFn;

  constructor(maxQueuedRecordings = 8, hashFn: HashFn = fnv1aHex) {
    if (!Number.isInteger(maxQueuedRecordings) || maxQueuedRecordings <= 0) throw new RangeError('maxQueuedRecordings must be positive.');
    this.maxQueuedRecordings = maxQueuedRecordings;
    this.hashFn = hashFn;
  }

  accept(envelope: RecordingChunkEnvelope, nowMs = Date.now()): TransferStatus {
    if (envelope.contractVersion !== RECORDING_TRANSFER_CONTRACT) return { status: 'rejected', reason: 'incompatible_contract' };
    if (envelope.schemaVersion !== 1) return { status: 'rejected', reason: 'incompatible_schema_version' };
    if (!Number.isInteger(envelope.sequence) || envelope.sequence < 0 || envelope.sequence >= envelope.totalChunks) {
      return { status: 'rejected', reason: 'invalid_sequence' };
    }
    if (this.hashFn(envelope.payload) !== envelope.payloadSha256) return { status: 'rejected', reason: 'chunk_checksum_mismatch' };
    if (this.completed.has(envelope.recordingId)) return { status: 'duplicate_recording', recordingId: envelope.recordingId };

    let state = this.partial.get(envelope.recordingId);
    if (!state) {
      if (this.partial.size + this.completed.size >= this.maxQueuedRecordings) {
        return { status: 'rejected', reason: 'queue_capacity_exceeded' };
      }
      state = { total: envelope.totalChunks, intervalId: envelope.intervalId, chunks: new Map() };
      this.partial.set(envelope.recordingId, state);
    }
    if (state.total !== envelope.totalChunks || state.intervalId !== envelope.intervalId) {
      this.partial.delete(envelope.recordingId);
      return { status: 'rejected', reason: 'conflicting_envelope_metadata' };
    }
    const prior = state.chunks.get(envelope.sequence);
    if (prior) {
      if (prior.payload === envelope.payload && prior.payloadSha256 === envelope.payloadSha256) return { status: 'duplicate_chunk' };
      this.partial.delete(envelope.recordingId);
      return { status: 'rejected', reason: 'conflicting_chunk' };
    }
    state.chunks.set(envelope.sequence, envelope);
    if (state.chunks.size !== state.total) return { status: 'pending', received: state.chunks.size, total: state.total };

    const ordered = [...state.chunks.entries()].sort((a, b) => a[0] - b[0]).map(([, chunk]) => chunk.payload);
    const recordingJson = ordered.join('');
    const sha256 = this.hashFn(recordingJson);
    this.partial.delete(envelope.recordingId);
    this.completed.set(envelope.recordingId, {
      recordingId: envelope.recordingId,
      intervalId: envelope.intervalId,
      recordingJson,
      sha256,
      receivedAtMs: nowMs,
    });
    return { status: 'complete', recordingJson, recordingId: envelope.recordingId, sha256 };
  }

  getCompleted(recordingId: string): PersistedRecording | null {
    return this.completed.get(recordingId) ?? null;
  }

  listCompleted(): readonly PersistedRecording[] {
    return [...this.completed.values()];
  }

  /** Acknowledge only after local persistence of a complete integrity-verified recording. */
  acknowledge(recordingId: string): boolean {
    return this.completed.has(recordingId);
  }
}
