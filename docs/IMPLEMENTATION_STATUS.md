# Implementation status — GitHub issues #7–#16

**Branch:** `feature/ppg-pipeline-improvements`  
**Updated:** November 9, 2026  
**Active BP model:** AnyPPG only (`anyppg_frozen_ridge_raw_v1`) via `onnxruntime-react-native`

A software module or unit test is **not** enough to mark an issue fully complete. Status below separates **software contracts**, **app wiring**, and **hardware-validated behavior**.

Issue links assume the DreamTeamSE repository:  
https://github.com/DreamTeamSE/cddapp/issues/

---

## Summary table

| Issue | Topic | Status |
|---|---|---|
| [#7](https://github.com/DreamTeamSE/cddapp/issues/7) | PPG/IMU recording contract | **Partially implemented** |
| [#8](https://github.com/DreamTeamSE/cddapp/issues/8) | Motion selection | **Partially implemented** |
| [#9](https://github.com/DreamTeamSE/cddapp/issues/9) | 15-minute scheduler | **Partially implemented** |
| [#10](https://github.com/DreamTeamSE/cddapp/issues/10) | BLE recording transfer | **Partially implemented** |
| [#11](https://github.com/DreamTeamSE/cddapp/issues/11) | PPG quality + preprocessing | **Partially implemented** |
| [#12](https://github.com/DreamTeamSE/cddapp/issues/12) | BP inference + history | **Partially implemented** |
| [#13](https://github.com/DreamTeamSE/cddapp/issues/13) | Accuracy / coverage / battery | **Pending** (protocol only) |
| [#14](https://github.com/DreamTeamSE/cddapp/issues/14) | Motion-triggered acquisition | **Pending** (flagged stub) |
| [#15](https://github.com/DreamTeamSE/cddapp/issues/15) | IMU-assisted filtering | **Pending** (flagged stub) |
| [#16](https://github.com/DreamTeamSE/cddapp/issues/16) | Normalization / watch compatibility | **Partially implemented** (AnyPPG clarified; cBP retraining N/A) |

---

## #7 — Synchronized PPG/IMU recording contract

- **Link:** https://github.com/DreamTeamSE/cddapp/issues/7  
- **Original objective:** Versioned payload shared by wearable, BLE, and mobile (IDs, timing, PPG, IMU, units, missing samples, fixtures).  
- **Status:** **Partially implemented**  
- **Files:** `services/recordings/syncContract.js`, `docs/recording-contract.md`, fixtures under `tests/fixtures/sync-recordings/`  
- **Tests:** `tools/recordings/tests/sync-contract.test.cjs`  
- **Validated:** Schema parse/inspect on synthetic fixtures; invalid/corrupt/incompatible-version rejection in Node tests; app can inspect sync JSON on `app/ml-recording.tsx`.  
- **Still required:** Firmware emitting the contract from AFE4404/BMI270; confirmed real sample rates/units; hardware-produced fixtures shared with firmware tests.

---

## #8 — Motion selection

- **Link:** https://github.com/DreamTeamSE/cddapp/issues/8  
- **Original objective:** Select bounded low-motion contiguous windows suitable for BP windows.  
- **Status:** **Partially implemented**  
- **Files:** `services/device/motion-selection.js`; wired in `services/anyppg/watchInference.js`  
- **Tests:** `tools/recordings/tests/motion-selection.test.cjs`; watch integration rejects high-motion synthetics  
- **Validated:** Host unit behavior on synthetic IMU; watch path rejects all-bad motion without fabricating BP.  
- **Still required:** Thresholds tuned on real BMI270 data; firmware/on-watch candidate selection if capture is device-side.

---

## #9 — 15-minute measurement scheduler

- **Link:** https://github.com/DreamTeamSE/cddapp/issues/9  
- **Original objective:** Periodic acquisition with explicit interval states, no overlapping jobs, persistence across restarts.  
- **Status:** **Partially implemented**  
- **Files:** `services/measurement/interval-scheduler.ts`; foreground demo in `services/device/pipeline-simulation.ts` / `components/PipelineSimCard.tsx`  
- **Tests:** `tests/services/interval-scheduler.test.ts`, `tests/services/pipeline-simulation.test.ts`  
- **Validated:** Software state machine and injectable-clock simulation in Node / in-app sim UI.  
- **Still required:** Watch firmware scheduling; iOS background execution; real 15-minute field operation. **Do not treat the sim as hardware proof.**

---

## #10 — BLE recording transfer

- **Link:** https://github.com/DreamTeamSE/cddapp/issues/10  
- **Original objective:** Chunked upload with retry, dedup, integrity, and queueing.  
- **Status:** **Partially implemented**  
- **Files:** `services/device/recording-transfer.ts`; `services/device/ble-handler-service.ts` (adapter-injected); sim in `pipeline-simulation.ts`  
- **Tests:** `tests/services/recording-transfer.test.ts`, `tests/services/ble-handler-service.test.ts` (mocked adapter)  
- **Validated:** Chunk assemble/dedup/integrity and handler API with mocks; foreground BLE-interrupt simulation.  
- **Still required:** Live BLE against ESP32-C3 / watch firmware; radio reconnect under real conditions.

---

## #11 — PPG quality gating and preprocessing

- **Link:** https://github.com/DreamTeamSE/cddapp/issues/11  
- **Original objective:** Reject unusable PPG; resample/normalize for the active model.  
- **Status:** **Partially implemented**  
- **Files:** `services/recordings/qualityGate.js` (`anyppg_watch_prep_v1`); CSV path prep in `services/anyppg/core.js`  
- **Tests:** `tools/recordings/tests/quality-gate.test.cjs`; AnyPPG core/legacy CSV tests  
- **Validated:** Synthetic sync recordings (accept/reject); legacy CSV prep parity on host; quality gate used before watch inference.  
- **Still required:** Thresholds and gap rules on real AFE4404 waveforms; no silent double-filtering with firmware.

---

## #12 — BP inference and prototype history

- **Link:** https://github.com/DreamTeamSE/cddapp/issues/12  
- **Original objective:** Quality-gated estimates only; versioned, non-duplicated prototype history (not journal backfill).  
- **Status:** **Partially implemented**  
- **Files:** `services/anyppg/*`, `components/BpCsvCard.tsx`, `services/anyppg/watchInference*`, `services/readings/estimate-history.js`, `services/anyppg/sessionHistory.js`  
- **Tests:** `tools/anyppg/tests/*.test.cjs` (incl. session-history, legacy CSV ONNX, watch-integration); physical CSV evidence below  
- **Validated:**  
  - Host ONNX AnyPPG + legacy CSV regression  
  - **Physical iPhone Release CSV import** matching documented SBP/DBP (see `docs/evidence/ANYPPG_IPHONE_VERIFICATION.md`)  
  - In-memory history idempotency / missed intervals in unit tests  
- **Still required:** Persist history across process death if required; watch-live estimates from real hardware; journal policy decisions.

---

## #13 — Accuracy, coverage, and battery evaluation

- **Link:** https://github.com/DreamTeamSE/cddapp/issues/13  
- **Original objective:** Held-out cuff error, coverage, BLE/battery metrics.  
- **Status:** **Pending**  
- **Files:** `docs/evaluation-protocol.md` (scaffold only)  
- **Tests:** None that measure BP accuracy or battery  
- **Validated:** Nothing clinical or energy-related.  
- **Still required:** Paired cuff protocol on target hardware; battery instrumentation; coverage statistics from real intervals.

---

## #14 — Motion-triggered acquisition

- **Link:** https://github.com/DreamTeamSE/cddapp/issues/14  
- **Original objective:** Optional low-power trigger versus periodic capture.  
- **Status:** **Pending** (disabled feature flag)  
- **Files:** `services/device/motion-trigger.js` (`motion_triggered_ppg_v0`, off by default)  
- **Tests:** `tools/recordings/tests/feature-flags.test.cjs` (asserts disabled)  
- **Validated:** Flag remains off; no acquisition strategy comparison.  
- **Still required:** Firmware experiment design and battery/coverage comparison per evaluation protocol.

---

## #15 — IMU-assisted filtering / denoising

- **Link:** https://github.com/DreamTeamSE/cddapp/issues/15  
- **Original objective:** Optional IMU-aided denoise improving BP without damaging morphology.  
- **Status:** **Pending** (disabled feature flag)  
- **Files:** `services/device/imu-denoise.js` (`imu_nlms_denoise_v0`, off by default)  
- **Tests:** `tools/recordings/tests/feature-flags.test.cjs` (asserts disabled / passthrough)  
- **Validated:** Disabled path preserves samples in tests.  
- **Still required:** Candidate algorithm + held-out cuff evaluation before enabling.

---

## #16 — Normalization / beat features (issue text vs AnyPPG)

- **Link:** https://github.com/DreamTeamSE/cddapp/issues/16  
- **Original objective (issue text):** cBP-Tnet-oriented `generate_features` / `normalize_beats` and possible retraining for watch beats.  
- **Status:** **Partially implemented** for the **active AnyPPG** path; **cBP-Tnet retraining proposal is no longer applicable** to shipping inference.  
- **Clarification:** AnyPPG uses **125 Hz**, **30 s / 3×10 s chunks**, **per-chunk mean/std**, frozen ONNX encoder + `ridge_head.json`. It does **not** use cBP-Tnet beat normalization.  
- **Files:** `docs/anyppg-watch-compatibility.md`, `services/anyppg/core.js`, `services/recordings/qualityGate.js` (`anyppg_watch_prep_v1`), `services/anyppg/watchInference.js`  
- **Tests:** `tools/anyppg/tests/core.test.cjs`, `legacy-sparkfun-csv.test.cjs`, `watch-integration.test.cjs`, quality-gate prep tests  
- **Validated:** Host preprocessing/ONNX parity for CSV; quality-gated watch prep on synthetics; physical iPhone CSV numerical match.  
- **Still required:** Confirm AFE4404 raw polarity/rate/amplitude compatibility with AnyPPG training assumptions; do **not** reintroduce cBP beat pipelines for AnyPPG without a new training plan.

---

## Related app surfaces

| Surface | Role |
|---|---|
| `BpCsvCard` | Production CSV AnyPPG demo |
| `ml-watch-pipeline` (Home link `__DEV__`-only) | Dev sync path, scheduler/BLE sim, integration panel |
| `ml-recording` | Inspect CSV/JSON; no BP calculation |
| `archive/cbp-tnet/` | Historical only; not loaded by the app |
