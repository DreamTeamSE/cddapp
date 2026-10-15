import {
  AuthError,
  type AuthService,
  type AuthSession,
  type Credentials,
  isStrongEnoughPassword,
  isValidEmail,
  normalizeEmail,
} from './auth-service.ts';

/**
 * DEVELOPMENT-ONLY adapter: accounts exist only on this device and never leave it.
 * It is a stand-in until the team's AWS Cognito user pool is ready; do not ship it.
 */
export interface LocalAccount {
  readonly userId: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly salt: string;
  readonly createdAtMs: number;
}

export interface LocalAccountStore {
  readonly findByEmail: (email: string) => Promise<LocalAccount | null>;
  readonly findById: (userId: string) => Promise<LocalAccount | null>;
  /** Resolves false (instead of throwing) when the email is already registered. */
  readonly insert: (account: LocalAccount) => Promise<boolean>;
}

/** Persists only the signed-in user ID (small enough for SecureStore's ~2KB value limit). */
export interface SessionStore {
  readonly read: () => Promise<string | null>;
  readonly write: (userId: string) => Promise<void>;
  readonly clear: () => Promise<void>;
}

export interface LocalAuthDependencies {
  readonly accounts: LocalAccountStore;
  readonly sessions: SessionStore;
  readonly hashPassword: (password: string, salt: string) => Promise<string>;
  readonly randomId: () => string;
  readonly nowMs?: () => number;
}

function toSession(account: LocalAccount): AuthSession {
  return { userId: account.userId, email: account.email, provider: 'local-dev', createdAtMs: account.createdAtMs };
}

/** Compares every character so mismatch position does not change timing. */
function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) diff |= (a.charCodeAt(index) || 0) ^ (b.charCodeAt(index) || 0);
  return diff === 0;
}

export function createLocalAuthService(deps: LocalAuthDependencies): AuthService {
  const now = deps.nowMs ?? Date.now;

  const persist = async (account: LocalAccount): Promise<AuthSession> => {
    try { await deps.sessions.write(account.userId); }
    catch (error) { throw new AuthError('STORAGE_FAILED', error); }
    return toSession(account);
  };

  return {
    provider: 'local-dev',

    async restoreSession() {
      try {
        const userId = await deps.sessions.read();
        if (!userId) return null;
        const account = await deps.accounts.findById(userId);
        if (!account) { await deps.sessions.clear(); return null; }
        return toSession(account);
      } catch {
        // An unreadable keychain is treated as signed out rather than stranding the app on a loader.
        return null;
      }
    },

    async signIn({ email, password }: Credentials) {
      if (!isValidEmail(email)) throw new AuthError('INVALID_EMAIL');
      const account = await deps.accounts.findByEmail(normalizeEmail(email));
      // Hash even when the account is missing so both failure paths cost the same.
      const hash = await deps.hashPassword(password, account?.salt ?? 'missing-account');
      if (!account || !constantTimeEqual(hash, account.passwordHash)) throw new AuthError('INVALID_CREDENTIALS');
      return persist(account);
    },

    async signUp({ email, password }: Credentials) {
      if (!isValidEmail(email)) throw new AuthError('INVALID_EMAIL');
      if (!isStrongEnoughPassword(password)) throw new AuthError('WEAK_PASSWORD');
      const salt = deps.randomId();
      const account: LocalAccount = {
        userId: deps.randomId(),
        email: normalizeEmail(email),
        passwordHash: await deps.hashPassword(password, salt),
        salt,
        createdAtMs: now(),
      };
      let inserted: boolean;
      try { inserted = await deps.accounts.insert(account); }
      catch (error) { throw new AuthError('STORAGE_FAILED', error); }
      if (!inserted) throw new AuthError('EMAIL_IN_USE');
      return persist(account);
    },

    async signOut() {
      try { await deps.sessions.clear(); }
      catch (error) { throw new AuthError('STORAGE_FAILED', error); }
    },
  };
}
