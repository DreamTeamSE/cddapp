import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { AuthColors, ErrorBanner, FormField, FormScreen, PillButton } from '@/components/auth/auth-ui';
import { SKIN_TONES } from '@/components/skintone-picker';
import { useAuth } from '@/context/auth-context';
import {
  cmToFeetInches,
  feetInchesToCm,
  finalizeHealthProfile,
  formatHeight,
  formatUsDate,
  formatWeight,
  kgToLb,
  lbToKg,
  parseUsDate,
  validateDateOfBirth,
  validateHeightCm,
  validateName,
  validatePhone,
  validateSkinTone,
  validateWeightKg,
  type HealthProfileDraft,
  type HeightUnit,
  type WeightUnit,
} from '@/services/profile/health-profile';
import { completeOnboarding, getOnboardingState, saveOnboardingDraft } from '@/services/profile/health-profile-store';

const STEPS = ['About you', 'Date of birth', 'Height & weight', 'Skin tone', 'Review'] as const;
const SKIN_TONE_LABELS = ['Lightest', 'Light', 'Medium light', 'Medium', 'Medium dark', 'Darkest'];

/** Formats raw digits as MM/DD/YYYY while the user types. */
function maskDate(input: string): string {
  const digits = input.replace(/\D/g, '').slice(0, 8);
  if (digits.length <= 2) return digits;
  if (digits.length <= 4) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
  return `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
}

const numberOrNaN = (text: string) => (text.trim() === '' ? NaN : Number(text));

export default function OnboardingScreen() {
  const { session, signOut, markOnboarded } = useAuth();
  const userId = session?.userId ?? '';

  const [hydrated, setHydrated] = useState(false);
  const [step, setStep] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Text inputs hold what the user typed; canonical values are derived when a step is submitted.
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [heightUnit, setHeightUnit] = useState<HeightUnit>('ft-in');
  const [feet, setFeet] = useState('');
  const [inches, setInches] = useState('');
  const [cm, setCm] = useState('');
  const [weightUnit, setWeightUnit] = useState<WeightUnit>('lb');
  const [weight, setWeight] = useState('');
  const [skinTone, setSkinTone] = useState<number | undefined>(undefined);

  const lastNameRef = useRef<TextInput>(null);
  const phoneRef = useRef<TextInput>(null);
  const inchesRef = useRef<TextInput>(null);
  const weightRef = useRef<TextInput>(null);

  // Restore saved progress once; nothing is saved until this finishes so a relaunch cannot wipe it.
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    getOnboardingState(userId)
      .then(({ draft, step: savedStep }) => {
        if (cancelled) return;
        setFirstName(draft.firstName ?? '');
        setLastName(draft.lastName ?? '');
        setPhone(draft.phone ?? '');
        if (draft.dateOfBirth) setDob(formatUsDate(draft.dateOfBirth));
        if (draft.preferredHeightUnit) setHeightUnit(draft.preferredHeightUnit);
        if (draft.heightCm !== undefined) {
          const { feet: ft, inches: inch } = cmToFeetInches(draft.heightCm);
          setFeet(String(ft));
          setInches(String(inch));
          setCm(String(Math.round(draft.heightCm * 10) / 10));
        }
        if (draft.preferredWeightUnit) setWeightUnit(draft.preferredWeightUnit);
        if (draft.weightKg !== undefined) {
          setWeight(String(Math.round(draft.preferredWeightUnit === 'kg' ? draft.weightKg : kgToLb(draft.weightKg))));
        }
        setSkinTone(draft.skinTone);
        setStep(Math.min(Math.max(savedStep, 0), STEPS.length - 1));
      })
      .catch((err) => console.error('Onboarding restore failed:', err))
      .finally(() => { if (!cancelled) setHydrated(true); });
    return () => { cancelled = true; };
  }, [userId]);

  const heightCm = heightUnit === 'cm' ? numberOrNaN(cm) : feetInchesToCm(numberOrNaN(feet), inches.trim() === '' ? 0 : Number(inches));
  const weightKg = weightUnit === 'kg' ? numberOrNaN(weight) : lbToKg(numberOrNaN(weight));

  const buildDraft = (): HealthProfileDraft => ({
    firstName: firstName.trim(),
    lastName: lastName.trim(),
    phone: phone.trim(),
    dateOfBirth: parseUsDate(dob) ?? undefined,
    heightCm: Number.isFinite(heightCm) ? heightCm : undefined,
    weightKg: Number.isFinite(weightKg) ? weightKg : undefined,
    preferredHeightUnit: heightUnit,
    preferredWeightUnit: weightUnit,
    skinTone,
  });

  const validateStep = (index: number): string | null => {
    switch (index) {
      case 0: return validateName(firstName, lastName) ?? validatePhone(phone);
      case 1: return validateDateOfBirth(dob, new Date());
      case 2: {
        const inchesValue = inches.trim() === '' ? 0 : Number(inches);
        if (heightUnit === 'ft-in' && (!Number.isInteger(inchesValue) || inchesValue < 0 || inchesValue > 11)) return 'Inches must be a whole number from 0 to 11.';
        return validateHeightCm(heightCm) ?? validateWeightKg(weightKg);
      }
      case 3: return validateSkinTone(skinTone);
      default: return null;
    }
  };

  const goTo = async (next: number) => {
    setError(null);
    setStep(next);
    try { await saveOnboardingDraft(userId, buildDraft(), next); }
    catch (err) { console.error('Onboarding draft save failed:', err); } // progress saving is best-effort
  };

  const handleContinue = async () => {
    const problem = validateStep(step);
    if (problem) return setError(problem);
    if (step < STEPS.length - 1) return goTo(step + 1);

    const profile = finalizeHealthProfile(buildDraft(), new Date());
    if (!profile || !session) return setError('Some details are missing. Go back and check each step.');
    setSaving(true);
    try {
      await completeOnboarding(session.userId, session.email, profile);
      markOnboarded();
    } catch (err) {
      console.error('Onboarding save failed:', err);
      setError('Could not save your profile. Please try again.');
      setSaving(false);
    }
  };

  if (!hydrated) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color={AuthColors.text} />
      </View>
    );
  }

  const isLast = step === STEPS.length - 1;
  const footer = (
    <>
      <PillButton
        label={isLast ? 'Finish' : 'Continue'}
        loadingLabel="Saving…"
        loading={saving}
        onPress={handleContinue}
      />
      {step > 0 ? (
        <PillButton label="Back" variant="secondary" disabled={saving} onPress={() => goTo(step - 1)} />
      ) : (
        <PillButton label="Sign out" variant="secondary" onPress={signOut} />
      )}
    </>
  );

  return (
    <FormScreen footer={footer}>
      <View style={styles.progressWrap}>
        <Text style={styles.stepCount}>Step {step + 1} of {STEPS.length}</Text>
        <View
          style={styles.progressTrack}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 1, max: STEPS.length, now: step + 1 }}
        >
          <View style={[styles.progressFill, { width: `${((step + 1) / STEPS.length) * 100}%` }]} />
        </View>
      </View>

      <Text style={styles.title} accessibilityRole="header">{STEPS[step]}</Text>

      {step === 0 && (
        <>
          <Text style={styles.body}>Let&apos;s set up your profile. This stays on your device for now.</Text>
          <ErrorBanner message={error} />
          <FormField
            label="First name"
            value={firstName}
            onChangeText={setFirstName}
            autoComplete="given-name"
            textContentType="givenName"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => lastNameRef.current?.focus()}
          />
          <FormField
            ref={lastNameRef}
            label="Last name"
            value={lastName}
            onChangeText={setLastName}
            autoComplete="family-name"
            textContentType="familyName"
            returnKeyType="next"
            submitBehavior="submit"
            onSubmitEditing={() => phoneRef.current?.focus()}
          />
          <FormField
            ref={phoneRef}
            label="Phone (optional)"
            value={phone}
            onChangeText={setPhone}
            keyboardType="phone-pad"
            autoComplete="tel"
            textContentType="telephoneNumber"
          />
        </>
      )}

      {step === 1 && (
        <>
          <Text style={styles.body}>Age is one of the factors that affects blood pressure.</Text>
          <ErrorBanner message={error} />
          <FormField
            label="Date of birth"
            hint="For example, 04/15/1990"
            value={dob}
            onChangeText={(text) => setDob(maskDate(text))}
            placeholder="MM/DD/YYYY"
            keyboardType="number-pad"
            autoComplete="birthdate-full"
            textContentType="birthdate"
            maxLength={10}
            returnKeyType="done"
            onSubmitEditing={handleContinue}
          />
        </>
      )}

      {step === 2 && (
        <>
          <Text style={styles.body}>Used to personalize your readings. Pick whichever units you prefer.</Text>
          <ErrorBanner message={error} />
          <UnitToggle
            label="Height units"
            options={[{ value: 'ft-in', label: 'ft / in' }, { value: 'cm', label: 'cm' }]}
            value={heightUnit}
            onChange={(unit) => {
              // Convert what was typed so switching units never loses data.
              if (Number.isFinite(heightCm)) {
                const { feet: ft, inches: inch } = cmToFeetInches(heightCm);
                setFeet(String(ft));
                setInches(String(inch));
                setCm(String(Math.round(heightCm * 10) / 10));
              }
              setHeightUnit(unit);
            }}
          />
          {heightUnit === 'ft-in' ? (
            <View style={styles.row}>
              <View style={styles.rowItem}>
                <FormField
                  label="Feet"
                  value={feet}
                  onChangeText={setFeet}
                  keyboardType="number-pad"
                  maxLength={1}
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => inchesRef.current?.focus()}
                />
              </View>
              <View style={styles.rowItem}>
                <FormField
                  ref={inchesRef}
                  label="Inches"
                  value={inches}
                  onChangeText={setInches}
                  keyboardType="number-pad"
                  maxLength={2}
                  returnKeyType="next"
                  submitBehavior="submit"
                  onSubmitEditing={() => weightRef.current?.focus()}
                />
              </View>
            </View>
          ) : (
            <FormField
              label="Height (cm)"
              value={cm}
              onChangeText={setCm}
              keyboardType="decimal-pad"
              maxLength={5}
              returnKeyType="next"
              submitBehavior="submit"
              onSubmitEditing={() => weightRef.current?.focus()}
            />
          )}
          <UnitToggle
            label="Weight units"
            options={[{ value: 'lb', label: 'lb' }, { value: 'kg', label: 'kg' }]}
            value={weightUnit}
            onChange={(unit) => {
              if (Number.isFinite(weightKg)) setWeight(String(Math.round(unit === 'kg' ? weightKg : kgToLb(weightKg))));
              setWeightUnit(unit);
            }}
          />
          <FormField
            ref={weightRef}
            label={`Weight (${weightUnit})`}
            value={weight}
            onChangeText={setWeight}
            keyboardType="decimal-pad"
            maxLength={5}
          />
        </>
      )}

      {step === 3 && (
        <>
          <Text style={styles.body}>
            The bracelet reads your pulse with light, and skin tone affects how that light is absorbed. Choose the closest match.
          </Text>
          <ErrorBanner message={error} />
          <View style={styles.swatchGrid} accessibilityRole="radiogroup" accessibilityLabel="Skin tone">
            {SKIN_TONES.map((color, index) => {
              const selected = skinTone === index;
              return (
                <Pressable
                  key={color}
                  onPress={() => { setSkinTone(index); setError(null); }}
                  accessibilityRole="radio"
                  accessibilityLabel={SKIN_TONE_LABELS[index]}
                  accessibilityState={{ selected }}
                  style={[styles.swatchRing, selected && styles.swatchRingSelected]}
                >
                  <View style={[styles.swatch, { backgroundColor: color }]}>
                    {selected ? <Ionicons name="checkmark" size={26} color={index < 3 ? '#000' : '#fff'} /> : null}
                  </View>
                </Pressable>
              );
            })}
          </View>
        </>
      )}

      {step === 4 && (
        <>
          <Text style={styles.body}>Check your details. You can change them later on the Profile tab.</Text>
          <ErrorBanner message={error} />
          <ReviewRow label="Name" value={`${firstName.trim()} ${lastName.trim()}`} onEdit={() => goTo(0)} />
          <ReviewRow label="Phone" value={phone.trim() || 'Not provided'} onEdit={() => goTo(0)} />
          <ReviewRow label="Date of birth" value={dob} onEdit={() => goTo(1)} />
          <ReviewRow label="Height" value={Number.isFinite(heightCm) ? formatHeight(heightCm, heightUnit) : '—'} onEdit={() => goTo(2)} />
          <ReviewRow label="Weight" value={Number.isFinite(weightKg) ? formatWeight(weightKg, weightUnit) : '—'} onEdit={() => goTo(2)} />
          <ReviewRow
            label="Skin tone"
            value={skinTone !== undefined ? SKIN_TONE_LABELS[skinTone] : '—'}
            swatch={skinTone !== undefined ? SKIN_TONES[skinTone] : undefined}
            onEdit={() => goTo(3)}
          />
        </>
      )}
    </FormScreen>
  );
}

function UnitToggle<T extends string>({ label, options, value, onChange }: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <View style={styles.toggle} accessibilityRole="radiogroup" accessibilityLabel={label}>
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            style={[styles.toggleOption, selected && styles.toggleOptionSelected]}
          >
            <Text style={[styles.toggleText, selected && styles.toggleTextSelected]}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function ReviewRow({ label, value, swatch, onEdit }: { label: string; value: string; swatch?: string; onEdit: () => void }) {
  return (
    <View style={styles.reviewRow}>
      <View style={styles.reviewText}>
        <Text style={styles.reviewLabel}>{label}</Text>
        <View style={styles.reviewValueRow}>
          {swatch ? <View style={[styles.reviewSwatch, { backgroundColor: swatch }]} /> : null}
          <Text style={styles.reviewValue}>{value}</Text>
        </View>
      </View>
      <Pressable onPress={onEdit} hitSlop={12} accessibilityRole="button" accessibilityLabel={`Edit ${label.toLowerCase()}`}>
        <Text style={styles.editLink}>Edit</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff' },
  progressWrap: { marginTop: 16, marginBottom: 24 },
  stepCount: { fontSize: 14, fontWeight: '600', color: AuthColors.muted, marginBottom: 8 },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: AuthColors.tint, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 3, backgroundColor: AuthColors.text },
  title: { fontSize: 28, fontWeight: '700', color: AuthColors.text, marginBottom: 8 },
  body: { fontSize: 16, color: AuthColors.muted, lineHeight: 22, marginBottom: 24 },
  row: { flexDirection: 'row', gap: 12 },
  rowItem: { flex: 1 },
  toggle: {
    flexDirection: 'row',
    alignSelf: 'flex-start',
    borderWidth: 1,
    borderColor: AuthColors.borderStrong,
    borderRadius: 999,
    padding: 3,
    marginBottom: 16,
  },
  toggleOption: { paddingVertical: 8, paddingHorizontal: 18, borderRadius: 999, minWidth: 64, alignItems: 'center' },
  toggleOptionSelected: { backgroundColor: AuthColors.text },
  toggleText: { fontSize: 15, fontWeight: '600', color: AuthColors.text },
  toggleTextSelected: { color: '#fff' },
  swatchGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', rowGap: 20 },
  swatchRing: { width: '30%', aspectRatio: 1, borderRadius: 999, padding: 5, borderWidth: 3, borderColor: 'transparent' },
  swatchRingSelected: { borderColor: AuthColors.focus },
  swatch: {
    flex: 1,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: AuthColors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: AuthColors.border,
  },
  reviewText: { flex: 1 },
  reviewLabel: { fontSize: 14, color: AuthColors.muted, marginBottom: 2 },
  reviewValueRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  reviewSwatch: { width: 18, height: 18, borderRadius: 9, borderWidth: 1, borderColor: AuthColors.border },
  reviewValue: { fontSize: 17, color: AuthColors.text },
  editLink: { fontSize: 16, fontWeight: '600', color: AuthColors.text, textDecorationLine: 'underline' },
});
