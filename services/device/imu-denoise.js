'use strict';
/**
 * IMU-assisted denoising experiment flag (issue #15).
 * Disabled by default. Must not alter production PPG unless held-out BP improves.
 */
const DEFAULT = Object.freeze({
  enabled: false,
  featureFlag: 'imu_nlms_denoise_v0',
  method: 'nlms_candidate',
  hardwareValidated: false,
  note: 'Preserve original samples; compare morphology and BP error before enabling.',
});

function getImuDenoiseConfig(overrides = {}) {
  return { ...DEFAULT, ...overrides, featureFlag: DEFAULT.featureFlag, method: DEFAULT.method };
}

/** Identity passthrough while disabled — never mutates input. */
function maybeDenoisePpg(ppgSamples, _imuSamples, config = DEFAULT) {
  if (!config.enabled) {
    return {
      samples: ppgSamples,
      applied: false,
      reason: 'feature_disabled',
      originalPreserved: true,
    };
  }
  // No production algorithm yet — refuse silent “smoothing”.
  return {
    samples: ppgSamples,
    applied: false,
    reason: 'algorithm_not_implemented',
    originalPreserved: true,
  };
}

module.exports = { getImuDenoiseConfig, maybeDenoisePpg, DEFAULT_IMU_DENOISE: DEFAULT };
