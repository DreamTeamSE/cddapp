import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { describe, it } from 'node:test';
import { AuthError, toFriendlyAuthMessage } from '../../services/auth/auth-service.ts';
import {
  createLocalAuthService,
  FREE_ATTEMPTS,
  lockoutDurationMs,
  parseStoredHash,
  type LocalAccount,
  type LocalAccountStore,
  type SessionStore,
  type SignInAttempts,
} from '../../services/auth/local-auth-service.ts';

function setup(overrides: { sessions?: Partial<SessionStore>; insert?: LocalAccountStore['insert']; iterations?: number } = {}) {
  const accounts = new Map<string, LocalAccount>();
  const attempts = new Map<string, SignInAttempts>();
  let stored: string | null = null;
  let counter = 0;
  let clock = 1_000;
  const store: LocalAccountStore = {
    async getAttempts(email) { return attempts.get(email) ?? { failures: 0, lockedUntilMs: null }; },
    async saveAttempts(email, value) { attempts.set(email, value); },
    async clearAttempts(email) { attempts.delete(email); },
    async maxPasswordIterations() {
      return [...accounts.values()].reduce((max, account) => Math.max(max, parseStoredHash(account.passwordHash)?.iterations ?? 0), 0);
    },
    async updatePasswordHash(userId, passwordHash) {
      const account = accounts.get(userId);
      if (account) accounts.set(userId, { ...account, passwordHash });
    },
    async findByEmail(email) { return [...accounts.values()].find((account) => account.email === email) ?? null; },
    async findById(userId) { return accounts.get(userId) ?? null; },
    insert: overrides.insert ?? (async (account) => {
      if ([...accounts.values()].some((existing) => existing.email === account.email)) return false;
      accounts.set(account.userId, account);
      return true;
    }),
  };
  const sessions: SessionStore = {
    read: async () => stored,
    write: async (userId) => { stored = userId; },
    clear: async () => { stored = null; },
    ...overrides.sessions,
  };
  const derived: number[] = [];
  const service = createLocalAuthService({
    accounts: store,
    sessions,
    // Node's built-in PBKDF2 stands in for @noble/hashes; few iterations keep tests fast.
    derivePassword: async (password, salt, iterations) => {
      derived.push(iterations);
      return pbkdf2Sync(password, salt, iterations, 32, 'sha256').toString('hex');
    },
    iterations: overrides.iterations ?? 1_000,
    randomId: () => `id-${++counter}`,
    nowMs: () => clock,
  });
  return { service, store, accounts, attempts, derived, getStored: () => stored, advance: (ms: number) => { clock += ms; } };
}

describe('local auth service', () => {
  it('signs up with a normalized email, stores only a salted hash, and persists the session', async () => {
    const { service, accounts, getStored } = setup();
    const session = await service.signUp({ email: '  Pat@Example.COM ', password: 'pulse1234' });
    assert.equal(session.email, 'pat@example.com');
    assert.equal(session.provider, 'local-dev');
    assert.equal(getStored(), session.userId);
    const saved = accounts.get(session.userId);
    if (!saved) throw new Error('account was not stored');
    assert.notEqual(saved.passwordHash, 'pulse1234');
    assert.match(saved.passwordHash, /^pbkdf2-sha256\$1000\$[0-9a-f]{64}$/);
    assert.ok(saved.salt.length > 0);
  });

  it('rejects invalid emails, weak passwords, and duplicate accounts with friendly errors', async () => {
    const { service } = setup();
    await assert.rejects(service.signUp({ email: 'not-an-email', password: 'pulse1234' }), { code: 'INVALID_EMAIL' });
    await assert.rejects(service.signUp({ email: 'a@b.co', password: 'short1' }), { code: 'WEAK_PASSWORD' });
    await assert.rejects(service.signUp({ email: 'a@b.co', password: 'lettersonly' }), { code: 'WEAK_PASSWORD' });
    await service.signUp({ email: 'a@b.co', password: 'pulse1234' });
    await assert.rejects(service.signUp({ email: 'A@B.co', password: 'pulse5678' }), { code: 'EMAIL_IN_USE' });
  });

  it('signs in with the right password and gives one message for wrong password or unknown email', async () => {
    const { service } = setup();
    const created = await service.signUp({ email: 'pat@example.com', password: 'pulse1234' });
    await service.signOut();
    const session = await service.signIn({ email: 'PAT@example.com', password: 'pulse1234' });
    assert.equal(session.userId, created.userId);
    const wrong = await service.signIn({ email: 'pat@example.com', password: 'pulse9999' }).catch((error: unknown) => error);
    const unknown = await service.signIn({ email: 'nobody@example.com', password: 'pulse1234' }).catch((error: unknown) => error);
    if (!(wrong instanceof AuthError) || !(unknown instanceof AuthError)) throw new Error('expected AuthError');
    assert.equal(wrong.code, 'INVALID_CREDENTIALS');
    assert.equal(toFriendlyAuthMessage(wrong), toFriendlyAuthMessage(unknown));
  });

  it('restores a saved session and clears one that points at a deleted account', async () => {
    const { service, accounts, getStored } = setup();
    const created = await service.signUp({ email: 'pat@example.com', password: 'pulse1234' });
    assert.equal((await service.restoreSession())?.userId, created.userId);
    accounts.clear();
    assert.equal(await service.restoreSession(), null);
    assert.equal(getStored(), null);
  });

  it('treats unreadable secure storage as signed out instead of throwing', async () => {
    const { service } = setup({ sessions: { read: async () => { throw new Error('keychain -34018'); } } });
    assert.equal(await service.restoreSession(), null);
  });

  it('reports storage failures during sign-up and never shows raw error text', async () => {
    const { service } = setup({ insert: async () => { throw new Error('SQLITE_FULL: database or disk is full'); } });
    const error = await service.signUp({ email: 'pat@example.com', password: 'pulse1234' }).catch((caught: unknown) => caught);
    if (!(error instanceof AuthError)) throw new Error('expected AuthError');
    assert.equal(error.code, 'STORAGE_FAILED');
    assert.doesNotMatch(toFriendlyAuthMessage(error), /SQLITE/);
    assert.equal(toFriendlyAuthMessage(new Error('raw internal detail')), 'Something went wrong. Please try again.');
  });

  it('locks sign-in after repeated failures, the same way for real and unknown emails', async () => {
    const { service, advance } = setup();
    await service.signUp({ email: 'pat@example.com', password: 'pulse1234' });
    for (const email of ['pat@example.com', 'nobody@example.com']) {
      for (let attempt = 0; attempt < FREE_ATTEMPTS; attempt += 1) {
        await assert.rejects(service.signIn({ email, password: 'wrong-pass1' }), { code: 'INVALID_CREDENTIALS' });
      }
      await assert.rejects(service.signIn({ email, password: 'pulse1234' }), { code: 'TOO_MANY_ATTEMPTS' });
    }
    advance(lockoutDurationMs(FREE_ATTEMPTS) + 1);
    const session = await service.signIn({ email: 'pat@example.com', password: 'pulse1234' });
    assert.equal(session.email, 'pat@example.com');
  });

  it('doubles the lockout for each further failure, capped at 15 minutes, and resets after success', async () => {
    assert.equal(lockoutDurationMs(FREE_ATTEMPTS - 1), 0);
    assert.equal(lockoutDurationMs(FREE_ATTEMPTS), 30_000);
    assert.equal(lockoutDurationMs(FREE_ATTEMPTS + 1), 60_000);
    assert.equal(lockoutDurationMs(FREE_ATTEMPTS + 20), 15 * 60_000);
    const { service } = setup();
    await service.signUp({ email: 'pat@example.com', password: 'pulse1234' });
    for (let attempt = 0; attempt < FREE_ATTEMPTS - 1; attempt += 1) {
      await assert.rejects(service.signIn({ email: 'pat@example.com', password: 'nope12345' }));
    }
    await service.signIn({ email: 'pat@example.com', password: 'pulse1234' }); // success clears the count
    for (let attempt = 0; attempt < FREE_ATTEMPTS - 1; attempt += 1) {
      await assert.rejects(service.signIn({ email: 'pat@example.com', password: 'nope12345' }), { code: 'INVALID_CREDENTIALS' });
    }
  });

  it('spends the same work on real and unknown emails even when stored iteration counts differ', async () => {
    const { service, accounts, derived } = setup();
    const created = await service.signUp({ email: 'old@example.com', password: 'pulse1234' });
    // Simulate an account hashed under an older, higher work factor.
    const legacy = accounts.get(created.userId);
    if (!legacy) throw new Error('missing account');
    accounts.set(created.userId, { ...legacy, passwordHash: `pbkdf2-sha256$3000$${pbkdf2Sync('pulse1234', legacy.salt, 3000, 32, 'sha256').toString('hex')}` });
    await service.signUp({ email: 'new@example.com', password: 'pulse1234' });
    const workFor = async (email: string) => {
      derived.length = 0;
      await service.signIn({ email, password: 'wrong-pass1' }).catch(() => undefined);
      return derived.reduce((sum, count) => sum + count, 0);
    };
    assert.equal(await workFor('old@example.com'), 3000);
    assert.equal(await workFor('new@example.com'), 3000); // padded up to the slowest stored hash
    assert.equal(await workFor('nobody@example.com'), 3000);
  });

  it('re-saves an older hash at the current iteration count after a successful sign-in', async () => {
    const { service, accounts } = setup();
    const created = await service.signUp({ email: 'pat@example.com', password: 'pulse1234' });
    const legacy = accounts.get(created.userId);
    if (!legacy) throw new Error('missing account');
    accounts.set(created.userId, { ...legacy, passwordHash: `pbkdf2-sha256$3000$${pbkdf2Sync('pulse1234', legacy.salt, 3000, 32, 'sha256').toString('hex')}` });
    await service.signIn({ email: 'pat@example.com', password: 'pulse1234' });
    assert.equal(parseStoredHash(accounts.get(created.userId)?.passwordHash ?? '')?.iterations, 1_000);
    await service.signOut();
    assert.equal((await service.signIn({ email: 'pat@example.com', password: 'pulse1234' })).userId, created.userId);
  });

  it('counts every failure when sign-in attempts are submitted at the same time', async () => {
    const { service, attempts } = setup();
    await service.signUp({ email: 'pat@example.com', password: 'pulse1234' });
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => service.signIn({ email: 'pat@example.com', password: 'wrong-pass1' })));
    assert.ok(results.every((result) => result.status === 'rejected'));
    assert.equal(attempts.get('pat@example.com')?.failures, 4);
  });
});
