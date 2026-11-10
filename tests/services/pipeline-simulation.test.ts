import assert from 'node:assert/strict';
import test from 'node:test';
import { createPipelineSimulator } from '../../services/device/pipeline-simulation.ts';

test('pipeline simulation advances injectable clock and does not claim live BLE/background', () => {
  const sim = createPipelineSimulator();
  const start = sim.clock.nowMs();
  const ok = sim.simulateSuccessfulCapture();
  assert.equal(ok.type, 'capture_success');
  assert.equal(ok.transferComplete, true);
  assert.ok(sim.clock.nowMs() > start);

  const report = sim.runScriptedDemo();
  assert.equal(report.mode, 'foreground_simulation');
  assert.equal(report.liveBleValidated, false);
  assert.equal(report.backgroundExecutionValidated, false);
  assert.equal(report.watchFirmwareSchedulingValidated, false);
  assert.ok(report.events.length >= 5);
  assert.ok(report.intervals.length >= 1);
});

test('interrupted BLE then retry completes and detects duplicate packets', () => {
  const sim = createPipelineSimulator({ startMs: Date.parse('2026-11-09T19:00:00.000Z') });
  const result = sim.simulateInterruptedBleThenRetry();
  assert.equal(result.type, 'ble_retry_complete');
  assert.equal(result.complete, true);
  assert.equal(result.duplicateRecording, true);
});
