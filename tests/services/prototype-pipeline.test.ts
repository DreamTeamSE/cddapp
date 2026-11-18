import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrototypePipeline } from '../../services/measurement/prototype-pipeline.ts';

const fixture = JSON.parse(
  readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '../fixtures/sync-recordings/valid.json'), 'utf8'),
);

test('prototype pipeline composes sync contract, transfer, scheduler, and disabled experiments', () => {
  const pipeline = createPrototypePipeline();
  const inspection = pipeline.inspect(fixture);
  assert.equal(inspection.contract, 'cdd_ppg_imu_recording_v1');
  assert.equal(pipeline.motionTrigger.enabled, false);
  assert.equal(pipeline.imuDenoise.enabled, false);
  const chunks = pipeline.encodeForBle(JSON.stringify(fixture), fixture.recordingId, fixture.intervalId, 400);
  let complete = false;
  for (const chunk of chunks) {
    if (pipeline.acceptBleChunk(chunk).status === 'complete') complete = true;
  }
  assert.equal(complete, true);
  assert.equal(pipeline.scheduler.ensureDue(Date.parse(fixture.captureStartedAt)).state, 'scheduled');
});
