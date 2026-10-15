import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import type { UserProfile } from '../../services/database.ts';
import { resolveSignedInStatus } from '../../services/auth/session-gate.ts';
import type { HealthProfile } from '../../services/profile/health-profile.ts';
import { createProfileRepository, type SharedProfileStore } from '../../services/profile/profile-repository.ts';
import { clearSharedProfileRow, listJournalEntries, upsertJournalEntry, USER_JOURNAL_SCHEMA } from '../../services/shared-profile-db.ts';
import { isWrongKeyError } from '../../services/sql-database.ts';
import { migrateUserData } from '../../services/user-data-schema.ts';
import { openMemorySqlite } from '../support/node-sqlite.ts';

const NOW = new Date(2026, 9, 15);
const alice: HealthProfile = {
  firstName: 'Alice', lastName: 'Anders', phone: '', dateOfBirth: '1990-01-02',
  heightCm: 162.56, weightKg: 59, preferredHeightUnit: 'ft-in', preferredWeightUnit: 'lb', skinTone: 1,
};
const bob: HealthProfile = { ...alice, firstName: 'Bob', lastName: 'Brown', dateOfBirth: '1985-03-04', weightKg: 90.7, skinTone: 4 };

/** The shared Profile-tab row, modelled as the single slot it is in profile.db. */
function sharedSlot() {
  let row: UserProfile | null = null;
  let journalUser: string | null = null;
  const store: SharedProfileStore = {
    save: async (profile) => { row = profile; },
    clear: async () => { row = null; },
    setJournalUser: (userId) => { journalUser = userId; },
  };
  return { store, row: () => row, journalUser: () => journalUser };
}

async function setup() {
  const db = openMemorySqlite();
  await migrateUserData(db);
  const shared = sharedSlot();
  const repo = createProfileRepository({ userDb: async () => db, shared: shared.store, now: () => NOW });
  return { db, shared, repo };
}

describe('storage layer', () => {
  it('only treats "not a database" as a wrong key, never transient errors', () => {
    assert.equal(isWrongKeyError(new Error('Error code 26: file is not a database')), true);
    assert.equal(isWrongKeyError(new Error('SQLITE_NOTADB')), true);
    assert.equal(isWrongKeyError(new Error('Error code 5: database is locked')), false);
    assert.equal(isWrongKeyError(new Error('Error code 10: disk I/O error')), false);
    assert.equal(isWrongKeyError('keychain unavailable'), false);
  });

  it('migrates user-data.db idempotently', async () => {
    const db = openMemorySqlite();
    await migrateUserData(db);
    await migrateUserData(db);
    const tables = await db.getAllAsync<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name", []);
    assert.deepEqual(tables.map((table) => table.name), ['health_profiles', 'local_accounts', 'profile_mirrors', 'sign_in_attempts']);
  });

  it('shows each account only its own Profile-tab details and empties the slot on sign-out', async () => {
    const { shared, repo } = await setup();
    await repo.completeOnboarding('alice', 'alice@example.com', alice);
    await repo.completeOnboarding('bob', 'bob@example.com', bob);
    await repo.activateProfileForUser('alice', 'alice@example.com');
    assert.equal(shared.row()?.firstName, 'Alice');
    assert.equal(shared.journalUser(), 'alice');
    await repo.deactivateProfile();
    assert.equal(shared.row(), null);
    await repo.activateProfileForUser('bob', 'bob@example.com');
    assert.equal(shared.row()?.firstName, 'Bob');
    assert.equal(shared.row()?.email, 'bob@example.com');
    await repo.activateProfileForUser('carol', 'carol@example.com'); // signed up, not onboarded
    assert.equal(shared.row(), null);
  });

  it('rebuilds the Profile tab from validated data when the stored copy is unreadable', async () => {
    const { db, shared, repo } = await setup();
    await repo.completeOnboarding('alice', 'alice@example.com', alice);
    await db.runAsync("UPDATE profile_mirrors SET profile_json = '{broken' WHERE user_id = 'alice'", []);
    await repo.activateProfileForUser('alice', 'alice@example.com');
    assert.equal(shared.row()?.firstName, 'Alice');
    assert.equal(shared.row()?.height, '5 ft. 4 in.');
  });

  it('saves only valid Profile-tab edits and returns the values actually stored', async () => {
    const { shared, repo } = await setup();
    await repo.completeOnboarding('alice', 'alice@example.com', alice);
    const edits: UserProfile = {
      firstName: 'Alicia', lastName: 'Anders', phone: '352-555-0100', email: 'someone-else@example.com',
      dob: '01/02/1990', weight: 0, height: 'tall', age: 99, skinTone: 2,
    };
    const saved = await repo.saveProfileTabEdits('alice', 'alice@example.com', edits);
    assert.equal(saved.firstName, 'Alicia');
    assert.equal(saved.phone, '352-555-0100');
    assert.equal(saved.weight, 130); // cleared weight keeps the stored 59 kg
    assert.equal(saved.height, '5 ft. 4 in.'); // unreadable height keeps the stored value
    assert.equal(saved.age, 36); // follows the date of birth, not the typed number
    assert.equal(saved.email, 'alice@example.com'); // the sign-in email can't be edited here
    assert.deepEqual(shared.row(), saved);
    const state = await repo.getOnboardingState('alice');
    assert.equal((state.draft as HealthProfile).weightKg, 59);
    assert.equal((state.draft as HealthProfile).firstName, 'Alicia');
  });

  it('keeps routing an onboarded user to the app when the Profile tab fails to load', async () => {
    const logs: string[] = [];
    const log = (message: string) => { logs.push(message); };
    const ready = await resolveSignedInStatus('alice', { isOnboarded: async () => true, showProfile: async () => { throw new Error('profile.db locked'); }, log });
    assert.equal(ready, 'ready');
    const failClosed = await resolveSignedInStatus('alice', { isOnboarded: async () => { throw new Error('user-data.db busy'); }, showProfile: async () => {}, log });
    assert.equal(failClosed, 'onboarding');
    assert.equal(logs.length, 2);
  });

  it('keeps journal entries separate per account, even on the same date', async () => {
    const db = openMemorySqlite();
    await db.execAsync(USER_JOURNAL_SCHEMA);
    await upsertJournalEntry(db, 'alice', { date: '2026-10-15', bp: '135/88', notes: 'felt dizzy', updatedAtMs: 1 });
    await upsertJournalEntry(db, 'bob', { date: '2026-10-15', bp: '120/80', notes: '', updatedAtMs: 2 });
    await upsertJournalEntry(db, 'alice', { date: '2026-10-15', bp: '130/85', notes: 'better', updatedAtMs: 3 });
    assert.deepEqual((await listJournalEntries(db, 'bob')).map((entry) => ({ ...entry })), [{ date: '2026-10-15', bp: '120/80', notes: '', updatedAtMs: 2 }]);
    assert.deepEqual((await listJournalEntries(db, 'alice')).map((entry) => entry.notes), ['better']);
    assert.deepEqual(await listJournalEntries(db, 'carol'), []);
  });

  it('clears the shared Profile row', async () => {
    const db = openMemorySqlite();
    await db.execAsync('CREATE TABLE profile (id INTEGER PRIMARY KEY NOT NULL, firstName TEXT)');
    await db.runAsync("INSERT INTO profile (id, firstName) VALUES (1, 'Alice')", []);
    await clearSharedProfileRow(db);
    assert.equal(await db.getFirstAsync('SELECT * FROM profile', []), null);
  });
});
