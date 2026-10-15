import { initDatabase, saveProfile } from '../database.ts';
import { getUserDataDb } from '../user-data-db.ts';
import { ageFromDateOfBirth, formatHeight, formatUsDate, kgToLb, type HealthProfile, type HealthProfileDraft } from './health-profile.ts';

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

/**
 * Marks onboarding complete, then mirrors the data into the existing single-row profile
 * so the current Profile screen shows it without changes to its schema.
 */
export async function completeOnboarding(userId: string, email: string, profile: HealthProfile): Promise<void> {
  const db = await getUserDataDb();
  const now = Date.now();
  await db.runAsync(
    `INSERT INTO health_profiles (user_id, draft_json, onboarding_step, completed_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET draft_json = excluded.draft_json, onboarding_step = excluded.onboarding_step,
       completed_at_ms = excluded.completed_at_ms, updated_at_ms = excluded.updated_at_ms`,
    [userId, JSON.stringify(profile), -1, now, now],
  );
  await initDatabase();
  await saveProfile({
    firstName: profile.firstName,
    lastName: profile.lastName,
    phone: profile.phone,
    email,
    dob: formatUsDate(profile.dateOfBirth),
    weight: Math.round(kgToLb(profile.weightKg)),
    height: formatHeight(profile.heightCm, 'ft-in'),
    age: ageFromDateOfBirth(profile.dateOfBirth, new Date()),
    skinTone: profile.skinTone,
  });
}
