/**
 * On-device opener for prototype BP estimate history (issue #26).
 * Uses a dedicated encrypted SQLite file — not the journal DB and not the PPG cache.
 */
import type * as SQLite from 'expo-sqlite';

import { openEncryptedDatabase } from '../secure-database.ts';
import {
  createPersistedEstimateHistory,
  migrateEstimateHistory,
  type PersistedEstimateHistory,
} from './sqlite-estimate-history.ts';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function openHistoryDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await openEncryptedDatabase('prototype-estimate-history.db');
      await migrateEstimateHistory(db);
      return db;
    })().catch((error) => {
      dbPromise = null;
      throw error;
    });
  }
  return dbPromise;
}

/** Prototype watch/CSV estimate history that survives app relaunch. */
export async function openDeviceEstimateHistory(
  options: { modelId?: string } = {},
): Promise<PersistedEstimateHistory> {
  return createPersistedEstimateHistory(await openHistoryDb(), options);
}
