import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import type { AuthService, AuthSession, Credentials } from '@/services/auth/auth-service';
import { createDeviceAuthService } from '@/services/auth/device-auth';
import { getOnboardingState } from '@/services/profile/health-profile-store';

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
  readonly signOut: () => Promise<void>;
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
      setSession(null);
      setStatus('signed-out');
      return;
    }
    let onboarded = false;
    try {
      onboarded = (await getOnboardingState(next.userId)).completed;
    } catch (error) {
      console.error('Onboarding state load failed:', error); // fail closed: send the user through onboarding
    }
    if (current !== generation.current) return;
    setSession(next);
    setStatus(onboarded ? 'ready' : 'onboarding');
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
      await auth.signOut();
      await applySession(null);
    },
    markOnboarded: () => {
      generation.current += 1;
      setStatus('ready');
    },
  }), [auth, status, session, applySession]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuth must be used inside AuthProvider.');
  return value;
}
