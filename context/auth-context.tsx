import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { toFriendlyAuthMessage, type AuthService, type AuthSession, type Credentials } from '@/services/auth/auth-service';
import { createDeviceAuthService } from '@/services/auth/device-auth';
import { resolveSignedInStatus } from '@/services/auth/session-gate';
import { activateProfileForUser, deactivateProfile, getOnboardingState } from '@/services/profile/health-profile-store';

/**
 * loading      → restoring the session at launch (splash stays up)
 * signed-out   → only the (auth) screens are reachable
 * onboarding   → signed in, health profile not finished
 * ready        → signed in and onboarded; the main tabs are reachable
 */
export type AuthStatus = 'loading' | 'signed-out' | 'onboarding' | 'ready';

interface AuthContextValue {
  readonly status: AuthStatus;
  readonly session: AuthSession | null;
  readonly signIn: (credentials: Credentials) => Promise<void>;
  readonly signUp: (credentials: Credentials) => Promise<void>;
  /** Resolves to a user-facing error message if signing out failed, otherwise null. */
  readonly signOut: () => Promise<string | null>;
  /** Called by onboarding after its data is committed. */
  readonly markOnboarded: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children, service }: { children: React.ReactNode; service?: AuthService }) {
  const auth = useMemo(() => service ?? createDeviceAuthService(), [service]);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<AuthSession | null>(null);
  // Each transition bumps the generation so a slow result for an old session cannot route a newer one.
  const generation = useRef(0);

  const applySession = useCallback(async (next: AuthSession | null) => {
    const current = ++generation.current;
    if (!next) {
      try { await deactivateProfile(); }
      catch (error) { console.error('Clearing the shared profile failed:', error); }
      if (current !== generation.current) return;
      setSession(null);
      setStatus('signed-out');
      return;
    }
    // Load this account's Profile-tab details before any tab mounts; only the onboarding
    // lookup decides the route.
    const nextStatus = await resolveSignedInStatus(next.userId, {
      isOnboarded: async (userId) => (await getOnboardingState(userId)).completed,
      showProfile: (userId) => activateProfileForUser(userId, next.email),
    });
    if (current !== generation.current) return;
    setSession(next);
    setStatus(nextStatus);
  }, []);

  useEffect(() => {
    // restoreSession never rejects, so the app cannot be stranded on the splash screen.
    auth.restoreSession().then(applySession);
  }, [auth, applySession]);

  const value = useMemo<AuthContextValue>(() => ({
    status,
    session,
    signIn: async (credentials) => applySession(await auth.signIn(credentials)),
    signUp: async (credentials) => applySession(await auth.signUp(credentials)),
    signOut: async () => {
      try {
        await auth.signOut();
      } catch (error) {
        return toFriendlyAuthMessage(error);
      }
      await applySession(null);
      return null;
    },
    markOnboarded: () => {
      generation.current += 1;
      setStatus('ready');
    },
  }), [auth, status, session, applySession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** A Sign out button handler that tells the user when signing out failed. */
export function useSignOutHandler(): () => Promise<void> {
  const { signOut } = useAuth();
  return useCallback(async () => {
    const error = await signOut();
    if (error) Alert.alert('Could not sign out', error);
  }, [signOut]);
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
