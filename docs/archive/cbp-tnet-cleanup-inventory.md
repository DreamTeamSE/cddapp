# cBP-Tnet cleanup inventory (AnyPPG standardization)

**Branch:** `feature/ppg-pipeline-improvements`  
**Date:** 2026-11-09  
**Policy:** AnyPPG is the only active BP inference model. Historical cBP-Tnet research is archived, not deleted from project history.

## A. Remove from active application (obsolete inference UI/services)

These are only used by the old cBP-Tnet smoke/expanded/chain/profile screens and are safe to delete from the live app tree after references are cleared.

### Screens
- `app/ml-test.tsx`
- `app/ml-ppg-test.tsx`
- `app/ml-ppg-chain.tsx`
- `app/ml-ppg-expanded.tsx`
- `app/ml-profile.tsx`
- `app/ml-memory.tsx`

### UI links
- `components/BpSmokeTestLink.tsx`
- `components/BpExpandedLink.tsx`
- `components/BpPpgChainLink.tsx`
- `components/BpPpgPreprocessingLink.tsx`

### Services (cBP-Tnet-only adapters)
- `services/bpSmokeTest.ts`, `bpSmokeTest.native.ts`, `bpSmokeTest.types.ts`
- `services/bpExpanded.ts`, `bpExpanded.native.ts`, `bpExpandedCore.js`, `bpExpandedCore.d.ts`
- `services/bpPpgChain.ts`, `bpPpgChain.native.ts`, `bpPpgChainCore.js`, `bpPpgChainCore.d.ts`, `bpPpgChainOrt.js`, `bpPpgChainOrt.d.ts`
- `services/bpPpgPreprocess.js`, `bpPpgPreprocess.d.ts`
- `services/bpSyntheticProfile.ts`, `bpSyntheticProfile.native.ts`, `bpSyntheticProfile.types.ts`, `bpSyntheticProfile.install.json`
- `services/bpMemoryProfile.ts`, `bpMemoryProfile.native.ts`, `bpMemoryProfile.install.json`
- `services/bpMemoryProtocol.js`, `bpMemoryProtocol.d.ts`
- `services/bpProfileStats.js`, `bpProfileStats.d.ts`

### Active bundled cBP model/fixtures (moved to archive, not kept under `assets/` for Metro)
- `assets/models/onnx_export/**` (`cbp_tnet.onnx`, `normalization.json`, …)
- `assets/ppg-chain/**`, `assets/ppg-expanded/**`, `assets/ppg-reference/**`

### Obsolete setup/verify scripts for cBP packaging
- `tools/setup/setup_iphone_test.cjs`
- `tools/tests/bp_adapter_checks.cjs`
- `tools/tests/bp_replay_checks.cjs`
- `tools/tests/verify_bp_package.py`

## B. Archive (historical research — retain, not active inference)

Moved under `archive/cbp-tnet/`:
- `python code/cBP-Tnet_Model.pth`
- `python code/cbp_tnet_train_v4_final.py`
- `python code/export_iphone_onnx.py`
- `python code/submit_cbp_tnet_final.sbatch`
- `tools/research/compare_cbp_augmentation.py`
- Active model/fixture directories listed above

Historical docs/evidence left in place but labeled historical:
- `docs/evidence/**` (expanded/cBP iPhone reports)
- `documentation/Published_Model_Comparison_Results.md`
- `documentation/benchmark_summary.json`
- `docs/CDD_Blood_Pressure_Engineering_Status_and_Calibration.md` (and documentation/ copy)
- `iphone-test-backups/**` (**review** — keep; contains mixed historical snapshots)

## C. Retain (required for AnyPPG / hardware / #7–#16)

- `services/anyppg/**`, `assets/models/anyppg/**`, `tools/anyppg/**`, `components/BpCsvCard.tsx`
- `services/device/**`, `services/measurement/**`, `services/recordings/**` (incl. sync contract + quality gate)
- `services/readings/**`, `services/prediction/**`, `services/sync/**`, `services/database.ts`
- `services/bp-calibration-research/**` (calibration research helpers; not cBP inference)
- `app/ml-recording.tsx`, `app/ml-calibration-log.tsx` (recording inspect + cuff log; beat-preview removed)
- `tools/recordings/**` firmware/logger/tests
- `docs/recording-contract.md`, `docs/anyppg-watch-compatibility.md`, `CDD_Next_Tasks_Roadmap.md`
- Metro `.onnx` asset support (needed by AnyPPG)

## D. Requires review (preserved)

| Path | Why preserved |
|---|---|
| `iphone-test-backups/**` | Historical device snapshots; may contain outdated imports |
| `tools/research/recording_comparison/**` | Mixed AnyPPG + CNN research; still useful for #13 |
| `docs/evidence/**` | Immutable historical evidence; do not rewrite numbers |
| Duplicate `documentation/` vs `docs/` copies of engineering narratives | Content overlap; consolidate later |
| `services/recordings/recordingCore.js` engineering `previewAllowed` flag | Kept as transport/diagnostics gate after removing cBP beat extraction |

## E. Explicit non-goals

- Do not retrain or replace AnyPPG weights
- Do not modify customized `ios/` project for this cleanup
- Do not claim physical BLE/device tests passed
