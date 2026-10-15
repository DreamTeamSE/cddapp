import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';
import * as SQLite from 'expo-sqlite';

/**
 * Opens SQLite files encrypted with SQLCipher (enabled via the expo-sqlite config plugin).
 * One random 256-bit key per install lives in the keychain; it is readable after the first
 * unlock so background sync can still open the cache, and never syncs to other devices.
 */
const KEY_NAME = 'cdd.db.encryptionKey';
const KEY_OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
};

let keyPromise: Promise<string> | null = null;

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function loadOrCreateKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(KEY_NAME, KEY_OPTIONS);
  if (existing && /^[0-9a-f]{64}$/.test(existing)) return existing;
  const created = toHex(Crypto.getRandomBytes(32));
  await SecureStore.setItemAsync(KEY_NAME, created, KEY_OPTIONS);
  return created;
}

async function openWithKey(name: string, hexKey: string): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(name);
  try {
    // PRAGMA key must be the first statement on the connection.
    await db.execAsync(`PRAGMA key = "x'${hexKey}'";`);
    // Reading the schema fails if the file is plaintext or was encrypted with a different key.
    await db.getFirstAsync('SELECT count(*) AS count FROM sqlite_master');
    return db;
  } catch (error) {
    await db.closeAsync().catch(() => {});
    throw error;
  }
}

/**
 * If the file can't be read with this install's key (an older plaintext dev database, or the
 * keychain was reset), it is deleted and recreated: unreadable data is useless either way.
 */
export async function openEncryptedDatabase(name: string): Promise<SQLite.SQLiteDatabase> {
  if (!keyPromise) keyPromise = loadOrCreateKey().catch((error) => { keyPromise = null; throw error; });
  const hexKey = await keyPromise;

  let db: SQLite.SQLiteDatabase;
  try {
    db = await openWithKey(name, hexKey);
  } catch (error) {
    console.warn(`${name} could not be opened with this device's key; recreating it.`, error);
    await SQLite.deleteDatabaseAsync(name);
    db = await openWithKey(name, hexKey);
  }

  const cipher = await db.getFirstAsync<{ cipher_version: string }>('PRAGMA cipher_version');
  if (!cipher?.cipher_version) {
    // Expo Go and web builds don't include SQLCipher; the file is then stored unencrypted.
    console.warn(`SQLCipher is unavailable in this build; ${name} is NOT encrypted.`);
  }
  await db.execAsync('PRAGMA journal_mode = WAL;');
  return db;
}
