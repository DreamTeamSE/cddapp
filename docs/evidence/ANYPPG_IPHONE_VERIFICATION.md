# AnyPPG physical-iPhone verification (CSV import)

**Date:** November 9, 2026  
**Branch:** `feature/ppg-pipeline-improvements`  
**Tester:** Rithika (personal run on installed CDD iPhone app)  
**Feature exercised:** Blood Pressure → **Import CSV & calculate** (legacy SparkFun-format team CSV)

## What this report verifies

Local on-device execution of the **AnyPPG** encoder + ridge head through `onnxruntime-react-native`, and **numerical consistency** with the documented host regression outputs for the same recording.

## What this report does **not** verify

- Clinical blood-pressure accuracy versus a cuff
- New watch hardware (AFE4404 + SFH 7050A + BMI270)
- Live BLE streaming or recording transfer from a wearable
- The 15-minute scheduled watch measurement workflow
- The synthetic AnyPPG check button on this device (no separate evidence captured here)
- The development-only Watch Pipeline / Integration Test Panel on this device (no separate evidence captured here)

## Device and runtime

| Field | Value |
|---|---|
| Platform | iOS **26.6.2** |
| ONNX Runtime React Native | **1.24.3** |
| Model ID | `anyppg_frozen_ridge_raw_v1` |
| Execution | Native app, **CPU** |
| Development build | **false** (Release / non-dev-client install) |

Bundled encoder hash (repository `assets/models/anyppg/manifest.json`):  
`modelSha256 = 1cccde2235544b4b055dc2dd73e481cde9d0492ea7796b2b468e03b7f0472ebe`

## Recording

| Field | Value |
|---|---|
| Rows | **1,322** |
| Duration (print-time span) | **48.723** seconds |
| Format | Legacy three-column `time_stamp_millis,RawRed,RawIR` (AC / baseline-subtracted SparkFun path) |
| Fixture alignment | Matches `tests/fixtures/anyppg/legacy_sparkfun_ac_20260923.csv` / `legacy_sparkfun_ac_reference.json` |

This CSV is **not** a synchronized PPG+IMU `cdd_ppg_imu_recording_v1` watch recording.

## Processing

| Field | Value |
|---|---|
| Total wall processing time | approximately **182 ms** |
| Inference windows completed | **4** (two red, two infrared) |

## Observed predictions

| Channel | SBP (mmHg) | DBP (mmHg) |
|---|---:|---:|
| Red window 1 | 99.58647 | 72.45380 |
| Red window 2 | 103.66186 | 70.80655 |
| Infrared window 1 | 101.55993 | 69.98643 |
| Infrared window 2 | 104.51363 | 71.41459 |

## Comparison to documented regression reference

Documented host expectations (`tests/fixtures/anyppg/legacy_sparkfun_ac_reference.json`, tolerance **0.01 mmHg**):

| Channel | Expected SBP | Expected DBP |
|---|---:|---:|
| Red window 1 | 99.5865 | 72.4538 |
| Red window 2 | 103.6619 | 70.8066 |
| Infrared window 1 | 101.5599 | 69.9864 |
| Infrared window 2 | 104.5136 | 71.4146 |

The iPhone share-report values match these documented outputs to the **displayed precision**.

## Conclusion

**Passed for:** local AnyPPG ONNX inference on a physical iPhone Release build, and numerical agreement with the legacy SparkFun CSV regression fixture.

**Still open:** clinical accuracy, new-sensor hardware validation, BLE/watch scheduling, and any other in-app panels not covered by this CSV import run.
