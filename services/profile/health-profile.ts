/**
 * Health data collected during onboarding. Canonical units (cm, kg, ISO date) are stored so
 * the values can later become a validated PredictionProfile without guessing units.
 */
export type HeightUnit = 'ft-in' | 'cm';
export type WeightUnit = 'lb' | 'kg';

export interface HealthProfile {
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string;
  /** ISO calendar date, YYYY-MM-DD. */
  readonly dateOfBirth: string;
  readonly heightCm: number;
  readonly weightKg: number;
  readonly preferredHeightUnit: HeightUnit;
  readonly preferredWeightUnit: WeightUnit;
  /** Index into the six-swatch palette used by the Profile screen (0 = lightest). */
  readonly skinTone: number;
}

export type HealthProfileDraft = Partial<HealthProfile>;

export const SKIN_TONE_COUNT = 6;
const CM_PER_INCH = 2.54;
const KG_PER_LB = 0.45359237;

export const MIN_AGE_YEARS = 18;
export const MAX_AGE_YEARS = 120;
export const HEIGHT_RANGE_CM = { min: 90, max: 250 } as const;
export const WEIGHT_RANGE_KG = { min: 25, max: 350 } as const;

export function feetInchesToCm(feet: number, inches: number): number {
  return (feet * 12 + inches) * CM_PER_INCH;
}

export function cmToFeetInches(cm: number): { feet: number; inches: number } {
  const totalInches = Math.round(cm / CM_PER_INCH);
  return { feet: Math.floor(totalInches / 12), inches: totalInches % 12 };
}

export function lbToKg(lb: number): number {
  return lb * KG_PER_LB;
}

export function kgToLb(kg: number): number {
  return kg / KG_PER_LB;
}

/** Parses MM/DD/YYYY (the format the app displays) into an ISO date, rejecting impossible dates. */
export function parseUsDate(input: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(input.trim());
  if (!match) return null;
  const [, mm, dd, yyyy] = match;
  const month = Number(mm);
  const day = Number(dd);
  const year = Number(yyyy);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${yyyy}-${mm}-${dd}`;
}

export function formatUsDate(isoDate: string): string {
  const [yyyy, mm, dd] = isoDate.split('-');
  return `${mm}/${dd}/${yyyy}`;
}

export function ageFromDateOfBirth(isoDate: string, now: Date): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  let age = now.getFullYear() - year;
  const beforeBirthday = now.getMonth() + 1 < month || (now.getMonth() + 1 === month && now.getDate() < day);
  if (beforeBirthday) age -= 1;
  return age;
}

export function formatHeight(cm: number, unit: HeightUnit): string {
  if (unit === 'cm') return `${Math.round(cm * 10) / 10} cm`;
  const { feet, inches } = cmToFeetInches(cm);
  return `${feet} ft. ${inches} in.`;
}

export function formatWeight(kg: number, unit: WeightUnit): string {
  return unit === 'kg' ? `${Math.round(kg)} kg` : `${Math.round(kgToLb(kg))} lb`;
}

/** Each validator returns a user-facing error, or null when the step is valid. */
export function validateName(firstName: string, lastName: string): string | null {
  if (!firstName.trim() || !lastName.trim()) return 'Enter your first and last name.';
  if (firstName.trim().length > 50 || lastName.trim().length > 50) return 'Names must be 50 characters or fewer.';
  return null;
}

export function validatePhone(phone: string): string | null {
  if (!phone.trim()) return null; // optional
  const digits = phone.replace(/\D/g, '');
  return digits.length >= 10 && digits.length <= 15 ? null : 'Enter a valid phone number or leave it blank.';
}

export function validateDateOfBirth(usDate: string, now: Date): string | null {
  const iso = parseUsDate(usDate);
  if (!iso) return 'Enter your date of birth as MM/DD/YYYY.';
  const age = ageFromDateOfBirth(iso, now);
  if (age < 0) return 'Date of birth cannot be in the future.';
  if (age < MIN_AGE_YEARS) return `You must be at least ${MIN_AGE_YEARS} to use this app.`;
  if (age > MAX_AGE_YEARS) return 'Check your date of birth.';
  return null;
}

export function validateHeightCm(cm: number): string | null {
  if (!Number.isFinite(cm) || cm < HEIGHT_RANGE_CM.min || cm > HEIGHT_RANGE_CM.max) return 'Enter a height between 3 ft. and 8 ft. 2 in. (90–250 cm).';
  return null;
}

export function validateWeightKg(kg: number): string | null {
  if (!Number.isFinite(kg) || kg < WEIGHT_RANGE_KG.min || kg > WEIGHT_RANGE_KG.max) return 'Enter a weight between 55 and 770 lb (25–350 kg).';
  return null;
}

export function validateSkinTone(index: number | undefined): string | null {
  return index !== undefined && Number.isInteger(index) && index >= 0 && index < SKIN_TONE_COUNT ? null : 'Select the swatch closest to your skin tone.';
}

/** Returns a complete profile only if every field passes validation. */
export function finalizeHealthProfile(draft: HealthProfileDraft, now: Date): HealthProfile | null {
  const { firstName = '', lastName = '', phone = '', dateOfBirth, heightCm, weightKg, skinTone } = draft;
  if (validateName(firstName, lastName) || validatePhone(phone)) return null;
  if (!dateOfBirth || validateDateOfBirth(formatUsDate(dateOfBirth), now)) return null;
  if (heightCm === undefined || validateHeightCm(heightCm)) return null;
  if (weightKg === undefined || validateWeightKg(weightKg)) return null;
  if (validateSkinTone(skinTone)) return null;
  return {
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    phone: phone.trim(),
    dateOfBirth,
    heightCm,
    weightKg,
    preferredHeightUnit: draft.preferredHeightUnit ?? 'ft-in',
    preferredWeightUnit: draft.preferredWeightUnit ?? 'lb',
    skinTone: skinTone as number,
  };
}

/**
 * Parses the free-text height the Profile tab shows and edits: "5 ft. 10 in.", "5'10\"",
 * "5 ft", or "178 cm". A bare number is ambiguous (feet? cm?) and returns null.
 */
export function parseHeightText(text: string): number | null {
  const imperial = /^\s*(\d)\s*(?:ft\.?|feet|foot|')\s*(?:(\d{1,2}(?:\.\d+)?)\s*(?:in\.?|inches|inch|"|'')?)?\s*$/i.exec(text);
  if (imperial) {
    const inches = imperial[2] === undefined ? 0 : Number(imperial[2]);
    return inches < 12 ? feetInchesToCm(Number(imperial[1]), inches) : null;
  }
  const metric = /^\s*(\d{2,3}(?:\.\d+)?)\s*cm\s*$/i.exec(text);
  return metric ? Number(metric[1]) : null;
}

/** The shape the existing Profile tab edits (weight in lb, dates as MM/DD/YYYY, free-text height). */
export interface ProfileTabValues {
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string;
  readonly dob: string;
  readonly weight: number;
  readonly height: string;
  readonly skinTone: number;
}

/**
 * Applies Profile-tab edits to the canonical health profile. Each field is taken only if it
 * parses and validates; anything unreadable keeps the previous canonical value.
 */
export function applyProfileTabEdits(current: HealthProfile, edits: ProfileTabValues, now: Date): HealthProfile {
  const firstName = edits.firstName.trim();
  const lastName = edits.lastName.trim();
  const dateOfBirth = parseUsDate(edits.dob);
  const heightCm = parseHeightText(edits.height);
  const weightKg = lbToKg(edits.weight);
  return {
    ...current,
    ...(validateName(firstName, lastName) === null ? { firstName, lastName } : {}),
    ...(validatePhone(edits.phone) === null ? { phone: edits.phone.trim() } : {}),
    ...(dateOfBirth && validateDateOfBirth(edits.dob, now) === null ? { dateOfBirth } : {}),
    ...(heightCm !== null && validateHeightCm(heightCm) === null ? { heightCm } : {}),
    ...(validateWeightKg(weightKg) === null ? { weightKg } : {}),
    ...(validateSkinTone(edits.skinTone) === null ? { skinTone: edits.skinTone } : {}),
  };
}
