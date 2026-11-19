# What we changed (plain English)

**Audience:** teammates who may not live in the ML code every day.  
**Branches:** preprocessing on `feature/watch-prep-gaps`; auth merge readiness on `feature/auth-onboarding`.  
**Date context:** November 2026.

---

## 1. What we were trying to do

The watch will eventually send a short clip of optical heart-signal (PPG) plus motion (IMU). The phone should:

1. Check the clip is usable.  
2. Pick the quietest ~30 seconds if the clip is longer / partly noisy.  
3. Resample to the rate the blood-pressure model expects (125 samples per second).  
4. Run AnyPPG and store a clearly labeled **prototype** estimate.

We did **not** wait for live watch data. Everything here runs on synthetic JSON fixtures that look like the planned watch file format.

---

## 2. What the PDF says vs what the app actually runs

**PPG Filtering.pdf** describes:

- **Watch:** validate samples, score motion/quality, pick a clean 30 s window, optionally denoise, then send raw (~100 Hz) data to the phone.  
- **Phone (older write-up):** steps that match the older **cBP-Tnet** model (Kalman, beat cutting, per-beat normalize).

**This app’s shipping path is AnyPPG**, not that full cBP-Tnet phone stack. So we followed the PDF’s **who does what** (watch vs phone), but the phone still feeds **AnyPPG** (30 s window → three 10 s chunks with chunk mean/std). We did **not** port AMPD / Kalman / per-beat normalize into the live path.

---

## 3. What changed in the code

### Phone preprocessing (`feature/watch-prep-gaps`)

- **Quiet-window crop:** If the recording starts with lots of movement and then settles, the app now tries the quiet 30 s candidates from motion selection and only runs quality + model prep on that slice — not always from the very beginning of the file.  
- **New sample files:** Longer sync JSON fixtures under `tests/fixtures/sync-recordings/` (good clip, shaky clip, flatline, mixed motion, firmware-filtered).  
- **Resample checks:** Automated tests that 100 Hz → 125 Hz still produces the expected 3750-sample window.  
- **Firmware-filtered label:** If the watch says data was already filtered, the phone records that, does **not** pretend the signal is raw ADC, and still avoids applying a second mystery filter.  
- **One-command host runner:**  
  `node tools/anyppg/run-watch-recording.cjs <file.json>`  
  prints a JSON report (accepted / rejected) without opening the iPhone UI.  
- **Sim → inference hook:** after a simulated BLE upload finishes, an optional callback can run the watch pipeline (tests use a mock; real ONNX stays injectable).  
- **Board ticket draft:** paste-ready text in `docs/Board_Tickets_Draft.md`.

### Auth branch merge readiness (`feature/auth-onboarding`)

- Merged current **main** (AnyPPG + Android) into the login/onboarding branch.  
- Fixed conflicts in package / lock / Podfile files.  
- Kept login extras (`expo-secure-store`, crypto, SQLCipher) **and** main’s newer Expo versions.  
- Tests on that tip: **63/63** service tests pass, including the **24-hour SQLite PPG cache**.  
- Details: `docs/AUTH_MERGE_READY.md`.  
- **PR #5 is still draft** — ready for review after push; not merged to main yet.

### DynamoDB

- **Left alone.** Adapter stays a stub for your teammate.

---

## 4. What did not change

- No real Bluetooth / live watch capture.  
- No DynamoDB table wiring or AWS credentials in the app.  
- No cBP-Tnet retraining or per-beat normalize on the AnyPPG path.  
- No hardware threshold tuning (polarity, red vs IR, SQI labels, NLMS A/B) — those need live data.  
- No claim that estimates are clinically validated.

---

## 5. How to try it

From the prep branch (or once those files are merged):

```bash
# Quality / fixture / resample tests
npm run test:recordings

# AnyPPG + CLI tests
npm run test:anyppg

# Manual CLI on a good synthetic clip
node tools/anyppg/run-watch-recording.cjs tests/fixtures/sync-recordings/accept-low-motion-32s.json

# Manual CLI on a bad (shaky) clip — expect exit code 2
node tools/anyppg/run-watch-recording.cjs tests/fixtures/sync-recordings/reject-high-motion-32s.json
```

Auth branch tip (after pull):

```bash
git checkout feature/auth-onboarding
npm test
```

---

## 6. New board tickets (and columns)

Full text: [`docs/Board_Tickets_Draft.md`](Board_Tickets_Draft.md).

| Ticket | Column |
|---|---|
| WATCH-01 Quiet-window crop before prep | Ready |
| WATCH-02 32s+ fixtures + file tests | Ready |
| WATCH-04 100→125 Hz golden tests | Ready |
| WATCH-07 Host CLI runner | Ready |
| AUTH-MERGE Rebase auth onto main / undraft PR #5 | Ready |
| WATCH-03 firmware_filtered provenance | Backlog |
| WATCH-06 Persist BP history in SQLite | Backlog |
| WATCH-08 Sim → inference hook | Backlog |
| WATCH-09 Packet → sync JSON builder stub | Backlog |
| WATCH-10 Red then IR fallback | Backlog |
| WATCH-11 Clarify issue #16 / AnyPPG docs | Backlog |
| KAN-20-MAIN Verify 24h cache on main after auth merge | Backlog |
| PDF-HW Hardware sticky notes | Backlog (blocked on live watch) |
| PDF-CBP cBP model-fix stickies | Backlog / archived unless cBP returns |

---

## 7. What’s still waiting on live watch data

- Polarity (wave upside-down or not vs training data).  
- Which light channel works best (red / IR / green).  
- Tuning “how clean is clean enough” (SQI / motion limits).  
- Optional NLMS denoise A/B.  
- How often to retry a failed quiet window.  
- Wrist vs finger / cuff comparison.  
- Real BLE transfer and 15-minute schedule on the device.

Until then, keep using the synthetic fixtures and the CLI so the phone path stays ready for the first real Stage-7 uploads.
