# What we changed (plain English)

**Audience:** teammates and leads who may not live in the ML code every day.  
**Branches:** phone prep work on `feature/watch-prep-gaps`; auth/login is already on `main`.  
**Date context:** November 2026.

---

## 1. What we were trying to do

The watch will eventually send a short clip of optical heart-signal (PPG) plus motion (IMU). The phone should:

1. Check the clip is usable.  
2. Pick the quietest ~30 seconds if the clip is longer / partly noisy.  
3. Resample to the rate the blood-pressure model expects (125 samples per second).  
4. **Normalize** that window the same way the model was trained.  
5. Run AnyPPG and store a clearly labeled **prototype** estimate.

We did **not** wait for live watch data. Everything here runs on synthetic JSON fixtures that look like the planned watch file format.

---

## 2. How normalization is applied (for your boss)

**Short answer:** We do **not** normalize beat-by-beat. The shipping model (**AnyPPG**) normalizes each **10-second chunk** of a **30-second** window using that chunk’s own average and spread.

### Step by step

1. **Get one 30-second window** of PPG at **125 Hz** → exactly **3,750 samples**.  
   - Watch path: quality gate + resample (`anyppg_watch_prep_v1`).  
   - CSV demo path: interpolate print times onto the same 125 Hz grid.

2. **Split that window into three chunks of 10 seconds** → **1,250 samples each**:  
   - Chunk A = samples 0–1249  
   - Chunk B = samples 1250–2499  
   - Chunk C = samples 2500–3749  

3. **For each chunk independently:**  
   - Compute the **mean** (average value) of those 1,250 numbers.  
   - Compute the **standard deviation** (how spread out they are).  
   - If the chunk is basically flat (`std` tiny), **reject** — no BP guess.  
   - Replace each sample with:  
     `(sample − mean) / (std + a tiny epsilon)`  
   - That puts each chunk on a similar scale so LED brightness / ADC units don’t dominate the model.

4. **Feed the full 3,750 normalized samples** into the AnyPPG ONNX encoder (still one window; the three chunks were only for how we scale).

5. **Separate second normalization** happens on the **encoder embedding** before the ridge BP head (using saved `feature_mean` / `feature_std` in `ridge_head.json`). That is **not** the same as the raw PPG chunk step above — it scales the model’s internal features the way training did.

### What this is *not*

| People sometimes mean | What we do for AnyPPG |
|---|---|
| Per-beat normalize (cut each heartbeat, scale each beat) | **No** — that was the older **cBP-Tnet** idea; archived, not shipping |
| One mean/std for the whole 30 s | **No** — we use **three** chunk mean/stds |
| Flipping polarity / picking red vs IR as “normalization” | Separate topics; not done automatically yet (needs live data) |

Code: `standardizeWindow` in [`services/anyppg/core.js`](../services/anyppg/core.js). Watch prep calls the same function after resampling in [`services/recordings/qualityGate.js`](../services/recordings/qualityGate.js).

**One-liner you can send your boss:**  
> “AnyPPG takes 30 seconds at 125 Hz, splits it into three 10-second pieces, and scales each piece by its own mean and standard deviation before the neural net. We are not doing per-heartbeat normalization.”

---

## 3. What the PDF says vs what the app actually runs

**[`docs/reference/PPG_Filtering.pdf`](reference/PPG_Filtering.pdf)** describes:

- **Watch:** validate samples, score motion/quality, pick a clean 30 s window, optionally denoise, then send raw (~100 Hz) data to the phone.  
- **Phone (older write-up):** steps that match the older **cBP-Tnet** model (Kalman, beat cutting, per-beat normalize).

**This app’s shipping path is AnyPPG**, not that full cBP-Tnet phone stack. We followed the PDF’s **who does what** (watch vs phone), but the phone still feeds **AnyPPG** as above. We did **not** port AMPD / Kalman / per-beat normalize into the live path.

---

## 4. What changed in the code

### Phone preprocessing (`feature/watch-prep-gaps`)

- **Quiet-window crop:** Prefer the quietest 30 s, not always the start of the file.  
- **Sample fixtures + tests** (good / shaky / flat / mixed / firmware-filtered).  
- **Resample checks** (100 Hz → 125 Hz → 3750 samples).  
- **Firmware-filtered label** so we don’t double-filter or pretend filtered data is raw ADC.  
- **Host CLI:** `node tools/anyppg/run-watch-recording.cjs <file.json>`  
- **Sim → inference hook** after a fake BLE upload (injectable; tests use a mock).

### Auth / login (already on `main`)

- Login/onboarding + **24-hour on-phone PPG cache** merged to `main`.  
- Still **local-dev** accounts until Cognito. Fresh native build after pull.

### DynamoDB

- Left for your teammate.

---

## 5. What did not change

- No real Bluetooth / live watch capture.  
- No DynamoDB wiring.  
- No cBP-Tnet retraining or per-beat normalize on the AnyPPG path.  
- No hardware threshold tuning (polarity, red vs IR, SQI, NLMS) — needs live data.  
- No clinical validation claim.

---

## 6. How to try it

```bash
npm run test:recordings
npm run test:anyppg
node tools/anyppg/run-watch-recording.cjs tests/fixtures/sync-recordings/accept-low-motion-32s.json
```

---

## 7. Tickets (after dedupe)

**Still useful open work:** #7–#15 (contract through validation), plus #26 (persist BP history), #27 (packet→JSON builder), #28 (red→IR fallback).

**Closed as done or duplicate:** #19–#25 (prep work), #29 (docs dup of #16), #30 (KAN-20 on main), #31 (dup of #13–#15), #32 (cBP archived).

---

## 8. What’s still waiting on live watch data

Polarity, channel pick, SQI thresholds, NLMS A/B, retry spacing, wrist vs finger / cuff, real BLE, 15-minute field schedule.
