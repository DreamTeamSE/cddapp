# Next steps — CDD blood-pressure prototype

**Updated:** November 9, 2026  
**Branch context:** `feature/ppg-pipeline-improvements`  
**Active model:** AnyPPG only  

This document prioritizes remaining work after software contracts for issues #7–#16 and the November 9 physical-iPhone **CSV** verification. See also `docs/IMPLEMENTATION_STATUS.md` and `CDD_Next_Tasks_Roadmap.md`.

**Team keys:** Software = React Native / ONNX / contracts · Hardware = sensors / firmware / ESP32-C3 · Both = end-to-end validation.

---

## Priority overview

| Priority | Area | Primary team |
|---|---|---|
| P0 | Finish software ↔ device demo path; expand physical-iPhone evidence | Software (+ Hardware for fixtures) |
| P0 | Bring up AFE4404 + SFH 7050A + BMI270 acquisition emitting `cdd_ppg_imu_recording_v1` | Hardware |
| P1 | Live BLE transfer of full recordings | Both |
| P1 | 15-minute automated capture on watch + phone handling | Both |
| P1 | Real-signal quality / motion thresholds | Both |
| P1 | Paired cuff accuracy study | Both |
| P2 | Battery / performance vs targets | Both |
| P2 | Motion-trigger (#14) and IMU denoise (#15) experiments | Hardware / DSP + Software |

---

## 1. Software integration and physical-iPhone testing

**Owner:** Software  
**Priority:** P0

- [ ] Commit/PR `feature/ppg-pipeline-improvements` after team review (do not merge until reviewers agree).
- [ ] Re-run Release install after merge; reconfirm CSV AnyPPG on device.
- [ ] Capture a share report for **Check model with a synthetic signal** (±0.01 mmHg) on the same phone.
- [ ] On a **development** build, run Watch Pipeline + Integration Test Panel; save pass/fail screenshots/JSON.
- [ ] Import a valid synthetic `cdd_ppg_imu_recording_v1` (32 s low motion) and a high-motion reject case on device.
- [ ] Confirm no cBP-Tnet navigation remains on the installed binary.
- [ ] Optional: Android AnyPPG CSV path (not yet verified).

---

## 2. Hardware firmware and sensor acquisition

**Owner:** Hardware  
**Priority:** P0

- [ ] Confirm optical path: AFE4404 + SFH 7050A (red/IR availability, LED/gain, ADC interpretation).
- [ ] Confirm BMI270 accel/gyro rates, units, and timestamps.
- [ ] Emit recordings matching `docs/recording-contract.md` (`cdd_ppg_imu_recording_v1`) with provenance `raw_adc` vs firmware-filtered.
- [ ] Produce hardware fixtures for mobile tests (valid, missing-sample, high-motion).
- [ ] Keep ESP32-C3 as controller unless the team formally changes platforms.
- [ ] Do **not** treat legacy SparkFun CSV as new-watch validation data.

---

## 3. BLE communication and synchronization

**Owner:** Both  
**Priority:** P1

- [ ] Implement firmware chunking compatible with `services/device/recording-transfer.ts`.
- [ ] Wire `ble-handler-service` to a real React Native BLE adapter (not mocks).
- [ ] Validate disconnect, retry, duplicate packets, and integrity failures on hardware.
- [ ] Measure transfer latency/volume for a full 30+ second PPG+IMU payload.
- [ ] Keep simulation (`PipelineSimCard`) for regression, but label it non-hardware.

---

## 4. 15-minute automated measurement workflow

**Owner:** Both  
**Priority:** P1

- [ ] Implement interval state machine on the watch using the same semantics as `IntervalScheduler`.
- [ ] Persist interval outcomes across watch reboot; prevent duplicate `intervalId`s.
- [ ] Define phone behavior when disconnected (queue pending upload vs miss).
- [ ] Clarify iOS foreground vs background constraints; do not assume background BLE without testing.
- [ ] Field-test multiple consecutive intervals (success, motion miss, upload failure).

---

## 5. Signal-quality validation and motion filtering

**Owner:** Both  
**Priority:** P1

- [ ] Tune motion RMS and PPG flat/clip/gap gates on real AFE4404+BMI270 data (`qualityGate` / motion-selection).
- [ ] Decide firmware vs phone filtering ownership; version IDs; avoid double-filtering.
- [ ] Confirm AnyPPG polarity/amplitude/rate assumptions on raw watch PPG (`docs/anyppg-watch-compatibility.md`).
- [ ] Leave `#14` / `#15` disabled until baselines exist.

---

## 6. BP model accuracy and paired cuff-reference testing

**Owner:** Both  
**Priority:** P1

- [ ] Follow `docs/evaluation-protocol.md`: paired cuff, rest/activity cases, exclusions.
- [ ] Report SBP/DBP MAE, bias, and coverage **separately** from ONNX numeric parity.
- [ ] Keep estimates labeled experimental; no clinical claims.
- [ ] Do **not** retrain or swap AnyPPG weights casually; freeze hashes in `assets/models/anyppg/manifest.json`.
- [ ] Issue #16 cBP-Tnet beat retraining remains **out of scope** for the active pipeline.

---

## 7. Battery and performance evaluation

**Owner:** Both  
**Priority:** P2

- [ ] Measure watch current during idle, capture, BLE upload, and failed retries.
- [ ] Measure phone ONNX latency/memory for watch windows (extend beyond CSV 182 ms observation).
- [ ] Compare default 15-minute strategy vs future motion-triggered (#14) using identical quality gates.
- [ ] Record cold-start and Release vs Debug differences.

---

## Explicit non-goals right now

- Upgrading to Expo SDK 58 solely for scene lifecycle (SDK 57 hand-managed scene support is already in `ios/`).
- Reactivating cBP-Tnet as the shipping model.
- Claiming BLE, scheduler, or new-sensor accuracy from Node unit tests or CSV-only iPhone evidence.
