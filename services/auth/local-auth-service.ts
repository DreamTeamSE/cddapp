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
  /** Encoded as `pbkdf2-sha256$<iterations>$<hex>` so the work factor can be raised later. */
  readonly passwordHash: string;
  readonly salt: string;
  readonly createdAtMs: number;
}

export interface SignInAttempts {
  readonly failures: number;
  readonly lockedUntilMs: number | null;
}

export interface LocalAccountStore {
  readonly findByEmail: (email: string) => Promise<LocalAccount | null>;
  readonly findById: (userId: string) => Promise<LocalAccount | null>;
  /** Resolves false (instead of throwing) when the email is already registered. */
  readonly insert: (account: LocalAccount) => Promise<boolean>;
  /** Attempts are tracked per email whether or not an account exists, so lockouts reveal nothing. */
  readonly getAttempts: (email: string) => Promise<SignInAttempts>;
  /** Highest PBKDF2 iteration count among stored hashes (0 when there are none). */
  readonly maxPasswordIterations: () => Promise<number>;
  readonly updatePasswordHash: (userId: string, passwordHash: string) => Promise<void>;
  readonly saveAttempts: (email: string, attempts: SignInAttempts) => Promise<void>;
  readonly clearAttempts: (email: string) => Promise<void>;
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
  /** PBKDF2-HMAC-SHA256 returning a hex digest. */
  readonly derivePassword: (password: string, salt: string, iterations: number) => Promise<string>;
  readonly randomId: () => string;
  readonly nowMs?: () => number;
  readonly iterations?: number;
}

/** Pure-JS PBKDF2 on Hermes measured ~12.5 s at 100k in a debug build; 10k keeps sign-in near 1 s. Cognito replaces this. */
export const DEFAULT_PBKDF2_ITERATIONS = 10_000;
/** Failures allowed before the first lockout; each later failure doubles the wait. */
export const FREE_ATTEMPTS = 5;
const FIRST_LOCKOUT_MS = 30_000;
const MAX_LOCKOUT_MS = 15 * 60_000;
const HASH_PREFIX = 'pbkdf2-sha256';

export function lockoutDurationMs(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;
  return Math.min(FIRST_LOCKOUT_MS * 2 ** (failures - FREE_ATTEMPTS), MAX_LOCKOUT_MS);
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

export function parseStoredHash(stored: string): { iterations: number; hex: string } | null {
  const [prefix, iterationText, hex] = stored.split('$');
  const iterations = Number(iterationText);
  if (prefix !== HASH_PREFIX || !Number.isInteger(iterations) || iterations <= 0 || !hex) return null;
  return { iterations, hex };
}

export function createLocalAuthService(deps: LocalAuthDependencies): AuthService {
  const now = deps.nowMs ?? Date.now;
  const iterations = deps.iterations ?? DEFAULT_PBKDF2_ITERATIONS;

  const encode = async (password: string, salt: string) =>
    `${HASH_PREFIX}$${iterations}$${await deps.derivePassword(password, salt, iterations)}`;

  /**
   * Every attempt costs the same as deriving at the highest stored iteration count, whether the
   * email exists or not: accounts hashed with fewer iterations are padded with a throwaway
   * derivation for the difference, so response time can't reveal which emails are registered.
   */
  const verify = async (password: string, account: LocalAccount | null): Promise<boolean> => {
    const parsed = account ? parseStoredHash(account.passwordHash) : null;
    const target = Math.max(iterations, await deps.accounts.maxPasswordIterations());
    const own = parsed?.iterations ?? target;
    const hex = await deps.derivePassword(password, account?.salt ?? 'missing-account', own);
    if (target > own) await deps.derivePassword(password, 'timing-padding', target - own);
    return Boolean(account && parsed && constantTimeEqual(hex, parsed.hex));
  };

  // Sign-in attempts run one at a time so concurrent submits can't each read the same failure
  // count and under-count toward the lockout.
  let signInQueue: Promise<unknown> = Promise.resolve();
  const serialized = <T>(task: () => Promise<T>): Promise<T> => {
    const run = signInQueue.then(task, task);
    signInQueue = run.catch(() => undefined);
    return run;
  };

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

    signIn: ({ email, password }: Credentials) => serialized(async () => {
      if (!isValidEmail(email)) throw new AuthError('INVALID_EMAIL');
      const normalized = normalizeEmail(email);
      const attempts = await deps.accounts.getAttempts(normalized);
      if (attempts.lockedUntilMs !== null && attempts.lockedUntilMs > now()) throw new AuthError('TOO_MANY_ATTEMPTS');

      const account = await deps.accounts.findByEmail(normalized);
      if (!(await verify(password, account))) {
        const failures = attempts.failures + 1;
        const wait = lockoutDurationMs(failures);
        await deps.accounts.saveAttempts(normalized, { failures, lockedUntilMs: wait > 0 ? now() + wait : null });
        throw new AuthError('INVALID_CREDENTIALS');
      }
      await deps.accounts.clearAttempts(normalized);
      const signedIn = account as LocalAccount;
      // Re-save hashes made with an older iteration count at the current one.
      if (parseStoredHash(signedIn.passwordHash)?.iterations !== iterations) {
        await deps.accounts.updatePasswordHash(signedIn.userId, await encode(password, signedIn.salt));
      }
      return persist(signedIn);
    }),

    async signUp({ email, password }: Credentials) {
      if (!isValidEmail(email)) throw new AuthError('INVALID_EMAIL');
      if (!isStrongEnoughPassword(password)) throw new AuthError('WEAK_PASSWORD');
      const salt = deps.randomId();
      const account: LocalAccount = {
        userId: deps.randomId(),
        email: normalizeEmail(email),
        passwordHash: await encode(password, salt),
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
