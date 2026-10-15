import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { createAwsSyncService } from '../../services/sync/aws-sync-service.ts';
import { createSqlitePpgCache, migratePpgCache } from '../../services/sync/sqlite-ppg-cache.ts';
import { openMemorySqlite } from '../support/node-sqlite.ts';

const HOUR = 60 * 60 * 1000;
const NOW = 100 * HOUR;

async function setup(userId = 'user-a', db = openMemorySqlite()) {
  await migratePpgCache(db);
  let clock = NOW;
  const cache = createSqlitePpgCache(db, { userId, nowMs: () => clock, maxSamplesPerWindow: 10 });
  return { db, cache, setClock: (ms: number) => { clock = ms; } };
}

describe('SQLite rolling PPG cache', () => {
  it('stores windows and lists them oldest first within timestamp bounds', async () => {
    const { cache } = await setup();
    await cache.append({ id: 'w2', recordedAtMs: NOW - 2 * HOUR, values: [0.2] });
    await cache.append({ id: 'w1', recordedAtMs: NOW - 3 * HOUR, values: [0.1, 0.15] });
    await cache.append({ id: 'w3', recordedAtMs: NOW - 1 * HOUR, values: [0.3] });
    const sinceTwoHours = await cache.listSince(NOW - 2 * HOUR);
    assert.deepEqual(sinceTwoHours.map((window) => window.id), ['w2', 'w3']); // boundary is inclusive
    assert.deepEqual((await cache.listSince(0))[0], { id: 'w1', recordedAtMs: NOW - 3 * HOUR, values: [0.1, 0.15] });
  });

  it('ignores a re-sent window instead of duplicating it', async () => {
    const { cache } = await setup();
    await cache.append({ id: 'w1', recordedAtMs: NOW, values: [0.1] });
    await cache.append({ id: 'w1', recordedAtMs: NOW, values: [0.1] });
    assert.equal(await cache.countPending(), 1);
  });

  it('returns pending windows FIFO and tracks pending → synced / failed → retried', async () => {
    const { cache } = await setup();
    for (const [id, hoursAgo] of [['c', 1], ['a', 3], ['b', 2]] as const) {
      await cache.append({ id, recordedAtMs: NOW - hoursAgo * HOUR, values: [1] });
    }
    assert.deepEqual((await cache.listPending(2)).map((record) => record.id), ['a', 'b']);
    await cache.markSynced(['a'], NOW);
    await cache.markFailed(['b'], 'HTTP 503');
    assert.deepEqual(await cache.countByStatus(), { pending: 1, synced: 1, failed: 1 });
    assert.deepEqual((await cache.listPending(10)).map((record) => record.id), ['c']);
    assert.equal(await cache.retryFailed(), 1);
    assert.deepEqual((await cache.listPending(10)).map((record) => record.id), ['b', 'c']);
  });

  it('prunes uploaded windows older than 24 hours on every append but never deletes unsent ones', async () => {
    const { cache } = await setup();
    await cache.append({ id: 'old-synced', recordedAtMs: NOW - 30 * HOUR, values: [1] });
    await cache.append({ id: 'old-pending', recordedAtMs: NOW - 30 * HOUR, values: [1] });
    await cache.append({ id: 'recent-synced', recordedAtMs: NOW - 1 * HOUR, values: [1] });
    await cache.markSynced(['old-synced', 'recent-synced'], NOW);
    await cache.append({ id: 'new', recordedAtMs: NOW, values: [1] }); // triggers automatic cleanup
    assert.deepEqual((await cache.listSince(0)).map((window) => window.id), ['old-pending', 'recent-synced', 'new']);
  });

  it('keeps each signed-in user separate on a shared device', async () => {
    const db = openMemorySqlite();
    const { cache: alice } = await setup('alice', db);
    const bob = createSqlitePpgCache(db, { userId: 'bob', nowMs: () => NOW });
    await alice.append({ id: 'same-id', recordedAtMs: NOW, values: [1] });
    await bob.append({ id: 'same-id', recordedAtMs: NOW, values: [2] });
    await alice.markSynced(['same-id'], NOW);
    assert.equal(await alice.countPending(), 0);
    assert.equal(await bob.countPending(), 1);
    assert.deepEqual((await bob.listPending(1))[0].ppg, [2]);
  });

  it('rejects invalid windows before storing anything', async () => {
    const { cache } = await setup();
    await assert.rejects(cache.append({ id: '', recordedAtMs: NOW, values: [1] }), RangeError);
    await assert.rejects(cache.append({ id: 'w', recordedAtMs: Number.NaN, values: [1] }), RangeError);
    await assert.rejects(cache.append({ id: 'w', recordedAtMs: NOW, values: [] }), RangeError);
    await assert.rejects(cache.append({ id: 'w', recordedAtMs: NOW, values: Array(11).fill(1) }), RangeError);
    await assert.rejects(cache.append({ id: 'w', recordedAtMs: NOW, values: [1, Number.POSITIVE_INFINITY] }), RangeError);
    assert.equal(await cache.countPending(), 0);
    assert.throws(() => createSqlitePpgCache(openMemorySqlite(), { userId: ' ' }), RangeError);
  });

  it('migrates idempotently and handles large id batches in one call', async () => {
    const { db, cache } = await setup();
    await migratePpgCache(db); // second run is a no-op
    const ids = Array.from({ length: 1200 }, (_, index) => `w${String(index).padStart(4, '0')}`);
    const wide = createSqlitePpgCache(db, { userId: 'user-a', nowMs: () => NOW });
    for (const id of ids) await wide.append({ id, recordedAtMs: NOW, values: [1] });
    await cache.markSynced(ids, NOW); // more ids than one SQL statement should bind
    assert.equal(await cache.countPending(), 0);
  });

  it('works as the HealthDataCache behind the existing AWS sync service', async () => {
    const { cache } = await setup();
    await cache.append({ id: 'w1', recordedAtMs: NOW - HOUR, values: [0.1] });
    await cache.append({ id: 'w2', recordedAtMs: NOW, values: [0.2] });
    const uploaded: string[] = [];
    const sync = createAwsSyncService(cache, { putBatch: async (records) => { uploaded.push(...records.map((record) => record.id)); } }, {
      batchSize: 1, maxAttempts: 1, baseRetryDelayMs: 0, isOnline: () => true, nowMs: () => NOW, wait: async () => {},
    });
    const result = await sync.sync();
    assert.deepEqual(uploaded, ['w1', 'w2']);
    assert.equal(result.syncedCount, 2);
    assert.deepEqual(await cache.countByStatus(), { pending: 0, synced: 2, failed: 0 });
  });
});
