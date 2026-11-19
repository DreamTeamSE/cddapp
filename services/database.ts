import * as SQLite from 'expo-sqlite';

import { clearSharedProfileRow, listJournalEntries, upsertJournalEntry, USER_JOURNAL_SCHEMA } from './shared-profile-db.ts';

// Type definition for our User to keep TS happy
export interface UserProfile {
  id?: number;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  dob: string;
  weight: number;
  height: string;
  age: number;
  skinTone: number;
}

export interface JournalEntry {
  readonly date: string;
  readonly bp: string;
  readonly notes: string;
  readonly updatedAtMs: number;
}

const dbPromise = SQLite.openDatabaseAsync('profile.db');

export const initDatabase = async (): Promise<void> => {
  const db = await dbPromise;
  await db.execAsync(`
    PRAGMA journal_mode = WAL;
    PRAGMA secure_delete = ON;
    CREATE TABLE IF NOT EXISTS profile (
      id INTEGER PRIMARY KEY NOT NULL,
      firstName TEXT,
      lastName TEXT,
      phone TEXT,
      email TEXT,
      dob TEXT,
      weight INTEGER,
      height TEXT,
      age INTEGER,
      skinTone INTEGER
    );
    CREATE TABLE IF NOT EXISTS journal_entries (
      date TEXT PRIMARY KEY NOT NULL,
      bp TEXT NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      updatedAtMs INTEGER NOT NULL
    );
    ${USER_JOURNAL_SCHEMA}
  `);
};

/**
 * The signed-in account whose journal is read and written. It is replaced when the next account
 * signs in (not cleared at sign-out) so a journal edit the screen flushes while unmounting during
 * sign-out still lands in the account that made it.
 */
let journalUserId: string | null = null;

export const setJournalUser = (userId: string): void => {
  journalUserId = userId;
};

const requireJournalUser = (): string => {
  if (!journalUserId) throw new Error('No signed-in account for the journal.');
  return journalUserId;
};

export const getJournalEntries = async (): Promise<readonly JournalEntry[]> => {
  await initDatabase();
  const db = await dbPromise;
  return listJournalEntries(db, requireJournalUser());
};

export const saveJournalEntry = async (
  date: string,
  bp: string,
  notes: string,
  updatedAtMs: number = Date.now()
): Promise<void> => {
  await initDatabase();
  const db = await dbPromise;
  await upsertJournalEntry(db, requireJournalUser(), { date, bp, notes, updatedAtMs });
};

export const saveProfile = async (user: UserProfile): Promise<void> => {
  const db = await dbPromise;
  await db.runAsync(
    `INSERT OR REPLACE INTO profile (id, firstName, lastName, phone, email, dob, weight, height, age, skinTone) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?);`,
    [1, user.firstName, user.lastName, user.phone, user.email, user.dob, user.weight, user.height, user.age, user.skinTone]
  );
};

export const getProfile = async (): Promise<UserProfile | null> => {
  const db = await dbPromise;
  const result = await db.getFirstAsync<UserProfile>('SELECT * FROM profile WHERE id = 1');
  return result;
};

/** Empties the shared profile row on sign-out so the next account never sees it. */
export const clearProfile = async (): Promise<void> => {
  await initDatabase();
  await clearSharedProfileRow(await dbPromise);
};
