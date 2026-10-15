import type { UserProfile } from '../database.ts';
import type { SqlDatabase } from '../sql-database.ts';
import {
  ageFromDateOfBirth,
  applyProfileTabEdits,
  finalizeHealthProfile,
  formatHeight,
  formatUsDate,
  kgToLb,
  type HealthProfile,
  type HealthProfileDraft,
} from './health-profile.ts';

export interface OnboardingState {
  readonly draft: HealthProfileDraft;
  readonly step: number;
  readonly completed: boolean;
}

/** The legacy single-row Profile tab storage plus the journal's notion of who is signed in. */
export interface SharedProfileStore {
  readonly save: (profile: UserProfile) => Promise<void>;
  readonly clear: () => Promise<void>;
  readonly setJournalUser: (userId: string) => void;
}

export interface ProfileRepositoryDependencies {
  /** The migrated, encrypted user-data database. */
  readonly userDb: () => Promise<SqlDatabase>;
  readonly shared: SharedProfileStore;
  readonly now?: () => Date;
}

export interface ProfileRepository {
  readonly getOnboardingState: (userId: string) => Promise<OnboardingState>;
  readonly saveOnboardingDraft: (userId: string, draft: HealthProfileDraft, step: number) => Promise<void>;
  readonly completeOnboarding: (userId: string, email: string, profile: HealthProfile) => Promise<void>;
  readonly activateProfileForUser: (userId: string, email: string) => Promise<void>;
  readonly deactivateProfile: () => Promise<void>;
  /** Saves Profile-tab edits and returns what was actually stored, for the screen to show. */
  readonly saveProfileTabEdits: (userId: string, email: string, edits: UserProfile) => Promise<UserProfile>;
}

interface HealthProfileRow {
  draft_json: string;
  onboarding_step: number;
  completed_at_ms: number | null;
}

function parseObject<T>(json: string): T | null {
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as T) : null;
  } catch {
    return null;
  }
}

/** The Profile tab's display shape, always derived from the validated canonical profile. */
export function toProfileTab(profile: HealthProfile, email: string, now: Date): UserProfile {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    phone: profile.phone,
    email,
    dob: formatUsDate(profile.dateOfBirth),
    weight: Math.round(kgToLb(profile.weightKg)),
    height: formatHeight(profile.heightCm, 'ft-in'),
    age: ageFromDateOfBirth(profile.dateOfBirth, now),
    skinTone: profile.skinTone,
  };
}

export function createProfileRepository(deps: ProfileRepositoryDependencies): ProfileRepository {
  const now = deps.now ?? (() => new Date());

  const getOnboardingState = async (userId: string): Promise<OnboardingState> => {
    const db = await deps.userDb();
    const row = await db.getFirstAsync<HealthProfileRow>(
      'SELECT draft_json, onboarding_step, completed_at_ms FROM health_profiles WHERE user_id = ?',
      [userId],
    );
    if (!row) return { draft: {}, step: 0, completed: false };
    return { draft: parseObject<HealthProfileDraft>(row.draft_json) ?? {}, step: row.onboarding_step, completed: row.completed_at_ms !== null };
  };

  const completedProfile = async (userId: string): Promise<HealthProfile | null> => {
    const state = await getOnboardingState(userId);
    return state.completed ? finalizeHealthProfile(state.draft, now()) : null;
  };

  const saveMirror = async (userId: string, profile: UserProfile) => {
    const db = await deps.userDb();
    await db.runAsync(
      `INSERT INTO profile_mirrors (user_id, profile_json, updated_at_ms) VALUES (?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET profile_json = excluded.profile_json, updated_at_ms = excluded.updated_at_ms`,
      [userId, JSON.stringify(profile), now().getTime()],
    );
  };

  return {
    getOnboardingState,

    async saveOnboardingDraft(userId, draft, step) {
      const db = await deps.userDb();
      await db.runAsync(
        `INSERT INTO health_profiles (user_id, draft_json, onboarding_step, updated_at_ms) VALUES (?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET draft_json = excluded.draft_json,
           onboarding_step = excluded.onboarding_step, updated_at_ms = excluded.updated_at_ms`,
        [userId, JSON.stringify(draft), step, now().getTime()],
      );
    },

    async completeOnboarding(userId, email, profile) {
      const db = await deps.userDb();
      const at = now().getTime();
      await db.runAsync(
        `INSERT INTO health_profiles (user_id, draft_json, onboarding_step, completed_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(user_id) DO UPDATE SET draft_json = excluded.draft_json, onboarding_step = excluded.onboarding_step,
           completed_at_ms = excluded.completed_at_ms, updated_at_ms = excluded.updated_at_ms`,
        [userId, JSON.stringify(profile), -1, at, at],
      );
      const display = toProfileTab(profile, email, now());
      await saveMirror(userId, display);
      await deps.shared.save(display);
    },

    /**
     * The existing Profile tab reads one shared row, so it is reloaded with this account's own
     * copy (or emptied) on every sign-in. A missing or unreadable copy is rebuilt from the
     * canonical profile so one account's details never show up for another.
     */
    async activateProfileForUser(userId, email) {
      deps.shared.setJournalUser(userId);
      const db = await deps.userDb();
      const row = await db.getFirstAsync<{ profile_json: string }>('SELECT profile_json FROM profile_mirrors WHERE user_id = ?', [userId]);
      const mirror = row ? parseObject<UserProfile>(row.profile_json) : null;
      if (mirror) return deps.shared.save(mirror);
      const canonical = await completedProfile(userId);
      if (canonical) return deps.shared.save(toProfileTab(canonical, email, now()));
      return deps.shared.clear();
    },

    deactivateProfile: () => deps.shared.clear(),

    async saveProfileTabEdits(userId, email, edits) {
      const current = await completedProfile(userId);
      // Display values are always re-derived from validated data: unreadable edits keep the old
      // value, age follows the date of birth, and the email shown stays the sign-in email.
      const updated = current ? applyProfileTabEdits(current, edits, now()) : null;
      const display = updated ? toProfileTab(updated, email, now()) : { ...edits, email };
      if (updated) {
        const db = await deps.userDb();
        await db.runAsync('UPDATE health_profiles SET draft_json = ?, updated_at_ms = ? WHERE user_id = ?', [JSON.stringify(updated), now().getTime(), userId]);
      }
      await saveMirror(userId, display);
      await deps.shared.save(display);
      return display;
    },
  };
}
