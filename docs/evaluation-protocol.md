# Prototype evaluation protocol (issues #13–#15)

**Status:** Protocol scaffold only. No claim that targets are met. Physical hardware, paired cuff, and battery measurements are still required.

## Issue #13 — Accuracy, coverage, battery

### Reference-cuff capture checklist

- [ ] Rest seated, arm supported, documented cuff model
- [ ] Matched timestamps between cuff and watch `captureStartedAt` / `intervalId`
- [ ] Record position, contact quality notes, exclusions
- [ ] Activity cases: rest, typing, walking, sudden movement, loose/poor contact
- [ ] Store raw PPG + IMU + sensor settings + reference SBP/DBP

### Predefined prototype metrics (report all together)

| Metric | Notes |
|---|---|
| SBP/DBP MAE | Held-out recordings/subjects only |
| Signed bias | Per activity/contact condition |
| Error distribution | Avoid overlapping-window leakage |
| Accepted-window coverage | Accepted / attempted intervals |
| Missed-interval rate | From scheduler outcomes |
| False acceptance | Bad PPG that passed gates |
| BLE volume / capture delay | From transfer logs |
| Battery current/energy | Target wearable hardware |

Separate **processing parity** (Python ↔ phone numeric agreement) from **clinical accuracy** (cuff agreement). Do not claim diagnostic suitability without formal validation.

## Issue #14 — Motion-triggered capture

Compare against the default periodic strategy using identical recording contract, quality checks, and retry budget. Feature flag: `motion_triggered_ppg_v0` (disabled by default in `services/device/motion-trigger.js`).

## Issue #15 — IMU-assisted denoising

Freeze baseline (motion selection + rejection + `anyppg_watch_prep_v1`). Evaluate one candidate behind `imu_nlms_denoise_v0` (disabled by default). Enable only if held-out BP error and coverage improve without unacceptable morphology changes.
