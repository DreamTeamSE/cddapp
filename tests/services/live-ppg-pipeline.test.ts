import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LivePpgBuffer } from '../../services/measurement/livePpgBuffer.ts';
import { BleStreamService } from '../../services/device/bleStreamService.ts';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const core = require('../../services/anyppg/core.js');
const { standardizeWindow, applyHead } = core;
const fixture = require('../../assets/models/anyppg/synthetic_reference.json');
const head = require('../../assets/models/anyppg/ridge_head.json');

describe('Live PPG Streaming and Prediction Pipeline', () => {
  it('accumulates samples and enforces 30-second window readiness', () => {
    const buffer = new LivePpgBuffer();
    assert.equal(buffer.isReady(30), false);
    assert.equal(buffer.getLatestWindow('red'), null);

    // Add 10 seconds of samples at 50 Hz (20ms)
    for (let t = 0; t <= 10000; t += 20) {
      buffer.addSample({ timestampMs: t, redAC: Math.sin(t / 100), irAC: Math.cos(t / 100) });
    }
    assert.equal(buffer.isReady(30), false);
    assert.ok(buffer.durationSeconds >= 9.9);

    // Add another 25 seconds (total 35 seconds)
    for (let t = 10020; t <= 35000; t += 20) {
      buffer.addSample({ timestampMs: t, redAC: Math.sin(t / 100), irAC: Math.cos(t / 100) });
    }
    assert.equal(buffer.isReady(30), true);

    const redWindow = buffer.getLatestWindow('red', 30);
    assert.ok(redWindow instanceof Float32Array);
    assert.equal(redWindow?.length, 3750); // Exactly 3,750 points @ 125 Hz for AnyPPG

    const irWindow = buffer.getLatestWindow('infrared', 30);
    assert.ok(irWindow instanceof Float32Array);
    assert.equal(irWindow?.length, 3750);
  });

  it('standardizes buffered live windows and calculates valid AnyPPG SBP/DBP', () => {
    const buffer = new LivePpgBuffer(60000);

    // Feed rows from synthetic_reference (each row: [time_ms, redAC, irAC])
    for (const [timestampMs, redAC, irAC] of fixture.rows) {
      buffer.addSample({ timestampMs, redAC, irAC });
    }

    assert.equal(buffer.isReady(30), true);
    const redWindow = buffer.getLatestWindow('red', 30);
    assert.ok(redWindow);

    // Standardize the 3,750 samples through AnyPPG preprocessing
    const normalized = standardizeWindow(redWindow);
    assert.equal(normalized.length, 3750);
    assert.ok(normalized.every(Number.isFinite));

    // Test regression head on known fixture features
    const bp = applyHead(fixture.windows[0].features, head);
    assert.ok(Number.isFinite(bp[0]));
    assert.ok(Number.isFinite(bp[1]));
    assert.ok(bp[0] > 80 && bp[0] < 180, `SBP out of expected range: ${bp[0]}`);
    assert.ok(bp[1] > 40 && bp[1] < 120, `DBP out of expected range: ${bp[1]}`);
  });

  it('decodes packed 12-byte binary BLE notifications and ASCII lines', () => {
    const stream = new BleStreamService();
    const received: any[] = [];
    stream.subscribe({
      onSample(sample) {
        received.push(sample);
      },
    });

    // 1. Pack a 12-byte binary notification: [uint32: 2000, float32: 15.5, float32: 30.25]
    const buffer = new ArrayBuffer(12);
    const view = new DataView(buffer);
    view.setUint32(0, 2000, true);
    view.setFloat32(4, 15.5, true);
    view.setFloat32(8, 30.25, true);

    stream.handleNotificationBytes(new Uint8Array(buffer));
    assert.equal(received.length, 1);
    assert.equal(received[0].timestampMs, 2000);
    assert.ok(Math.abs(received[0].redAC - 15.5) < 1e-4);
    assert.ok(Math.abs(received[0].irAC - 30.25) < 1e-4);

    // 2. ASCII text fallback
    const ascii = new TextEncoder().encode('2020,16.0,31.0\n');
    stream.handleNotificationBytes(ascii);
    assert.equal(received.length, 2);
    assert.equal(received[1].timestampMs, 2020);
    assert.equal(received[1].redAC, 16.0);
    assert.equal(received[1].irAC, 31.0);
  });
});
