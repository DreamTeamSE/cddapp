'use strict';
/**
 * Synchronized PPG + IMU recording contract (cdd_ppg_imu_recording_v1).
 * Transport/schema validation only — no BP inference and no clinical SQI claims.
 */
const CONTRACT = 'cdd_ppg_imu_recording_v1';
const PREPROCESSING_VERSION = 'anyppg_watch_prep_v1';
const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_PPG_SAMPLES = 60000;
const MAX_IMU_SAMPLES = 120000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const TOP_KEYS = [
  'schemaVersion', 'kind', 'recordingId', 'deviceId', 'sessionId', 'intervalId',
  'captureStartedAt', 'uploadedAt', 'ppg', 'imu', 'alignment', 'sensorSettings', 'transfer',
];
const OPTIONAL_TOP = ['qualityHints'];

const need = (ok, message) => { if (!ok) throw new Error(message); };
const finite = (v) => typeof v === 'number' && Number.isFinite(v);
const object = (v, label) => { need(v && typeof v === 'object' && !Array.isArray(v), label + ' must be an object.'); };
const text = (v, label) => { need(typeof v === 'string' && v.trim().length > 0 && v.length <= 160, label + ' must be 1–160 characters.'); };
const id = (v, label) => { need(typeof v === 'string' && ID_RE.test(v), label + ' must match [A-Za-z0-9_-]{1,64}.'); };

function utcMs(v, label) {
  need(typeof v === 'string', label + ' must be a string.');
  const date = Date.parse(v);
  need(Number.isFinite(date) && new Date(date).toISOString() === v, label + ' must be UTC ISO with milliseconds.');
}

function exactKeys(v, required, optional, label) {
  object(v, label);
  const keys = Object.keys(v);
  const allowed = new Set([...required, ...optional]);
  need(keys.every((k) => allowed.has(k)), label + ' contains unsupported fields.');
  need(required.every((k) => Object.prototype.hasOwnProperty.call(v, k)), label + ' is missing a required field.');
}

function utf8Bytes(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 128) n++;
    else if (c < 2048) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length && s.charCodeAt(i + 1) >= 0xdc00 && s.charCodeAt(i + 1) <= 0xdfff) { n += 4; i++; }
    else n += 3;
  }
  return n;
}

function validateChannel(ch, label) {
  exactKeys(ch, ['available', 'wavelengthNm', 'units', 'provenance', 'adcMin', 'adcMax'], [], label);
  need(typeof ch.available === 'boolean', label + '.available must be boolean.');
  need(ch.wavelengthNm === null || (finite(ch.wavelengthNm) && ch.wavelengthNm > 0), label + '.wavelengthNm invalid.');
  text(ch.units, label + '.units');
  need(['raw_adc', 'firmware_filtered'].includes(ch.provenance), label + '.provenance must be raw_adc or firmware_filtered.');
  const low = ch.adcMin, high = ch.adcMax;
  need((low === null && high === null) || (finite(low) && finite(high) && low < high), label + ' ADC limits invalid.');
}

function validatePpg(ppg) {
  exactKeys(ppg, ['sampleRateHz', 'timingSource', 'channels', 'samples'], [], 'ppg');
  need(finite(ppg.sampleRateHz) && ppg.sampleRateHz >= 1 && ppg.sampleRateHz <= 2000, 'ppg.sampleRateHz out of range.');
  need(['sensor', 'sample_clock'].includes(ppg.timingSource), 'ppg.timingSource must be sensor or sample_clock.');
  exactKeys(ppg.channels, ['red', 'infrared'], [], 'ppg.channels');
  validateChannel(ppg.channels.red, 'ppg.channels.red');
  validateChannel(ppg.channels.infrared, 'ppg.channels.infrared');
  need(ppg.channels.red.available || ppg.channels.infrared.available, 'At least one PPG channel must be available.');
  need(Array.isArray(ppg.samples) && ppg.samples.length >= 2 && ppg.samples.length <= MAX_PPG_SAMPLES, 'ppg.samples length invalid.');
  for (const row of ppg.samples) {
    need(Array.isArray(row) && row.length === 5, 'Each PPG sample must be [seq, offset_ms, red, ir, missing_flag].');
    need(Number.isSafeInteger(row[0]) && row[0] >= 0, 'PPG sequence invalid.');
    need(finite(row[1]) && row[1] >= 0 && row[1] <= 86400000, 'PPG offset_ms invalid.');
    need(row[4] === 0 || row[4] === 1, 'PPG missing_flag must be 0 or 1.');
    for (const [idx, name, available] of [[2, 'red', ppg.channels.red.available], [3, 'infrared', ppg.channels.infrared.available]]) {
      if (row[4] === 1 || !available) {
        need(row[idx] === null || (finite(row[idx]) && Number.isFinite(Math.fround(row[idx]))), 'PPG ' + name + ' value invalid.');
      } else {
        need(finite(row[idx]) && Number.isFinite(Math.fround(row[idx])), 'PPG ' + name + ' value must be finite.');
      }
    }
  }
}

function validateImu(imu) {
  exactKeys(imu, ['accelSampleRateHz', 'gyroSampleRateHz', 'accelUnits', 'gyroUnits', 'timingSource', 'samples'], [], 'imu');
  need(finite(imu.accelSampleRateHz) && imu.accelSampleRateHz >= 1 && imu.accelSampleRateHz <= 2000, 'imu.accelSampleRateHz invalid.');
  need(finite(imu.gyroSampleRateHz) && imu.gyroSampleRateHz >= 1 && imu.gyroSampleRateHz <= 2000, 'imu.gyroSampleRateHz invalid.');
  need(imu.accelUnits === 'm/s^2', 'imu.accelUnits must be m/s^2.');
  need(imu.gyroUnits === 'rad/s', 'imu.gyroUnits must be rad/s.');
  need(['sensor', 'sample_clock'].includes(imu.timingSource), 'imu.timingSource invalid.');
  need(Array.isArray(imu.samples) && imu.samples.length >= 2 && imu.samples.length <= MAX_IMU_SAMPLES, 'imu.samples length invalid.');
  for (const row of imu.samples) {
    need(Array.isArray(row) && row.length === 9, 'Each IMU sample must be [seq, offset_ms, ax, ay, az, gx, gy, gz, missing_flag].');
    need(Number.isSafeInteger(row[0]) && row[0] >= 0, 'IMU sequence invalid.');
    need(finite(row[1]) && row[1] >= 0 && row[1] <= 86400000, 'IMU offset_ms invalid.');
    need(row[8] === 0 || row[8] === 1, 'IMU missing_flag must be 0 or 1.');
    for (let i = 2; i <= 7; i++) {
      if (row[8] === 1) need(row[i] === null || (finite(row[i]) && Number.isFinite(Math.fround(row[i]))), 'IMU axis invalid.');
      else need(finite(row[i]) && Number.isFinite(Math.fround(row[i])), 'IMU axis must be finite.');
    }
  }
}

function validateRecording(input) {
  exactKeys(input, TOP_KEYS, OPTIONAL_TOP, 'recording');
  need(input.schemaVersion === 1, 'Unsupported schemaVersion.');
  need(input.kind === CONTRACT, 'Unsupported recording kind. Expected ' + CONTRACT + '.');
  for (const k of ['recordingId', 'deviceId', 'sessionId', 'intervalId']) id(input[k], k);
  utcMs(input.captureStartedAt, 'captureStartedAt');
  if (input.uploadedAt !== null) utcMs(input.uploadedAt, 'uploadedAt');
  validatePpg(input.ppg);
  validateImu(input.imu);
  exactKeys(input.alignment, ['clockDomain', 'ppgImuToleranceMs', 'ppgEpochOffsetMs', 'imuEpochOffsetMs'], [], 'alignment');
  need(input.alignment.clockDomain === 'device_monotonic', 'alignment.clockDomain must be device_monotonic.');
  need(finite(input.alignment.ppgImuToleranceMs) && input.alignment.ppgImuToleranceMs >= 0 && input.alignment.ppgImuToleranceMs <= 1000, 'alignment.ppgImuToleranceMs invalid.');
  need(finite(input.alignment.ppgEpochOffsetMs), 'alignment.ppgEpochOffsetMs invalid.');
  need(finite(input.alignment.imuEpochOffsetMs), 'alignment.imuEpochOffsetMs invalid.');
  object(input.sensorSettings, 'sensorSettings');
  exactKeys(input.transfer, ['schemaVersion', 'chunkCount', 'chunkIndex', 'payloadSha256', 'encoding'], [], 'transfer');
  need(input.transfer.schemaVersion === 1, 'transfer.schemaVersion must be 1.');
  need(Number.isSafeInteger(input.transfer.chunkCount) && input.transfer.chunkCount >= 1, 'transfer.chunkCount invalid.');
  need(Number.isSafeInteger(input.transfer.chunkIndex) && input.transfer.chunkIndex >= 0 && input.transfer.chunkIndex < input.transfer.chunkCount, 'transfer.chunkIndex invalid.');
  need(input.transfer.payloadSha256 === null || (typeof input.transfer.payloadSha256 === 'string' && /^[a-f0-9]{64}$/.test(input.transfer.payloadSha256)), 'transfer.payloadSha256 must be null or 64-char lowercase hex.');
  need(input.transfer.encoding === 'json_recording_v1', 'transfer.encoding unsupported.');
  if (input.qualityHints !== undefined) object(input.qualityHints, 'qualityHints');
  return input;
}

function parseSyncRecordingJson(json) {
  need(typeof json === 'string' && json.length <= MAX_FILE_BYTES && utf8Bytes(json) <= MAX_FILE_BYTES, 'Recording exceeds the 8 MiB import limit.');
  let r;
  try { r = JSON.parse(json); } catch { throw new Error('Invalid JSON for synchronized recording.'); }
  return validateRecording(r);
}

function streamStats(samples, seqIndex, timeIndex, missingIndex) {
  let missing = 0, duplicate = 0, order = 0, nonIncreasing = 0, declaredMissing = 0;
  const seen = new Set();
  for (let i = 0; i < samples.length; i++) {
    const seq = samples[i][seqIndex], t = samples[i][timeIndex], flag = samples[i][missingIndex];
    if (flag === 1) declaredMissing++;
    if (seen.has(seq)) duplicate++;
    seen.add(seq);
    if (i) {
      const ds = seq - samples[i - 1][seqIndex];
      const dt = t - samples[i - 1][timeIndex];
      if (ds < 0) order++;
      if (ds > 1) missing += ds - 1;
      if (dt <= 0) nonIncreasing++;
    }
  }
  return { missing, duplicate, order, nonIncreasing, declaredMissing, count: samples.length };
}

function inspectSyncRecording(input) {
  const r = validateRecording(input);
  const ppg = streamStats(r.ppg.samples, 0, 1, 4);
  const imu = streamStats(r.imu.samples, 0, 1, 8);
  const blockers = [];
  const warnings = [];
  if (ppg.duplicate || ppg.order || ppg.nonIncreasing) blockers.push('PPG stream has duplicate, reversed, or non-increasing timing/sequence.');
  if (imu.duplicate || imu.order || imu.nonIncreasing) blockers.push('IMU stream has duplicate, reversed, or non-increasing timing/sequence.');
  if (ppg.missing) blockers.push(`${ppg.missing} undeclared PPG sequence gaps.`);
  if (imu.missing) blockers.push(`${imu.missing} undeclared IMU sequence gaps.`);

  // Cheap polarity-agnostic flatline screen on available present samples.
  for (const [name, col, available] of [['red', 2, r.ppg.channels.red.available], ['infrared', 3, r.ppg.channels.infrared.available]]) {
    if (!available) continue;
    const vals = r.ppg.samples.filter((row) => row[4] === 0).map((row) => row[col]).filter((v) => v !== null);
    if (vals.length >= 2 && vals.every((v) => v === vals[0])) blockers.push(`PPG ${name} channel is completely flat.`);
  }

  const ppgStart = r.ppg.samples[0][1] + r.alignment.ppgEpochOffsetMs;
  const imuStart = r.imu.samples[0][1] + r.alignment.imuEpochOffsetMs;
  if (Math.abs(ppgStart - imuStart) > r.alignment.ppgImuToleranceMs) {
    blockers.push('PPG and IMU epoch starts exceed alignment tolerance.');
  }

  if (r.ppg.channels.red.provenance === 'firmware_filtered' || r.ppg.channels.infrared.provenance === 'firmware_filtered') {
    warnings.push('Firmware-filtered PPG is declared; avoid applying a second undocumented filter before AnyPPG.');
  }
  warnings.push('Engineering schema checks do not establish pulse quality or BP accuracy.');
  warnings.push('AFE4404/BMI270 rates and LED/gain settings remain hardware-unconfirmed unless populated.');

  return {
    schemaVersion: 1,
    contract: CONTRACT,
    preprocessingVersion: PREPROCESSING_VERSION,
    recordingId: r.recordingId,
    deviceId: r.deviceId,
    sessionId: r.sessionId,
    intervalId: r.intervalId,
    ppgSampleRateHz: r.ppg.sampleRateHz,
    accelSampleRateHz: r.imu.accelSampleRateHz,
    gyroSampleRateHz: r.imu.gyroSampleRateHz,
    ppg,
    imu,
    alignmentOk: !blockers.some((b) => b.includes('alignment')),
    schemaAccepted: blockers.length === 0,
    blockers,
    warnings,
    hardwareValidated: false,
    modelInferenceRun: false,
  };
}

function makeDemoSyncRecording(overrides = {}) {
  const ppgRate = 100;
  const imuRate = 100;
  const seconds = Number.isFinite(overrides.seconds) ? overrides.seconds : 3;
  const motion = overrides.motion === 'high' ? 'high' : 'low';
  const {seconds: _seconds, motion: _motion, ...rest} = overrides;
  const ppgSamples = [];
  const imuSamples = [];
  for (let i = 0; i < ppgRate * seconds; i++) {
    const t = (i * 1000) / ppgRate;
    const wave = Math.fround(500000 + 2000 * Math.sin((2 * Math.PI * 1.2 * i) / ppgRate));
    ppgSamples.push([i, t, wave, Math.fround(wave * 0.98), 0]);
  }
  for (let i = 0; i < imuRate * seconds; i++) {
    const t = (i * 1000) / imuRate;
    const shake = motion === 'high' ? Math.sin(i / 3) * 4 : 0.05;
    imuSamples.push([i, t, shake, motion === 'high' ? Math.cos(i / 4) * 4 : -0.02, 9.81, 0.001, -0.002, 0.0, 0]);
  }
  return validateRecording({
    schemaVersion: 1,
    kind: CONTRACT,
    recordingId: rest.recordingId || 'sync-demo-001',
    deviceId: 'proto-watch-001',
    sessionId: 'session-demo-001',
    intervalId: 'interval-20261109T170000Z',
    captureStartedAt: '2026-11-09T17:00:00.000Z',
    uploadedAt: null,
    ppg: {
      sampleRateHz: ppgRate,
      timingSource: 'sample_clock',
      channels: {
        red: { available: true, wavelengthNm: 660, units: 'adc_counts', provenance: 'raw_adc', adcMin: 0, adcMax: 1048575 },
        infrared: { available: true, wavelengthNm: 950, units: 'adc_counts', provenance: 'raw_adc', adcMin: 0, adcMax: 1048575 },
      },
      samples: ppgSamples,
    },
    imu: {
      accelSampleRateHz: imuRate,
      gyroSampleRateHz: imuRate,
      accelUnits: 'm/s^2',
      gyroUnits: 'rad/s',
      timingSource: 'sample_clock',
      samples: imuSamples,
    },
    alignment: { clockDomain: 'device_monotonic', ppgImuToleranceMs: 5, ppgEpochOffsetMs: 0, imuEpochOffsetMs: 0 },
    sensorSettings: {
      optical: { afe: 'AFE4404', emitter: 'SFH7050A', ledCurrentMa: null, gain: 'unconfirmed', site: 'wrist_unconfirmed' },
      imu: { model: 'BMI270', accelRangeG: null, gyroRangeDps: null },
      firmwareVersion: 'unconfirmed',
    },
    transfer: { schemaVersion: 1, chunkCount: 1, chunkIndex: 0, payloadSha256: null, encoding: 'json_recording_v1' },
    qualityHints: { motionProfile: motion, synthetic: true, newWatchHardwareValidated: false },
    ...rest,
  });
}

module.exports = {
  CONTRACT,
  PREPROCESSING_VERSION,
  MAX_FILE_BYTES,
  MAX_PPG_SAMPLES,
  MAX_IMU_SAMPLES,
  validateRecording,
  parseSyncRecordingJson,
  inspectSyncRecording,
  makeDemoSyncRecording,
};
