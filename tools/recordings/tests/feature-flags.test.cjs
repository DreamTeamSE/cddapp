const test = require('node:test');
const assert = require('node:assert/strict');
const trigger = require('../../../services/device/motion-trigger');
const denoise = require('../../../services/device/imu-denoise');

test('motion-triggered capture stays disabled by default', () => {
  const config = trigger.getMotionTriggerConfig();
  assert.equal(config.enabled, false);
  assert.equal(trigger.shouldActivatePpg(true, config).activate, false);
});

test('IMU denoise stays disabled and preserves original samples', () => {
  const samples = [1, 2, 3];
  const config = denoise.getImuDenoiseConfig();
  assert.equal(config.enabled, false);
  const result = denoise.maybeDenoisePpg(samples, [], config);
  assert.equal(result.applied, false);
  assert.equal(result.originalPreserved, true);
  assert.strictEqual(result.samples, samples);
});
