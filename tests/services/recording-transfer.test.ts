import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { encodeRecordingChunks, RecordingTransferAssembler } from '../../services/device/recording-transfer.ts';

const fixture = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/sync-recordings/valid.json'),
  'utf8',
);

test('reassembles chunked recordings with retry, dedup, and integrity checks', () => {
  const chunks = encodeRecordingChunks(fixture, 'sync-demo-001', 'interval-20261109T170000Z', 200);
  assert.ok(chunks.length >= 2);
  const assembler = new RecordingTransferAssembler();

  const first = assembler.accept(chunks[0]!);
  assert.equal(first.status, 'pending');

  // Out-of-order: deliver last before middle
  const last = assembler.accept(chunks[chunks.length - 1]!);
  assert.equal(last.status, 'pending');

  // Duplicate exact chunk
  assert.equal(assembler.accept(chunks[0]!).status, 'duplicate_chunk');

  // Corrupt checksum
  const corrupt = { ...chunks[1]!, payloadSha256: '0'.repeat(16) };
  assert.equal(assembler.accept(corrupt).status, 'rejected');

  // Fresh assembler for a clean complete transfer after corruption invalidated partial state? 
  // Conflicting/corrupt path deletes recording only on conflicting chunk; checksum reject leaves state.
  // Complete the remaining valid chunks on this assembler:
  let completeJson: string | null = null;
  let completeId: string | null = null;
  for (let i = 1; i < chunks.length; i += 1) {
    const result = assembler.accept(chunks[i]!);
    if (result.status === 'complete') {
      completeJson = result.recordingJson;
      completeId = result.recordingId;
    }
  }
  assert.equal(completeJson, fixture);
  assert.equal(typeof completeId, 'string');
  assert.equal(assembler.acknowledge(completeId as string), true);
  assert.equal(assembler.accept(chunks[0]!).status, 'duplicate_recording');
});

test('rejects incompatible contract versions', () => {
  const assembler = new RecordingTransferAssembler();
  const [chunk] = encodeRecordingChunks('{"ok":true}', 'r1', 'i1', 1024);
  const bad = { ...chunk!, contractVersion: 'other' };
  assert.equal(assembler.accept(bad).status, 'rejected');
});
