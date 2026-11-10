const test = require('node:test');
const assert = require('node:assert/strict');
const {selectLowMotionSegments} = require('../../../services/device/motion-selection');

function synthImu({seconds = 40, rate = 50, motionFn}) {
  const samples = [];
  for (let i = 0; i < seconds * rate; i++) {
    const t = (i * 1000) / rate;
    const m = motionFn(t, i);
    samples.push([i, t, m[0], m[1], 9.81 + m[2], 0, 0, 0, 0]);
  }
  return samples;
}

test('selects bounded low-motion candidates and yields none when all windows are bad', () => {
  const rest = synthImu({ motionFn: () => [0.01, -0.01, 0] });
  const good = selectLowMotionSegments(rest, { windowDurationSec: 5, stepSec: 1, maxCandidates: 2, motionRmsMax: 0.2 });
  assert.equal(good.allBad, false);
  assert.ok(good.selected.length <= 2);
  assert.equal(good.hardwareValidated, false);

  const walk = synthImu({ motionFn: (t) => [Math.sin(t / 50) * 3, Math.cos(t / 40) * 3, 0] });
  const bad = selectLowMotionSegments(walk, { windowDurationSec: 5, stepSec: 1, maxCandidates: 3, motionRmsMax: 0.2 });
  assert.equal(bad.allBad, true);
  assert.equal(bad.selected.length, 0);
});
