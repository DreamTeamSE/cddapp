import type * as SQLite from 'expo-sqlite';

import { openEncryptedDatabase } from './secure-database.ts';
import { migrateUserData } from './user-data-schema.ts';

/** Per-user data, kept separate from the legacy `profile.db` so its schema stays untouched. */
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await openEncryptedDatabase('user-data.db');
  await migrateUserData(db);
  return db;
}

export function getUserDataDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openAndMigrate().catch((error) => {
      dbPromise = null; // allow a later retry instead of caching the failure
      throw error;
    });
  }
  return dbPromise;
}
