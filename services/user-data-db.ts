import type * as SQLite from 'expo-sqlite';

import { openEncryptedDatabase } from './secure-database.ts';

/**
 * Per-user data kept separate from the legacy `profile.db` so its schema stays untouched.
 * The file is encrypted; migrations are versioned with PRAGMA user_version.
 */
const MIGRATIONS: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS local_accounts (
     user_id TEXT PRIMARY KEY NOT NULL,
     email TEXT NOT NULL UNIQUE,
     password_hash TEXT NOT NULL,
     salt TEXT NOT NULL,
     created_at_ms INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS sign_in_attempts (
     email TEXT PRIMARY KEY NOT NULL,
     failures INTEGER NOT NULL,
     locked_until_ms INTEGER
   );
   CREATE TABLE IF NOT EXISTS health_profiles (
     user_id TEXT PRIMARY KEY NOT NULL,
     draft_json TEXT NOT NULL,
     onboarding_step INTEGER NOT NULL DEFAULT 0,
     completed_at_ms INTEGER,
     updated_at_ms INTEGER NOT NULL
   );
   CREATE TABLE IF NOT EXISTS profile_mirrors (
     user_id TEXT PRIMARY KEY NOT NULL,
     profile_json TEXT NOT NULL,
     updated_at_ms INTEGER NOT NULL
   );`,
];

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await openEncryptedDatabase('user-data.db');
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  const current = row?.user_version ?? 0;
  for (let version = current; version < MIGRATIONS.length; version += 1) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[version]);
      await db.execAsync(`PRAGMA user_version = ${version + 1}`);
    });
  }
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
