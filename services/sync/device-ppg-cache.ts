import type * as SQLite from 'expo-sqlite';

import { openEncryptedDatabase } from '../secure-database.ts';
import { createSqlitePpgCache, migratePpgCache, type PpgCacheStore } from './sqlite-ppg-cache.ts';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function openCacheDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      // Raw pulse data is health data: the file is encrypted with the install's keychain key.
      const db = await openEncryptedDatabase('ppg-cache.db');
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
