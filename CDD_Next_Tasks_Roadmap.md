# CDD Blood Pressure Detection — Next Tasks Roadmap

**Repository:** [DreamTeamSE/cddapp](https://github.com/DreamTeamSE/cddapp)  
**Issue inventory reviewed:** 10 open issues, [#7–#16](https://github.com/DreamTeamSE/cddapp/issues)  
**Prepared:** November 9, 2026  
**Scope:** Prototype wearable → BLE → React Native → local AnyPPG inference.  
**Status caveat:** Tasks below are derived from open issues and code inspection, not evidence that every item is entirely unimplemented. Confirm completed pieces through tests before closing issues.

## Executive priorities

**Current direction:** **AnyPPG** is the only active phone BP inference pipeline. Older **cBP-Tnet** training/export assets are archived under `archive/cbp-tnet/` and must not drive new implementation unless the team explicitly reactivates that model. AWS may support research/evaluation, while the target phone performs final inference.

**Critical path:** Define the raw sensor contract → confirm model input and preprocessing → capture motion-qualified data every 15 minutes → transfer complete recordings over BLE → reject unusable PPG → infer with AnyPPG → store traceable prototype estimates → validate accuracy and power consumption.

**Definitions:** P0 = prerequisite/blocking; P1 = essential end-to-end implementation; P2 = evaluation/optimization. “Owner” below means suggested responsibility, not a GitHub assignment.

| Order | Priority | Workstream | GitHub issues | Suggested owner | Completion evidence |
|---|---|---|---|---|---|
| 1 | P0 | Sensor and model input contract | [#7](https://github.com/DreamTeamSE/cddapp/issues/7), [#16](https://github.com/DreamTeamSE/cddapp/issues/16) | Hardware + ML/mobile | Versioned schema, fixtures, confirmed AnyPPG compatibility |
| 2 | P0 | Raw/clean PPG processing and quality gate | [#11](https://github.com/DreamTeamSE/cddapp/issues/11), [#16](https://github.com/DreamTeamSE/cddapp/issues/16) | ML/mobile + hardware | Deterministic preprocessing and rejection tests |
| 3 | P1 | 15-minute scheduled acquisition and motion selection | [#8](https://github.com/DreamTeamSE/cddapp/issues/8), [#9](https://github.com/DreamTeamSE/cddapp/issues/9) | Firmware + mobile | One auditable outcome per interval, no overlapping jobs |
| 4 | P1 | Reliable BLE upload and local recording persistence | [#10](https://github.com/DreamTeamSE/cddapp/issues/10) | Firmware + mobile | Disconnect/retry/dedup/integrity tests |
| 5 | P1 | Quality-gated AnyPPG + history | [#12](https://github.com/DreamTeamSE/cddapp/issues/12) | ML/mobile | Only accepted windows yield versioned, nonduplicated estimates |
| 6 | P1 | Hardware/clinical-reference prototype evaluation | [#13](https://github.com/DreamTeamSE/cddapp/issues/13) | Whole team | Held-out BP error, bias, coverage, battery/BLE measurements |
| 7 | P2 | Low-power activation experiment | [#14](https://github.com/DreamTeamSE/cddapp/issues/14) | Firmware | Battery/coverage/delay comparison with default strategy |
| 8 | P2 | IMU-aided denoising experiment | [#15](https://github.com/DreamTeamSE/cddapp/issues/15) | Hardware/DSP + ML | Held-out BP improvement and no unacceptable morphology changes |

## Phase 0 — Agree on the interface and AnyPPG pipeline (blocking)

### Task 0.1 — Define one versioned, synchronized recording format ([#7](https://github.com/DreamTeamSE/cddapp/issues/7))

- [ ] Confirm AFE4404 + SFH 7050A + BMI270 acquisition details: PPG channel availability (red/IR), real sampling rate(s), ADC count interpretation, LED/gain settings, and timestamp generation.
- [ ] Confirm whether PPG is **raw ADC**, firmware-filtered, or both; preserve provenance and never silently label filtered data as raw.
- [ ] Define `recording_id`, `device_id`, `session_id`, `interval_id`, schema version, capture-start timestamp, monotonic sample timing, upload timestamp, sample rates, missing-sample flags, and sensor settings.
- [ ] Represent BMI270 **acceleration XYZ and gyroscope XYZ** with correct units; these are not direct displacement/rotation coordinates.
- [ ] Specify alignment and tolerance between PPG and IMU clocks (do not assume both run at 100 Hz).
- [ ] Agree on sequence, chunk numbering, integrity check, and invalid-schema/error behavior.
- [ ] Create shared **valid, missing-sample, out-of-order, corrupted, and incompatible-version** fixtures for firmware and mobile tests.

**Deliverable:** `docs/recording-contract.md` (suggested), schema examples/fixtures, confirmed unit and timing table.  
**Done when:** the firmware can produce fixtures the app parses without guessing timing or units.

### Task 0.2 — Lock down AnyPPG preprocessing and correct Issue #16's scope ([#16](https://github.com/DreamTeamSE/cddapp/issues/16), [#11](https://github.com/DreamTeamSE/cddapp/issues/11))

- [ ] Document **AnyPPG's** actual model input: 125 Hz resampled waveform, 30-second windows, three 10-second chunks, per-chunk mean/std normalization, frozen encoder, and separate ridge BP head.
- [ ] Record that current [`services/anyppg/core.js`](https://github.com/DreamTeamSE/cddapp/blob/main/services/anyppg/core.js) already normalizes each **10-second chunk using its own mean/std**; this is **not per-beat normalization**.
- [ ] Update/clarify #16: its `generate_features` / `normalize_beats` and retraining instructions refer to **cBP-Tnet**, not the active AnyPPG CSV path. Do **not** implement beat-based normalization for AnyPPG without evidence and a training/inference compatibility review.
- [ ] Verify the new AFE4404 raw-count waveform's **polarity, effective rate, contact location, amplitude scaling, offset, saturation, and filter compatibility** against AnyPPG training expectations.
- [ ] Decide filtering and resampling ownership (firmware versus app) **once**, with version IDs; do not unknowingly double-filter or use the cBP-Tnet AMPD/Kalman pipeline for AnyPPG.
- [ ] Explicitly test if per-chunk normalization is stable on clean watch data; gate flat/near-flat data *before* dividing by std.
- [ ] Confirm if red, IR, or both are fed to AnyPPG; existing CSV demo predicts separately per channel, not fusion.
- [ ] Keep frozen model/encoder embedding normalization and `ridge_head.json` statistics consistent with the exported model; these are different from raw-PPG normalization.
- [ ] Record parity checks between Python reference processing and React Native ONNX execution using exactly the same watch-data fixtures.

**Deliverable:** `docs/anyppg-watch-compatibility.md`, preprocessing-version tag, parity fixtures, a comment clarifying #16.  
**Done when:** a new-device sample passes a reproducible input-to-inference test with documented caveats; accuracy still requires paired cuff data.

## Phase 1 — Acquire and deliver usable recordings

### Task 1.1 — Select low-motion contiguous segments on the wearable ([#8](https://github.com/DreamTeamSE/cddapp/issues/8))

- [ ] Choose configurable window duration matched to the active model (AnyPPG currently uses 30-second windows).
- [ ] Measure gravity-removed acceleration RMS/per-axis variability and short motion spikes.
- [ ] Reject high-motion windows and cheaply screen flatlined, clipped, or missing PPG.
- [ ] Keep at most a bounded number of **contiguous** candidates, each linked to the matching IMU samples and interval ID.
- [ ] Record per-candidate quality/motion scores and rejection reasons; compare rest, typing, walking, and abrupt movement.

**Done when:** all-bad periods yield no fake passing window; memory usage stays bounded.

### Task 1.2 — Implement scheduled acquisition with bounded retry ([#9](https://github.com/DreamTeamSE/cddapp/issues/9))

- [ ] Default interval = **15 minutes**, but support configurable period, acquisition duration and retry limits.
- [ ] Build explicit states: scheduled → collecting → pending processing → accepted / missed / failed.
- [ ] Assign a stable interval ID; anchor subsequent intervals to the planned schedule even when prior captures are delayed.
- [ ] Prohibit overlapping capture jobs and bound the search window when movement prevents collection.
- [ ] Queue completed candidates during phone disconnection; distinguish **captured but awaiting upload** from **capture failure**.
- [ ] Persist schedule and state over wearable restarts, avoiding duplicate intervals.

**Done when:** every interval has one auditable state/outcome. **15-minute scheduling is a goal, not a currently verified working feature.**

### Task 1.3 — Reliably transfer selected data over BLE ([#10](https://github.com/DreamTeamSE/cddapp/issues/10))

- [ ] Encode chunks with `recording_id`, sequence number, total expected chunks, timestamps, schema version, and optional checksum.
- [ ] Match BLE packet structure to the contract in Task 0.1.
- [ ] Persist/reassemble in the app; verify completeness and integrity **before** marking upload acknowledged.
- [ ] Recover/resume interrupted transfers; deduplicate repeated packets and repeated complete recordings.
- [ ] Bound wearable queue storage and record drops/expiry reasons.
- [ ] Test radio disconnect, partial transfer, duplicate delivery, wrong ordering, and restart scenarios on real hardware.

**Relevant starting code:** [`services/device/ble-handler-service.ts`](https://github.com/DreamTeamSE/cddapp/blob/main/services/device/ble-handler-service.ts), [`services/device/packet-reassembler.ts`](https://github.com/DreamTeamSE/cddapp/blob/main/services/device/packet-reassembler.ts).  
**Done when:** phone persistence matches the original full recording and no incomplete buffer can reach inference.

## Phase 2 — Phone preprocessing, inference, and history

### Task 2.1 — Quality-gate and preprocess PPG on phone ([#11](https://github.com/DreamTeamSE/cddapp/issues/11))

- [ ] Parse the new versioned format in addition to the legacy demonstration CSV; never assume print timestamps are exact sample timestamps.
- [ ] Validate sensor rate, duration, timestamp monotonicity, missing samples, channel validity and IMU sync.
- [ ] Detect clipping/saturation, weak pulses, flatlining, motion contamination, baseline drift, bad contact and edge artifacts.
- [ ] Combine PPG quality with IMU gating; low motion **alone** does not imply good PPG.
- [ ] Apply only preprocessing justified by AnyPPG training and watch compatibility, including appropriate resampling to 125 Hz and normalization.
- [ ] Never interpolate across large unobserved gaps just to fill the expected input shape.
- [ ] Keep raw samples unmodified with processing configuration/version, log rejections with reasons, and ensure reproducibility.
- [ ] Label signal quality as a data-quality assessment, **not** confidence that BP is accurate.

**Relevant starting code:** [`services/recordings/serialCsv.js`](https://github.com/DreamTeamSE/cddapp/blob/main/services/recordings/serialCsv.js), [`services/anyppg/core.js`](https://github.com/DreamTeamSE/cddapp/blob/main/services/anyppg/core.js).  
**Done when:** fixture tests demonstrate acceptance/rejection and model-compatible output.

### Task 2.2 — Connect accepted recordings to AnyPPG and history ([#12](https://github.com/DreamTeamSE/cddapp/issues/12))

- [ ] Feed only fully received, quality-accepted recordings to the AnyPPG ONNX encoder + ridge head.
- [ ] Verify model asset availability and saved-head/encoder version agreement; ensure invalid model outputs are blocked.
- [ ] Specify how to choose among multiple passing windows from one scheduled interval.
- [ ] Make any calibration requirement explicit; block inference with an explanation if required and missing.
- [ ] Store predicted SBP/DBP with `recording_id`, `interval_id`, *actual capture time*, model hash/version, preprocessing version, quality status and calibration status.
- [ ] Represent pending, missed and failed intervals separately; **do not fill gaps using the prior reading**.
- [ ] Make reprocessing idempotent; show experimental/prototype labeling and distinguish old imported CSV estimates from live watch measurements.
- [ ] Run end-to-end physical-iPhone checks for the **current AnyPPG**, not just the historically tested cBP-Tnet.
- [ ] Verify Android native inference separately if Android is in scope.

**Relevant starting code:** [`components/BpCsvCard.tsx`](https://github.com/DreamTeamSE/cddapp/blob/main/components/BpCsvCard.tsx), [`services/anyppg/inference.native.ts`](https://github.com/DreamTeamSE/cddapp/blob/main/services/anyppg/inference.native.ts).  
**Done when:** only accepted raw-to-model recordings produce traceable, reproducible prototype BP estimates.

## Phase 3 — Validation gates before considering the system ready

### Task 3.1 — Collect paired recordings and evaluate the complete system ([#13](https://github.com/DreamTeamSE/cddapp/issues/13))

- [ ] Document a repeatable reference-cuff protocol and matched capture timestamps, position, rest conditions and exclusions; consult appropriate study/validation guidance for medical claims.
- [ ] Capture rest, typing, walking, sudden movement and loose/poor-contact cases with raw PPG, IMU, reference cuff and sensor settings.
- [ ] Predefine prototype targets and use **held-out recordings/subjects**; group overlapping windows to avoid leakage.
- [ ] Compare IMU-only selection vs joint IMU + PPG quality gating.
- [ ] Report SBP/DBP MAE, signed bias, error distribution, accepted-window coverage, missed-interval rate, false acceptance, and results by activity/contact condition.
- [ ] Measure BLE volume, capture delay, battery current/energy on target hardware and effect of retries.
- [ ] Separate **processing parity** (same numeric output as Python) from **clinical accuracy** (agreement with reference measurements).
- [ ] Do not claim cuff-level accuracy or diagnostic suitability without appropriate formal validation.

**Done when:** measurements and documented gaps establish whether predefined prototype targets were met. Accuracy **and** coverage must be reported together.

## Phase 4 — Optional optimizations, only after baseline validation

### Task 4.1 — Compare motion-triggered PPG activation with default capture ([#14](https://github.com/DreamTeamSE/cddapp/issues/14))

- [ ] Verify whether BMI270 low-power monitoring can trigger AFE4404/LED activation on the target firmware.
- [ ] Choose configurable stillness detection and sensor-settling time; exclude settling samples from model input.
- [ ] Reuse identical recording format, quality checks and retry budget.
- [ ] Compare power consumption, measurement coverage and delay against continuous/periodic PPG collection.
- [ ] Select default acquisition strategy based on measurement results.

### Task 4.2 — Evaluate IMU-assisted denoising; keep disabled unless it helps BP accuracy ([#15](https://github.com/DreamTeamSE/cddapp/issues/15))

- [ ] Freeze a conservative baseline (motion selection + rejection + AnyPPG-compatible processing).
- [ ] Implement **one** IMU-assisted denoising candidate behind a feature flag (e.g., NLMS/RLS or another method justified by resources).
- [ ] Preserve original samples and compare pulse morphology before/after; document latency and edge effects.
- [ ] Tune on development data; evaluate on held-out data with reference BP.
- [ ] Compare BP error, accepted-measurement coverage and false acceptance of corrupted intervals.
- [ ] Reject or leave disabled if it merely produces smoother PPG without improving robust BP outcomes.

## Suggested implementation handoffs

| Firmware / hardware team | Mobile / ML team | Shared responsibility |
|---|---|---|
| Configure optical AFE and BMI270; stable clocks; acquisition; battery management | Parse and store versioned recordings; implement AnyPPG preprocessing, ONNX inference and history | Shared data schema, test fixtures, timestamps, IMU/PPG alignment |
| Low-motion segmentation; schedule every 15 minutes; bounded retries | Reject poor PPG; enforce quality and calibration gates; surface missed windows | Quality thresholds, end-to-end transport/restart tests |
| BLE packet encoding and retry queue | BLE decode, reassembly, deduplication, persistent storage | BLE checksum/integrity, field trials |
| Optional firmware adaptive filter / wake-up experiments | Model compatibility checks; optional AWS research; held-out BP evaluations | Real-watch capture + paired reference cuff + power/accuracy validation |

## First practical sprint — recommended order

1. [ ] Hold a hardware/mobile contract review (#7) and decide **raw vs filtered** PPG delivery; obtain one synchronized red/IR + BMI270 recording with units and timestamps.
2. [ ] Write the minimal schema and cross-team valid/invalid fixtures; test the current BLE/recording parser against them.
3. [ ] Update #16 to clarify **AnyPPG currently uses 10-second per-segment normalization; cBP-Tnet beat retraining is not the immediate shipping path**.
4. [ ] Build a replay path that consumes one new-watch recording, applies the explicitly agreed AnyPPG-compatible processing and exports intermediate arrays for Python↔phone parity.
5. [ ] Implement PPG quality rejection (#11) before making a 15-minute automated BP measurement claim.
6. [ ] Integrate scheduled firmware capture + motion selection (#8/#9), then durable BLE transfer (#10).
7. [ ] Wire accepted recordings to a versioned AnyPPG history workflow (#12), and run a real-iPhone end-to-end demonstration.
8. [ ] Start paired cuff/PPG/IMU data collection and held-out evaluation (#13); use findings to decide whether #14/#15 offer measurable value.

## Definition of the first successful integrated prototype

- [ ] Every scheduled 15-minute interval gets an ID and eventually a documented status (accepted, pending, missed or failed).
- [ ] Raw PPG + synchronized IMU data is captured with validated sample rates, units, and timestamps.
- [ ] Interrupted BLE uploads cannot silently produce partial inference or duplicated records.
- [ ] The phone preprocesses using the **same contract as the deployed AnyPPG model**, and rejects unusable PPG.
- [ ] Valid, accepted recordings generate locally computed, clearly labeled prototype SBP/DBP estimates with provenance.
- [ ] At least one full hardware-to-phone demo and a reproducible test report are saved.
- [ ] Reference-BP error, coverage and battery use are reported; a working inference path is not misrepresented as medically validated.

---

## Issue-by-issue index

- [#7 — Define synchronized PPG/IMU recording contract](https://github.com/DreamTeamSE/cddapp/issues/7): foundational schema and timing.
- [#8 — Select low-motion segments on wearable](https://github.com/DreamTeamSE/cddapp/issues/8): on-device motion/quality selection.
- [#9 — Schedule recordings every 15 minutes](https://github.com/DreamTeamSE/cddapp/issues/9): intervals, retries and restart persistence.
- [#10 — Transfer selected recordings reliably over BLE](https://github.com/DreamTeamSE/cddapp/issues/10): chunk integrity, recovery and deduplication.
- [#11 — Assess PPG quality and preprocess in app](https://github.com/DreamTeamSE/cddapp/issues/11): acceptance and AnyPPG-ready preprocessing.
- [#12 — Integrate quality-gated BP estimates and history](https://github.com/DreamTeamSE/cddapp/issues/12): traceable local inference and missing intervals.
- [#13 — Validate accuracy, coverage and battery](https://github.com/DreamTeamSE/cddapp/issues/13): performance and field evaluation.
- [#14 — Implement motion-triggered PPG capture](https://github.com/DreamTeamSE/cddapp/issues/14): power optimization experiment.
- [#15 — Evaluate IMU-assisted artifact removal](https://github.com/DreamTeamSE/cddapp/issues/15): optional denoising experiment.
- [#16 — Fix beat normalization for watch data](https://github.com/DreamTeamSE/cddapp/issues/16): clarify legacy cBP-Tnet scope versus active AnyPPG; verify new watch compatibility.
