export type SignedInStatus = 'onboarding' | 'ready';

export interface SessionGateDependencies {
  readonly isOnboarded: (userId: string) => Promise<boolean>;
  /** Refreshes what the Profile tab shows; purely cosmetic for routing purposes. */
  readonly showProfile: (userId: string) => Promise<void>;
  readonly log?: (message: string, error: unknown) => void;
}

/**
 * Decides where a signed-in user goes. Only the onboarding lookup can change the route (and it
 * fails closed to onboarding); a failure to refresh the Profile tab is logged and never sends an
 * already-onboarded user back through onboarding.
 */
export async function resolveSignedInStatus(userId: string, deps: SessionGateDependencies): Promise<SignedInStatus> {
  const log = deps.log ?? ((message, error) => console.error(message, error));
  let onboarded = false;
  try {
    onboarded = await deps.isOnboarded(userId);
  } catch (error) {
    log('Onboarding state load failed:', error);
  }
  try {
    await deps.showProfile(userId);
  } catch (error) {
    log('Loading the Profile tab for this account failed:', error);
  }
  return onboarded ? 'ready' : 'onboarding';
}
