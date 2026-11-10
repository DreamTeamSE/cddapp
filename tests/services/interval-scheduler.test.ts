import assert from 'node:assert/strict';
import test from 'node:test';
import { IntervalScheduler } from '../../services/measurement/interval-scheduler.ts';

test('anchors 15-minute intervals and prohibits overlapping collection', () => {
  const scheduler = new IntervalScheduler();
  const t0 = Date.parse('2026-11-09T17:00:00.000Z');
  scheduler.anchor(t0);
  const due = scheduler.ensureDue(t0 + 1000);
  assert.equal(due.state, 'scheduled');
  assert.match(due.intervalId, /^interval-/);

  const collecting = scheduler.beginCollection(due.intervalId, t0 + 2000);
  assert.equal(collecting.state, 'collecting');

  const next = scheduler.ensureDue(t0 + 15 * 60 * 1000 + 500);
  assert.notEqual(next.intervalId, due.intervalId);
  assert.throws(() => scheduler.beginCollection(next.intervalId, t0 + 15 * 60 * 1000 + 1000), /Overlapping/);

  scheduler.markPendingUpload(due.intervalId, 'rec-1', t0 + 3000);
  assert.equal(scheduler.get(due.intervalId)?.state, 'pending_upload');
  scheduler.beginCollection(next.intervalId, t0 + 15 * 60 * 1000 + 2000);
  scheduler.markAccepted(next.intervalId, t0 + 15 * 60 * 1000 + 5000);
  assert.equal(scheduler.get(next.intervalId)?.state, 'accepted');
});

test('restore skips duplicate interval IDs and preserves auditable outcomes', () => {
  const scheduler = new IntervalScheduler();
  const record = {
    intervalId: 'interval-demo',
    plannedStartMs: 1,
    state: 'missed' as const,
    recordingId: null,
    reason: 'search_window_exceeded',
    updatedAtMs: 2,
  };
  scheduler.restore([record, record]);
  assert.equal(scheduler.listIntervals().length, 1);
  assert.equal(scheduler.get('interval-demo')?.state, 'missed');
});
