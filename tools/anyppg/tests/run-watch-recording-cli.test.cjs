'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const cli = path.join(__dirname, '../run-watch-recording.cjs');
const fixtures = path.join(__dirname, '../../../tests/fixtures/sync-recordings');

function runCli(fixtureName) {
  return spawnSync(process.execPath, [cli, path.join(fixtures, fixtureName)], {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

test('CLI accepts low-motion fixture', () => {
  const result = runCli('accept-low-motion-32s.json');
  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'accepted');
  assert.ok(Number.isFinite(report.sbp));
  assert.ok(Number.isFinite(report.dbp));
});

test('CLI rejects high-motion fixture with exit 2', () => {
  const result = runCli('reject-high-motion-32s.json');
  assert.equal(result.status, 2, result.stderr || result.stdout);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'rejected');
});
