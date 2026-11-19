/**
 * On-device opener for prototype BP estimate history (issue #26).
 * Uses a dedicated encrypted SQLite file — not the journal DB and not the PPG cache.
 */
import type * as SQLite from 'expo-sqlite';

import type { EstimateHistory } from './estimate-history.d.ts';
import { openEncryptedDatabase } from '../secure-database.ts';
import {
  createPersistedEstimateHistory,
  migrateEstimateHistory,
  type PersistedEstimateHistory,
} from './sqlite-estimate-history.ts';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
let bindPromise: Promise<EstimateHistory> | null = null;

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

/** Standalone persisted store (tests / callers that do not use sessionHistory). */
export async function openDeviceEstimateHistory(
  options: { modelId?: string } = {},
): Promise<PersistedEstimateHistory> {
  return createPersistedEstimateHistory(await openHistoryDb(), options);
}

/**
 * Bind the shared AnyPPG `sessionHistory` object to on-device SQLite.
 * Safe to call repeatedly; hydrates prior estimates so kill/relaunch keeps them.
 */
export async function bindPrototypeHistoryPersistence(
  options: { modelId?: string } = {},
): Promise<EstimateHistory> {
  if (!bindPromise) {
    bindPromise = (async () => {
      const db = await openHistoryDb();
      const sessionHistory = await import('../anyppg/sessionHistory.js');
      await sessionHistory.attachSqlitePersistence(db, options);
      return sessionHistory.history;
    })().catch((error) => {
      bindPromise = null;
      throw error;
    });
  }
  return bindPromise;
}
