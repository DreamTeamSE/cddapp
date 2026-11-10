'use strict';
/**
 * Motion-triggered PPG activation experiment flag (issue #14).
 * Disabled by default until hardware power/coverage comparison exists.
 */
const DEFAULT = Object.freeze({
  enabled: false,
  featureFlag: 'motion_triggered_ppg_v0',
  settlingExcludeMs: 500,
  hardwareValidated: false,
  note: 'Keep continuous/periodic capture as default until #13/#14 measurements exist.',
});

function getMotionTriggerConfig(overrides = {}) {
  return { ...DEFAULT, ...overrides, featureFlag: DEFAULT.featureFlag };
}

function shouldActivatePpg(motionStill, config = DEFAULT) {
  if (!config.enabled) return { activate: false, reason: 'feature_disabled' };
  if (!motionStill) return { activate: false, reason: 'motion_present' };
  return { activate: true, reason: 'stillness_detected' };
}

module.exports = { getMotionTriggerConfig, shouldActivatePpg, DEFAULT_MOTION_TRIGGER: DEFAULT };
