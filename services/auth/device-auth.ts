import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

import { getUserDataDb } from '../user-data-db.ts';
import type { AuthService } from './auth-service.ts';
import { createLocalAuthService, type LocalAccount, type LocalAccountStore, type SessionStore } from './local-auth-service.ts';

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
};

const secureSessionStore: SessionStore = {
  read: () => SecureStore.getItemAsync(SESSION_KEY, SECURE_OPTIONS),
  write: (userId) => SecureStore.setItemAsync(SESSION_KEY, userId, SECURE_OPTIONS),
  clear: () => SecureStore.deleteItemAsync(SESSION_KEY, SECURE_OPTIONS),
};

/**
 * Salted SHA-256 is adequate only for a device-local development stand-in. The Cognito
 * adapter replaces this entirely; passwords then never touch app storage.
 */
const hashPassword = (password: string, salt: string) =>
  Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `${salt}:${password}`);

export function createDeviceAuthService(): AuthService {
  return createLocalAuthService({
    accounts: sqliteAccountStore,
    sessions: secureSessionStore,
    hashPassword,
    randomId: Crypto.randomUUID,
  });
}
