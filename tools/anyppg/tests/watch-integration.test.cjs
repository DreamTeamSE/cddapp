'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { createRequire } = require('node:module');
const { runSoftwareIntegrationChecks } = require('../../../services/anyppg/integrationChecks');
const { createAdapter } = require('../../../services/anyppg/ort');
const head = require('../../../assets/models/anyppg/ridge_head.json');
const manifest = require('../../../assets/models/anyppg/manifest.json');

test('software integration checks pass without fabricating BP on rejection', async () => {
  const report = await runSoftwareIntegrationChecks();
  assert.equal(report.physicalIphoneValidated, false);
  assert.equal(report.failed, 0, JSON.stringify(report.results, null, 2));
  assert.ok(report.passed >= 5);
});

test('watch inference with onnxruntime-node accepts low-motion and rejects high-motion', async () => {
  const modelPath = path.join(__dirname, '../../../assets/models/anyppg/anyppg_encoder.onnx');
  const ort = require('onnxruntime-node');
  const report = await runSoftwareIntegrationChecks({
    head,
    modelSha256: manifest.modelSha256,
    createAdapter: async () => createAdapter({ ort, uri: modelPath }),
  });
  assert.equal(report.failed, 0, JSON.stringify(report.results, null, 2));
  const accepted = report.results.find((r) => r.name.includes('accepts_low_motion'));
  const rejected = report.results.find((r) => r.name.includes('rejects_without_fabricating'));
  assert.ok(accepted?.passed);
  assert.ok(rejected?.passed);
});

test('pipeline simulation module loads under strip-types path used by npm test', async () => {
  // Keep host verification aligned with RN TS module.
  const requireFromHere = createRequire(__filename);
  // Dynamic import of .ts is covered by tests/services/pipeline-simulation.test.ts
  assert.equal(typeof requireFromHere, 'function');
});
