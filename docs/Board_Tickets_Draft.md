# Board tickets to add (DreamTeamSE project 11)

Paste these into the project board. Columns are suggestions from the Nov 2026 preprocessing plan. **Do not create DynamoDB tickets here** — a teammate owns that.

## How to add them (Cursor could not write to the private project without your GitHub login)

1. Open the board: https://github.com/orgs/DreamTeamSE/projects/11/views/1  
2. Click **+ Add item** in the target column (**Ready** or **Backlog**).  
3. Type the ticket title (e.g. `WATCH-01 — Crop recording…`), press Enter.  
4. Open the new card → add the body text from the matching section below (copy the **Why / Work / Done when** bullets).  
5. Optional: convert the draft to a real repo Issue via the card’s “Convert to issue” → choose `DreamTeamSE/cddapp`.

Alternatively create issues first, then drag them onto the board:

```bash
# one-time
gh auth login

# example
gh issue create --repo DreamTeamSE/cddapp \
  --title "WATCH-01 — Crop recording to motion-selected window before quality/prep" \
  --body-file - <<'EOF'
Why: ...
EOF
```

Then on the project board: **+ Add item** → search the issue number.

---

## Ready

### WATCH-01 — Crop recording to motion-selected window before quality/prep

**Column:** Ready  

**Why:** The watch pipeline (PPG Filtering.pdf Stage 5) picks the quietest 30 s window, but the phone still quality-checks and resamples from the start of the whole file.  

**Work:**  
- Slice PPG+IMU to each `selectLowMotionSegments` candidate (best RMS first).  
- Run quality gate + AnyPPG prep only on that slice.  
- Files: `services/anyppg/watchInference.js`, `services/recordings/qualityGate.js`.  

**Done when:** A mixed-motion fixture (noisy start, quiet middle/end) is accepted after crop and would fail if prep always used t₀.

---

### WATCH-02 — Commit 32s+ sync fixtures + file-based quality-gate tests

**Column:** Ready  

**Why:** Current `valid.json` is schema-only (~3 s). Firmware needs drop-in JSON shaped like PDF Stage 7 (raw ~100 Hz PPG + IMU).  

**Work:** Commit accept / reject-high-motion / reject-flatline / mixed-motion fixtures under `tests/fixtures/sync-recordings/` and load them from `tools/recordings/tests/`.  

**Done when:** `npm run test:recordings` covers file-based accept/reject without building all cases only in memory.

---

### WATCH-04 — Golden tests for 100→125 Hz resample

**Column:** Ready  

**Why:** PDF phone step “Resample to 125 Hz”; AnyPPG grid is 125 Hz × 30 s = 3750 samples.  

**Work:** Deterministic tests for `resampleToTarget` in `qualityGate.js` (known input → known output length/values).  

**Done when:** Host tests fail if resample length or interpolation contract regresses.

---

### WATCH-07 — Host CLI `run-watch-recording` for CI / manual runs

**Column:** Ready  

**Why:** Team needs one command to run file → motion → quality → AnyPPG without the iPhone UI.  

**Work:** `tools/anyppg/run-watch-recording.cjs` reading sync JSON, printing a JSON report, non-zero exit on reject/error.  

**Done when:** CLI accepts a low-motion fixture and rejects a high-motion fixture with onnxruntime-node.

---

### AUTH-MERGE — Rebase auth-onboarding onto main and resolve conflicts

**Column:** Ready  

**Why:** PR #5 is draft and conflicted with main (AnyPPG + Android). KAN-20 SQLite 24h cache lives on auth but not on main.  

**Work:**  
- Merge/rebase `origin/main` into `feature/auth-onboarding`.  
- Resolve `app.json`, `package.json`, `package-lock.json`, `ios/Podfile.lock`.  
- Fix test script if Node rejects `--experimental-default-type=module`.  
- Keep local-dev auth; Cognito later. Do **not** merge until undrafted and reviewed.  

**Done when:** Branch builds/tests green on tip that includes main’s AnyPPG work + auth + KAN-20; PR #5 ready for review.

---

## Backlog

### WATCH-03 — Honor `firmware_filtered` provenance in prep + estimate metadata

**Column:** Backlog  

Record signal provenance on estimates; never silently double-filter. Prefer `raw_adc` from watch.

---

### WATCH-06 — Persist prototype BP history / intervals in SQLite

**Column:** Backlog  

Durable estimate history across app restarts (separate from journal). Injectable store; in-memory default for tests.

---

### WATCH-08 — Pipeline sim: complete transfer → `runWatchRecording`

**Column:** Done (implemented on `feature/watch-prep-gaps`)  

`createPipelineSimulator({ afterTransferComplete })` + `createPrototypePipeline().runWatch(...)`.

---

### WATCH-09 — SensorPacket / complete window → sync JSON builder stub

**Column:** Backlog  

Map transfer-complete payloads into `cdd_ppg_imu_recording_v1` without guessing live BLE wire format.

---

### WATCH-10 — Watch channel policy: red then IR fallback (no fusion)

**Column:** Backlog  

Soft stand-in until live red/IR/green A/B (PDF hardware sticky).

---

### WATCH-11 — Clarify #16 as AnyPPG chunk-norm docs; unlink cBP retrain

**Column:** Backlog (docs)  

Close or rewrite issue #16 so it does not drive cBP-Tnet beat retraining for the shipping path.

---

### KAN-20-MAIN — Verify SQLite 24h PPG cache on main after AUTH-MERGE

**Column:** Backlog  

QA after auth merges: append / list-since / prune-24h on device or unit tests on main.

---

### PDF-HW — Hardware validation sticky notes

**Column:** Backlog (blocked on live watch)  

Polarity vs MIMIC, red/IR/green pick, SQI label/threshold tune, NLMS A/B, retry count/spacing.

---

### PDF-CBP — cBP-Tnet model-fix sticky notes

**Column:** Backlog / archived unless team reactivates cBP  

Per-beat retrain, upstroke timing, wrist-vs-finger cuff gap, save norm stats for that stack.

---

## Leave alone for now

- **Validate accuracy / coverage / battery** — already on board; needs hardware + cuff.  
- **DynamoDB / AWS sync** — teammate.  
- **15‑min schedule / BLE transfer / on-watch motion** — hardware/firmware track.  
