import { clearProfile, initDatabase, saveProfile, type UserProfile } from '../database.ts';
import { getUserDataDb } from '../user-data-db.ts';
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

interface HealthProfileRow {
  draft_json: string;
  onboarding_step: number;
  completed_at_ms: number | null;
}

function parseDraft(json: string): HealthProfileDraft {
  try {
    const value: unknown = JSON.parse(json);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as HealthProfileDraft) : {};
  } catch {
    return {};
  }
}

export async function getOnboardingState(userId: string): Promise<OnboardingState> {
  const db = await getUserDataDb();
  const row = await db.getFirstAsync<HealthProfileRow>(
    'SELECT draft_json, onboarding_step, completed_at_ms FROM health_profiles WHERE user_id = ?',
    [userId],
  );
  if (!row) return { draft: {}, step: 0, completed: false };
  return { draft: parseDraft(row.draft_json), step: row.onboarding_step, completed: row.completed_at_ms !== null };
}

/** Saves progress after each step so relaunching the app resumes where the user left off. */
export async function saveOnboardingDraft(userId: string, draft: HealthProfileDraft, step: number): Promise<void> {
  const db = await getUserDataDb();
  await db.runAsync(
    `INSERT INTO health_profiles (user_id, draft_json, onboarding_step, updated_at_ms) VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET draft_json = excluded.draft_json,
       onboarding_step = excluded.onboarding_step, updated_at_ms = excluded.updated_at_ms`,
    [userId, JSON.stringify(draft), step, Date.now()],
  );
}

function toProfileTab(profile: HealthProfile, email: string): UserProfile {
  return {
    firstName: profile.firstName,
    lastName: profile.lastName,
    phone: profile.phone,
    email,
    dob: formatUsDate(profile.dateOfBirth),
    weight: Math.round(kgToLb(profile.weightKg)),
    height: formatHeight(profile.heightCm, 'ft-in'),
    age: ageFromDateOfBirth(profile.dateOfBirth, new Date()),
    skinTone: profile.skinTone,
  };
}

async function saveMirror(userId: string, profile: UserProfile): Promise<void> {
  const db = await getUserDataDb();
  await db.runAsync(
    `INSERT INTO profile_mirrors (user_id, profile_json, updated_at_ms) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET profile_json = excluded.profile_json, updated_at_ms = excluded.updated_at_ms`,
    [userId, JSON.stringify(profile), Date.now()],
  );
}

/** Marks onboarding complete and shows the new profile on the Profile tab. */
export async function completeOnboarding(userId: string, email: string, profile: HealthProfile): Promise<void> {
  const db = await getUserDataDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO health_profiles (user_id, draft_json, onboarding_step, completed_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET draft_json = excluded.draft_json, onboarding_step = excluded.onboarding_step,
       completed_at_ms = excluded.completed_at_ms, updated_at_ms = excluded.updated_at_ms`,
    [userId, JSON.stringify(profile), -1, now, now],
  );
  const display = toProfileTab(profile, email);
  await saveMirror(userId, display);
  await initDatabase();
  await saveProfile(display);
}

/**
 * The existing Profile tab reads one shared row. Loading it with the signed-in user's own copy
 * (or emptying it) on every sign-in keeps one account's details from showing up for another.
 */
export async function activateProfileForUser(userId: string): Promise<void> {
  const db = await getUserDataDb();
  const row = await db.getFirstAsync<{ profile_json: string }>('SELECT profile_json FROM profile_mirrors WHERE user_id = ?', [userId]);
  if (!row) return clearProfile();
  await initDatabase();
  await saveProfile(JSON.parse(row.profile_json) as UserProfile);
}

/** Empties the shared Profile row when nobody is signed in. */
export function deactivateProfile(): Promise<void> {
  return clearProfile();
}

/**
 * Saves Profile-tab edits for the signed-in user: the shared row, their own copy, and any
 * fields that parse cleanly into the canonical health profile used by onboarding/ML.
 */
export async function saveProfileTabEdits(userId: string, profile: UserProfile): Promise<void> {
  await initDatabase();
  await saveProfile(profile);
  await saveMirror(userId, profile);
  const state = await getOnboardingState(userId);
  const current = state.completed ? finalizeHealthProfile(state.draft, new Date()) : null;
  if (!current) return;
  const updated = applyProfileTabEdits(current, profile, new Date());
  const db = await getUserDataDb();
  await db.runAsync('UPDATE health_profiles SET draft_json = ?, updated_at_ms = ? WHERE user_id = ?', [JSON.stringify(updated), Date.now(), userId]);
}
