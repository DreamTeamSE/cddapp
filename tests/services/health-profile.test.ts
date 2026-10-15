import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  ageFromDateOfBirth,
  cmToFeetInches,
  feetInchesToCm,
  finalizeHealthProfile,
  formatHeight,
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
} from '../../services/profile/health-profile.ts';

const now = new Date(2026, 9, 7); // Oct 7 2026, local time

describe('health profile onboarding data', () => {
  it('converts imperial units to canonical cm/kg and back without drift', () => {
    const cm = feetInchesToCm(5, 10);
    assert.equal(Math.round(cm * 10) / 10, 177.8);
    assert.deepEqual(cmToFeetInches(cm), { feet: 5, inches: 10 });
    assert.equal(Math.round(kgToLb(lbToKg(165))), 165);
    assert.equal(formatHeight(cm, 'ft-in'), '5 ft. 10 in.');
    assert.equal(formatWeight(lbToKg(165), 'lb'), '165 lb');
    assert.equal(formatWeight(70, 'kg'), '70 kg');
  });

  it('parses MM/DD/YYYY and rejects impossible dates', () => {
    assert.equal(parseUsDate('01/31/2001'), '2001-01-31');
    assert.equal(parseUsDate('02/30/2001'), null);
    assert.equal(parseUsDate('13/01/2001'), null);
    assert.equal(parseUsDate('1/1/2001'), null);
  });

  it('computes age around the birthday boundary', () => {
    assert.equal(ageFromDateOfBirth('2000-10-07', now), 26);
    assert.equal(ageFromDateOfBirth('2000-10-08', now), 25);
  });

  it('enforces adult age, future dates, and malformed input', () => {
    assert.equal(validateDateOfBirth('10/07/2000', now), null);
    assert.match(validateDateOfBirth('10/08/2008', now) ?? '', /at least 18/);
    assert.match(validateDateOfBirth('01/01/2030', now) ?? '', /future/);
    assert.match(validateDateOfBirth('2000-10-07', now) ?? '', /MM\/DD\/YYYY/);
  });

  it('validates names, optional phone, plausible body measurements, and skin tone', () => {
    assert.ok(validateName('', 'Lee'));
    assert.equal(validateName('Pat', 'Lee'), null);
    assert.equal(validatePhone(''), null);
    assert.equal(validatePhone('(352) 555-0100'), null);
    assert.ok(validatePhone('555'));
    assert.equal(validateHeightCm(170), null);
    assert.ok(validateHeightCm(Number.NaN));
    assert.ok(validateHeightCm(300));
    assert.equal(validateWeightKg(70), null);
    assert.ok(validateWeightKg(10));
    assert.equal(validateSkinTone(5), null);
    assert.ok(validateSkinTone(6));
    assert.ok(validateSkinTone(undefined));
  });

  it('finalizes only a complete, valid draft and trims text fields', () => {
    const draft = { firstName: ' Pat ', lastName: 'Lee', phone: '', dateOfBirth: '2000-10-07', heightCm: 177.8, weightKg: 75, skinTone: 2 };
    const profile = finalizeHealthProfile(draft, now);
    if (!profile) throw new Error('expected a finalized profile');
    assert.equal(profile.firstName, 'Pat');
    assert.equal(profile.preferredHeightUnit, 'ft-in');
    assert.equal(finalizeHealthProfile({ ...draft, skinTone: undefined }, now), null);
    assert.equal(finalizeHealthProfile({ ...draft, dateOfBirth: '2015-01-01' }, now), null);
  });
});
