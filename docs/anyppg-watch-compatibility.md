# AnyPPG ↔ new-watch compatibility

**Preprocessing version:** `anyppg_watch_prep_v1`  
**Active model:** AnyPPG frozen encoder + ridge head (`anyppg_frozen_ridge_raw_v1`)  
**Status:** Software contract and gating rules. Physical AFE4404 watch waveforms are **not** yet proven compatible.

## Clarification for GitHub issue #16

Issue #16 (“Fix beat normalization to work for watch data”) describes **cBP-Tnet** training utilities (`generate_features` / `normalize_beats`) and retraining. That path is **not** the active shipping inference pipeline.

AnyPPG already normalizes each **10-second chunk** with that chunk’s own mean and standard deviation inside `services/anyppg/core.js` (`standardizeWindow`). This is **not** per-beat normalization. Do **not** implement beat-based normalization for AnyPPG without a training/inference compatibility review and held-out evidence.

Legacy cBP-Tnet assets are archived under `archive/cbp-tnet/` for historical iPhone tests only and are not loaded by the app.

## AnyPPG model input (locked)

| Parameter | Value |
|---|---|
| Model grid rate | 125 Hz |
| Window length | 30 s = 3750 samples |
| Chunks | three contiguous 10 s blocks (1250 samples each) |
| Chunk normalization | `(x - mean) / (std + 1e-8)` per chunk; reject `std ≤ 1e-12` |
| Channels | Red and infrared predicted **separately** (no fusion in the current demo) |
| Encoder embedding norm | Uses `ridge_head.json` feature mean/std (distinct from raw PPG chunk norm) |
| Runtime | ONNX Runtime on device, local CPU path preserved |

## Filtering and resampling ownership (`anyppg_watch_prep_v1`)

Decided once for the watch path (aligned with [`docs/reference/PPG_Filtering.pdf`](reference/PPG_Filtering.pdf) watch/phone split; shipping model remains AnyPPG):

1. **Firmware** delivers provenance-labeled samples (`raw_adc` preferred). Firmware must not silently apply the cBP-Tnet AMPD/Kalman pipeline.
2. **Phone** owns AnyPPG-compatible resampling to 125 Hz, flat/near-flat rejection **before** dividing by std, and chunk standardization.
3. Do not double-filter. If `provenance` is `firmware_filtered`, phone applies only rate conversion + quality gates + chunk norm, sets `rawUnmodified: false` / `doubleFilterAvoided: true`, and stores `signalProvenance` on the estimate.
4. Never interpolate across gaps larger than the configured limit just to fill 3750 samples.
5. **Motion window crop (PDF Stage 5 on phone until firmware owns it):** `runWatchRecording` tries `selectLowMotionSegments` candidates and runs quality/prep only on `[windowStartMs, windowEndMs]`, not always from t₀.

## Host CLI

```bash
node tools/anyppg/run-watch-recording.cjs tests/fixtures/sync-recordings/accept-low-motion-32s.json
```

Exit `0` = accepted estimate, `2` = quality reject, `1` = error.

## Watch waveform checks still required on hardware

Until measured on the target stack, treat these as open:

- Polarity (AC orientation) vs training data
- Effective native sample rate and jitter
- Contact location (wrist vs finger training bias)
- Amplitude scaling / ADC offset / saturation rails
- Whether red, IR, or both are usable after contact quality gating

## Parity

Host Python and React Native ONNX must agree on identical fixtures within the existing AnyPPG tolerances. Processing parity ≠ clinical accuracy. Paired cuff evaluation is issue #13.
