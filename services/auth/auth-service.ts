/**
 * Provider-agnostic authentication contract. Screens depend only on this file so the
 * local development adapter can later be replaced by an AWS Cognito adapter.
 */
export type AuthProvider = 'local-dev' | 'cognito';

export interface AuthSession {
  readonly userId: string;
  readonly email: string;
  readonly provider: AuthProvider;
  readonly createdAtMs: number;
}

export type AuthErrorCode =
  | 'INVALID_EMAIL'
  | 'WEAK_PASSWORD'
  | 'EMAIL_IN_USE'
  | 'INVALID_CREDENTIALS'
  | 'TOO_MANY_ATTEMPTS'
  | 'STORAGE_FAILED'
  | 'UNKNOWN';

export const MIN_PASSWORD_LENGTH = 8;

/** Messages are safe to show directly; they never reveal whether an email is registered on sign-in. */
const FRIENDLY_MESSAGES: Record<AuthErrorCode, string> = {
  INVALID_EMAIL: 'Enter a valid email address.',
  WEAK_PASSWORD: `Password must be at least ${MIN_PASSWORD_LENGTH} characters and include a letter and a number.`,
  EMAIL_IN_USE: 'An account with this email already exists. Try signing in instead.',
  INVALID_CREDENTIALS: 'Incorrect email or password.',
  TOO_MANY_ATTEMPTS: 'Too many sign-in attempts. Wait a few minutes, then try again.',
  STORAGE_FAILED: 'Could not access secure storage on this device. Please try again.',
  UNKNOWN: 'Something went wrong. Please try again.',
};

export class AuthError extends Error {
  readonly code: AuthErrorCode;
  override readonly cause?: unknown;
  constructor(code: AuthErrorCode, cause?: unknown) {
    super(FRIENDLY_MESSAGES[code], { cause });
    this.name = 'AuthError';
    this.code = code;
    this.cause = cause;
  }
}

/** The user-facing message for a code, so screens validating before submit use the same wording. */
export function authErrorMessage(code: AuthErrorCode): string {
  return FRIENDLY_MESSAGES[code];
}

export function toFriendlyAuthMessage(error: unknown): string {
  return error instanceof AuthError ? error.message : FRIENDLY_MESSAGES.UNKNOWN;
}

export interface Credentials {
  readonly email: string;
  readonly password: string;
}

export interface AuthService {
  readonly provider: AuthProvider;
  /** Restores a persisted session; resolves null when signed out or when storage is unreadable. */
  readonly restoreSession: () => Promise<AuthSession | null>;
  readonly signIn: (credentials: Credentials) => Promise<AuthSession>;
  readonly signUp: (credentials: Credentials) => Promise<AuthSession>;
  readonly signOut: () => Promise<void>;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidEmail(email: string): boolean {
  const normalized = normalizeEmail(email);
  return normalized.length <= 254 && EMAIL_PATTERN.test(normalized);
}

export function isStrongEnoughPassword(password: string): boolean {
  return password.length >= MIN_PASSWORD_LENGTH && /[A-Za-z]/.test(password) && /\d/.test(password);
}
