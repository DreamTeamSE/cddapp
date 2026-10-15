import * as SQLite from 'expo-sqlite';

import { createSqlitePpgCache, migratePpgCache, type PpgCacheStore } from './sqlite-ppg-cache.ts';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function openCacheDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('ppg-cache.db');
      await db.execAsync('PRAGMA journal_mode = WAL;');
      await migratePpgCache(db);
      return db;
    })().catch((error) => {
      dbPromise = null; // allow a retry on the next call instead of caching the failure
      throw error;
    });
  }
  return dbPromise;
}

/** The on-device PPG cache for one signed-in user. Nothing opens until this is called. */
export async function openDevicePpgCache(userId: string): Promise<PpgCacheStore> {
  return createSqlitePpgCache(await openCacheDb(), { userId });
}
