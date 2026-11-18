# Roadmap module integration map (#7–#16)

| Issue | Module | Integrated into |
|---|---|---|
| #7 Recording contract | `services/recordings/syncContract.*` | `parseRecordingFile` picker path; `app/ml-recording.tsx` inspect UI; fixtures; `createPrototypePipeline` |
| #8 Motion selection | `services/device/motion-selection.js` | `createPrototypePipeline.selectMotion`; unit tests |
| #9 15-min scheduler | `services/measurement/interval-scheduler.ts` | `createPrototypePipeline.scheduler`; unit tests (not firmware-verified) |
| #10 BLE recording transfer | `services/device/recording-transfer.ts` | `createPrototypePipeline` encode/accept; unit tests (wire UUID adapter still hardware) |
| #11 Quality gate | `services/recordings/qualityGate.*` | `createPrototypePipeline.assess/prepare`; unit tests |
| #12 History | `services/readings/estimate-history.js` + `services/anyppg/sessionHistory.js` | `BpCsvCard` records prototype estimates after AnyPPG CSV/synthetic runs (not journal DB) |
| #13 Evaluation | `docs/evaluation-protocol.md` | Protocol only |
| #14 Motion trigger | `services/device/motion-trigger.js` | Exposed via pipeline; **disabled** |
| #15 IMU denoise | `services/device/imu-denoise.js` | Exposed via pipeline; **disabled** |
| #16 AnyPPG vs beat-norm | docs + `anyppg/core.js` comment | Clarified; no cBP beat-norm in active path |

Active BP inference UI remains `components/BpCsvCard.tsx` → `services/anyppg/*` (local ONNX Runtime).
