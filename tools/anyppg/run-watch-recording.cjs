#!/usr/bin/env node
'use strict';
/**
 * Host CLI: sync JSON → motion crop → quality gate → AnyPPG ONNX.
 * Usage: node tools/anyppg/run-watch-recording.cjs <path-to-recording.json>
 * Exit 0 on accepted estimate; 2 on quality reject; 1 on error.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseSyncRecordingJson } = require('../../services/recordings/syncContract');
const { runWatchRecording } = require('../../services/anyppg/watchInference');
const { createAdapter } = require('../../services/anyppg/ort');

async function main(argv) {
  const file = argv[2];
  if (!file) {
    console.error('Usage: node tools/anyppg/run-watch-recording.cjs <recording.json>');
    process.exit(1);
  }
  const abs = path.resolve(file);
  const json = fs.readFileSync(abs, 'utf8');
  const recording = parseSyncRecordingJson(json);
  const modelPath = path.join(__dirname, '../../assets/models/anyppg/anyppg_encoder.onnx');
  const head = require('../../assets/models/anyppg/ridge_head.json');
  const manifest = require('../../assets/models/anyppg/manifest.json');
  const ort = require('onnxruntime-node');

  const report = await runWatchRecording(recording, {
    createAdapter: async () => createAdapter({ ort, uri: modelPath }),
    head,
    modelSha256: manifest.modelSha256,
  });

  const out = {
    file: abs,
    status: report.status,
    qualityDecision: report.qualityDecision,
    rejectionReasons: report.rejectionReasons,
    selectedWindow: report.selectedWindow ?? null,
    signalProvenance: report.signalProvenance ?? null,
    sbp: report.sbp ?? null,
    dbp: report.dbp ?? null,
    processingMs: report.processingMs,
    error: report.error,
  };
  console.log(JSON.stringify(out, null, 2));
  if (report.status === 'accepted') process.exit(0);
  if (report.status === 'rejected') process.exit(2);
  process.exit(1);
}

main(process.argv).catch((error) => {
  console.error(JSON.stringify({ status: 'error', error: String(error) }, null, 2));
  process.exit(1);
});
