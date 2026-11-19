import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createPersistedEstimateHistory,
  createSqliteEstimateHistory,
} from '../../services/readings/sqlite-estimate-history.ts';
import { openMemorySqlite } from '../support/node-sqlite.ts';

const BASE = {
  captureStartedAt: '2026-11-09T17:00:00.000Z',
  preprocessingVersion: 'anyppg_watch_prep_v1',
  qualityStatus: 'accepted' as const,
  sourceKind: 'watch_live' as const,
  channel: 'red' as const,
};

describe('SQLite prototype estimate history (#26)', () => {
  it('saves estimates, reloads after reopen, and never fabricates missed BP', async () => {
    const db = openMemorySqlite();
    const store = await createSqliteEstimateHistory(db);

    const first = await store.saveEstimate({
      ...BASE,
      recordingId: 'rec-1',
      intervalId: 'interval-1',
      sbp: 118.5,
      dbp: 76.2,
      modelHash: 'abc',
      signalProvenance: 'raw_adc',
    });
    const again = await store.saveEstimate({
      ...BASE,
      recordingId: 'rec-1',
      intervalId: 'interval-1',
      sbp: 999,
      dbp: 999,
    });
    assert.equal(first.sbp, again.sbp);
    assert.equal((await store.listEstimates()).length, 1);

    const missed = await store.markMissed('interval-2', 'high_motion');
    assert.equal(missed.state, 'missed');
    assert.equal(missed.estimateId, null);
    assert.equal((await store.listEstimates()).length, 1);
    assert.equal(await store.getEstimate('interval-2:red'), null);

    // Simulate relaunch: new store handle on the same DB file contents.
    const reloaded = await createSqliteEstimateHistory(db);
    assert.equal((await reloaded.listEstimates()).length, 1);
    assert.equal((await reloaded.getEstimate('rec-1:red'))?.sbp, 118.5);
    assert.equal((await reloaded.getInterval('interval-2'))?.state, 'missed');
    assert.equal((await reloaded.getInterval('interval-2'))?.estimateId, null);
    db.close();
  });

  it('hydrates a sync in-memory history and dual-writes through createPersistedEstimateHistory', async () => {
    const db = openMemorySqlite();
    const first = await createPersistedEstimateHistory(db);
    first.saveEstimate({
      ...BASE,
      recordingId: 'rec-persist',
      intervalId: 'iv-persist',
      sbp: 120,
      dbp: 80,
    });
    first.markMissed('iv-gap', 'no_upload');
    await first.flush();

    const second = await createPersistedEstimateHistory(db);
    assert.equal(second.listEstimates().length, 1);
    assert.equal(second.getEstimate('rec-persist:red')?.dbp, 80);
    assert.equal(second.getInterval('iv-gap')?.state, 'missed');
    assert.equal(second.listEstimates().some((e) => e.intervalId === 'iv-gap'), false);
    db.close();
  });
});
