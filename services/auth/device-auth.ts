import { pbkdf2Async } from '@noble/hashes/pbkdf2.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { getUserDataDb } from '../user-data-db.ts';
import type { AuthService } from './auth-service.ts';
import { createLocalAuthService, parseStoredHash, type LocalAccount, type LocalAccountStore, type SessionStore } from './local-auth-service.ts';

const SESSION_KEY = 'cdd.auth.userId';
const SECURE_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

interface AccountRow {
  user_id: string;
  email: string;
  password_hash: string;
  salt: string;
  created_at_ms: number;
}

const toAccount = (row: AccountRow): LocalAccount => ({
  userId: row.user_id,
  email: row.email,
  passwordHash: row.password_hash,
  salt: row.salt,
  createdAtMs: row.created_at_ms,
});

const sqliteAccountStore: LocalAccountStore = {
  async findByEmail(email) {
    const db = await getUserDataDb();
    const row = await db.getFirstAsync<AccountRow>('SELECT * FROM local_accounts WHERE email = ?', [email]);
    return row ? toAccount(row) : null;
  },
  async findById(userId) {
    const db = await getUserDataDb();
    const row = await db.getFirstAsync<AccountRow>('SELECT * FROM local_accounts WHERE user_id = ?', [userId]);
    return row ? toAccount(row) : null;
  },
  async insert(account) {
    const db = await getUserDataDb();
    const result = await db.runAsync(
      `INSERT INTO local_accounts (user_id, email, password_hash, salt, created_at_ms)
       VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING`,
      [account.userId, account.email, account.passwordHash, account.salt, account.createdAtMs],
    );
    return result.changes === 1;
  },
  async getAttempts(email) {
    const db = await getUserDataDb();
    const row = await db.getFirstAsync<{ failures: number; locked_until_ms: number | null }>(
      'SELECT failures, locked_until_ms FROM sign_in_attempts WHERE email = ?',
      [email],
    );
    return { failures: row?.failures ?? 0, lockedUntilMs: row?.locked_until_ms ?? null };
  },
  async saveAttempts(email, attempts) {
    const db = await getUserDataDb();
    await db.runAsync(
      `INSERT INTO sign_in_attempts (email, failures, locked_until_ms) VALUES (?, ?, ?)
       ON CONFLICT(email) DO UPDATE SET failures = excluded.failures, locked_until_ms = excluded.locked_until_ms`,
      [email, attempts.failures, attempts.lockedUntilMs],
    );
  },
  async maxPasswordIterations() {
    const db = await getUserDataDb();
    const rows = await db.getAllAsync<{ password_hash: string }>('SELECT password_hash FROM local_accounts');
    return rows.reduce((max, row) => Math.max(max, parseStoredHash(row.password_hash)?.iterations ?? 0), 0);
  },
  async updatePasswordHash(userId, passwordHash) {
    const db = await getUserDataDb();
    await db.runAsync('UPDATE local_accounts SET password_hash = ? WHERE user_id = ?', [passwordHash, userId]);
  },
  async clearAttempts(email) {
    const db = await getUserDataDb();
    await db.runAsync('DELETE FROM sign_in_attempts WHERE email = ?', [email]);
  },
};

const secureSessionStore: SessionStore = {
  read: () => SecureStore.getItemAsync(SESSION_KEY, SECURE_OPTIONS),
  write: (userId) => SecureStore.setItemAsync(SESSION_KEY, userId, SECURE_OPTIONS),
  clear: () => SecureStore.deleteItemAsync(SESSION_KEY, SECURE_OPTIONS),
};

/**
 * Deliberately slow PBKDF2-HMAC-SHA256 (audited @noble/hashes); the async variant yields so the
 * UI stays responsive. Cognito replaces this entirely; passwords then never touch app storage.
 */
const derivePassword = async (password: string, salt: string, iterations: number) =>
  bytesToHex(await pbkdf2Async(sha256, password, salt, { c: iterations, dkLen: 32 }));

export function createDeviceAuthService(): AuthService {
  return createLocalAuthService({
    accounts: sqliteAccountStore,
    sessions: secureSessionStore,
    derivePassword,
    randomId: Crypto.randomUUID,
  });
}
