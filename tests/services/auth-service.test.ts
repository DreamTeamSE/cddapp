import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';
import { AuthError, toFriendlyAuthMessage } from '../../services/auth/auth-service.ts';
import { createLocalAuthService, type LocalAccount, type LocalAccountStore, type SessionStore } from '../../services/auth/local-auth-service.ts';

function setup(overrides: { sessions?: Partial<SessionStore>; insert?: LocalAccountStore['insert'] } = {}) {
  const accounts = new Map<string, LocalAccount>();
  let stored: string | null = null;
  let counter = 0;
  const store: LocalAccountStore = {
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
  const service = createLocalAuthService({
    accounts: store,
    sessions,
    hashPassword: async (password, salt) => createHash('sha256').update(`${salt}:${password}`).digest('hex'),
    randomId: () => `id-${++counter}`,
    nowMs: () => 1_000,
  });
  return { service, accounts, getStored: () => stored };
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
});
