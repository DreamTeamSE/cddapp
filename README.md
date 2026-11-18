# CDD blood-pressure research app

Updated November 9, 2026. **Team production setup still targets `main` after merges.** Active development for issues #7–#16 lives on `feature/ppg-pipeline-improvements`.

The Blood Pressure page imports the team’s CSV and displays **experimental AnyPPG estimates** (red and infrared separately). These numbers are not validated against matching cuff readings and are not written to the health journal.

## Project overview and architecture

CDD is an Expo / React Native research app for wearable PPG blood-pressure prototyping. The intended end-to-end path is:

**Watch sensors → firmware recording → BLE transfer → phone quality gates → local AnyPPG ONNX inference → prototype estimate history**

| Layer | Current role |
|---|---|
| Sensors (planned) | AFE4404 + SFH 7050A (PPG) + BMI270 (IMU), ESP32-C3 controller |
| Recording contract | `cdd_ppg_imu_recording_v1` (`docs/recording-contract.md`) |
| Phone app | Expo SDK 57, customized `ios/` workspace, `onnxruntime-react-native` |
| BP model | **AnyPPG only** — PyTorch checkpoint exported to ONNX + saved ridge head |
| Historical research | cBP-Tnet archived under `archive/cbp-tnet/` (not loaded) |

### AnyPPG as the only active BP model

| Term | Meaning |
|---|---|
| **AnyPPG encoder** | CNN that maps a prepared PPG window to embeddings |
| **Ridge head** | Saved linear predictor → SBP / DBP (`ridge_head.json`) |
| **ONNX** | Portable encoder weights (`anyppg_encoder.onnx`) |
| **ONNX Runtime** | Executes the encoder on-device (`onnxruntime-react-native`) |

Deployment chain: **PyTorch training artifacts → ONNX export (`tools/anyppg/export.py`) → bundled assets → React Native native inference**. There is no cloud prediction server for this path. Expo Go cannot run it.

Model ID: `anyppg_frozen_ridge_raw_v1`  
Encoder SHA-256: `1cccde2235544b4b055dc2dd73e481cde9d0492ea7796b2b468e03b7f0472ebe` (see `assets/models/anyppg/manifest.json`).

### Local iPhone inference

`services/anyppg/inference.native.ts` and `watchInference.native.ts` load the bundled ONNX asset and create an ONNX Runtime session with **`graphOptimizationLevel: 'disabled'`** (required for parity). Inference runs on the phone CPU.

**Physical verification (CSV import, Nov 9, 2026):** documented in [`docs/evidence/ANYPPG_IPHONE_VERIFICATION.md`](docs/evidence/ANYPPG_IPHONE_VERIFICATION.md). That run confirms on-device execution and numerical match to the legacy SparkFun regression fixture. It does **not** prove clinical accuracy or new-watch hardware validity.

## Hardware plan vs software today

| Item | Status |
|---|---|
| AFE4404 + SFH 7050A + BMI270 + ESP32-C3 | **Hardware plan** — firmware/fixtures from this stack not yet validated in-app |
| Legacy SparkFun CSV (`time_stamp_millis,RawRed,RawIR`) | **Supported** for AnyPPG CSV demo / regression; AC / baseline-subtracted; **no IMU**; not new-watch data |
| Sync watch JSON (`cdd_ppg_imu_recording_v1`) | **Software contract + synthetic fixtures + dev watch path** |

## Legacy SparkFun CSV vs new PPG/IMU watch recordings

| | Legacy SparkFun CSV | New watch recording |
|---|---|---|
| Kind | `cdd_serial_csv_v1` | `cdd_ppg_imu_recording_v1` |
| Channels | Red + IR print times | PPG (+ provenance) + IMU accel/gyro |
| App entry | Blood Pressure → Import CSV | Dev → Watch pipeline (and inspect screen) |
| Model path | `inferCsv` | `inferWatchRecording` after motion + quality gate |
| Validated on iPhone | Yes (CSV, Nov 9 2026) | Software/synthetic only so far |

The watch path **rejects** SparkFun CSV on purpose — use the CSV card for that format.

## Preprocessing, quality, scheduling, BLE, history

**CSV AnyPPG (`anyppg_csv_legacy_ac_v1`):** interpolate to 125 Hz from print timestamps → 30 s windows → three 10 s chunks → per-chunk mean/std → ONNX → ridge head. Red and IR are independent.

**Watch prep (`anyppg_watch_prep_v1`):** motion selection → PPG quality gate (flat/clip/gap/motion) → resample to 125 Hz / 3750 samples → same chunk normalization → ONNX. Quality rejection is never bypassed to invent a BP.

**15-minute scheduling:** `IntervalScheduler` software state machine + foreground simulation (`PipelineSimCard`). Not firmware- or background-iOS-verified.

**BLE transfer:** chunk encode/assemble/dedup/integrity helpers + mocked handler tests + sim. Live radio unverified.

**Prototype history:** in-memory estimate/interval store (`sessionHistory` / `estimate-history`); accepted estimates only; missed intervals do not reuse prior BP; separate from the health journal.

## Implemented vs hardware-dependent

### Implemented in software (this branch)

- AnyPPG CSV import UI and native ONNX path  
- Sync recording contract, fixtures, inspect screen  
- Motion selection, quality gate, watch inference orchestration  
- Interval scheduler + recording-transfer libraries  
- Foreground scheduler/BLE simulation and `__DEV__` watch pipeline  
- Prototype session history  
- Host test suites (recordings / AnyPPG / measurement services)  
- cBP-Tnet UI/assets removed from the live app tree  

### Requires real hardware / field work

- AFE4404/BMI270 acquisition matching the contract  
- Live BLE upload from the watch  
- Real 15-minute automated capture on device  
- Threshold tuning on real signals  
- Cuff-paired accuracy, coverage, battery (`docs/evaluation-protocol.md`)  
- Motion-trigger (#14) and IMU denoise (#15) experiments (flags off)

Issue-by-issue detail: [`docs/IMPLEMENTATION_STATUS.md`](docs/IMPLEMENTATION_STATUS.md)  
Prioritized backlog: [`docs/NEXT_STEPS.md`](docs/NEXT_STEPS.md)

---

## Does importing a CSV calculate new predictions?

**Yes.** “Import CSV & calculate” runs the selected file through the trained AnyPPG path on the phone. It does not look up a saved answer by filename.

| Button | Behavior |
|---|---|
| **Import CSV & calculate** | Prepare recording → ONNX + ridge head → display estimates |
| **Check model with a synthetic signal** | Bundled synthetic through the same path; compare to saved Python references (±0.01 mmHg) |

Processing an already recorded file is much faster than wall-clock recording length (e.g. ~182 ms for the 48.7 s team CSV on iPhone).

---

## How teammates run the app

**BP inference needs an installed CDD native app with ONNX Runtime. Expo Go is unsupported.** Prefer Release for standalone demos; Debug + Metro for day-to-day JS work.

| Goal | How |
|---|---|
| iPhone CSV demo | Build existing `ios/cddapp.xcworkspace` in Xcode (Release) |
| Live JS reload | Debug development build + `npx expo start --dev-client` |
| Windows + iPhone | Signed EAS / Mac-built IPA (see below) |
| Mac + Android | `npx expo run:android --device` (not yet project-verified) |

### First-time setup: Mac + iPhone

Requires Node.js **22.13+**, Xcode **26.4+** (this repo has been built with **Xcode 27** using the customized `ios/` project and SDK 57 scene opt-in), Git, npm, and a physical iPhone.

```bash
git clone --branch main https://github.com/ethankrol/cddapp.git
cd cddapp
# For this feature branch before merge:
# git fetch && git switch feature/ppg-pipeline-improvements
npm ci
npx pod-install
npm run test:roadmap
npx tsc --noEmit
open ios/cddapp.xcworkspace
```

Keep the customized `ios/` tree. **Do not run a clean Expo prebuild** unless the team explicitly decides to regenerate native projects. Open **`cddapp.xcworkspace`**, not the `.xcodeproj` alone.

If CocoaPods script phases fail with a missing Homebrew Node path, set `ios/.xcode.env.local`:

```bash
export NODE_BINARY=$(command -v node)
```

### Install on an iPhone with Xcode

1. Unlock the iPhone, connect USB, trust the computer; enable **Developer Mode** if asked.  
2. Xcode → **cddapp** target → **Signing & Capabilities** → your team. Align `app.json` `ios.bundleIdentifier` if you change the bundle id locally.  
3. Scheme **cddapp**, destination = your phone.  
4. **Product → Scheme → Edit Scheme → Run → Info → Release**, then Run.  
5. Trust the developer profile under **Settings → General → VPN & Device Management** if prompted.

Release builds run from the home-screen icon without Metro after install.

### Try the CSV demo

1. Optional: **Check model with a synthetic signal** (expect Python agreement within 0.01 mmHg).  
2. Copy the team CSV (`time_stamp_millis,RawRed,RawIR`) into Files.  
3. **Import CSV & calculate**; choose Finger / Wrist / Not sure (metadata only).  
4. Read separate Red / Infrared cards; share the report if needed.

Documented Nov 9 iPhone CSV result: [`docs/evidence/ANYPPG_IPHONE_VERIFICATION.md`](docs/evidence/ANYPPG_IPHONE_VERIFICATION.md).

### Dev-only watch pipeline

On **Debug** builds, Home shows **Watch pipeline (dev)** (`__DEV__`). Use synthetic low/high-motion fixtures, sync JSON import, scheduler/BLE simulation, and the integration panel. Do not treat simulation as live BLE or background validation.

### Update an existing checkout

```bash
git status   # commit or stash local work first
git switch main   # or feature/ppg-pipeline-improvements while integrating
git pull --ff-only
npm ci
npx pod-install
npm run test:roadmap
npx tsc --noEmit
open ios/cddapp.xcworkspace
```

Pulling Git does **not** update an already installed Release app — rebuild/reinstall.

### Optional: develop with live code updates

```bash
npx expo start --dev-client
```

Use the Debug scheme. Native dependency changes still require a rebuild.

### Windows + iPhone: signed cloud build

You cannot build iOS locally on Windows. Use EAS or a Mac teammate. After `npm ci` and host tests:

```powershell
npx eas-cli@latest login
npx eas-cli@latest build:configure --platform ios
```

Maintainers must merge example profiles carefully with this repo’s customized native project and ONNX dependency. Register devices (`eas device:create`), then build `development` or `preview` profiles as appropriate.

### Mac + Android

Proposed path only — **not claimed verified** for AnyPPG on Android in this project:

```bash
npm ci
npm run test:roadmap
npx tsc --noEmit
adb devices
npx expo run:android --device
```

Preserve customized `ios/` if Android tooling generates `android/`.

### Common setup problems

- Wrong Xcode tools: `xcode-select -p` → `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`  
- Missing pods: `npm ci` && `npx pod-install`  
- Stale UI: rebuild/reinstall Release  
- Expo Go QR: use the installed CDD app instead  
- Xcode 27 / `@expo/ui` SearchableModifier errors: ensure CocoaPods ExpoUI matches `node_modules/@expo/ui` (see recent `Podfile.lock`); do not delete `@expo/ui` blindly  

---

## Running tests

```bash
npm run test:recordings   # sync contract, quality gate, motion, storage, …
npm run test:anyppg       # AnyPPG core, legacy CSV ONNX, watch integration, …
npm test                  # interval scheduler, recording-transfer, pipeline sim, …
npm run test:roadmap      # all of the above
npx tsc --noEmit
npx expo lint
```

Latest host counts on this branch (Nov 9, 2026 review): **26 + 15 + 25 = 66** passing.

---

## Which model files?

| Flow | Assets | Status |
|---|---|---|
| CSV / watch AnyPPG (active) | `assets/models/anyppg/anyppg_encoder.onnx` + `ridge_head.json` | Host tests + physical iPhone CSV verified |
| Export / reproduce | `tools/anyppg/source/*`, `tools/anyppg/export.py` | Frozen candidate; no retrain in this work |
| Historical cBP-Tnet | `archive/cbp-tnet/` | Inactive |

Do not change `graphOptimizationLevel` or model hashes without rerunning export parity checks.

---

## Documentation map

- [Implementation status #7–#16](docs/IMPLEMENTATION_STATUS.md)  
- [Next steps](docs/NEXT_STEPS.md)  
- [iPhone CSV verification evidence](docs/evidence/ANYPPG_IPHONE_VERIFICATION.md)  
- [Recording contract](docs/recording-contract.md)  
- [AnyPPG ↔ watch compatibility](docs/anyppg-watch-compatibility.md)  
- [Evaluation protocol](docs/evaluation-protocol.md)  
- [Roadmap](CDD_Next_Tasks_Roadmap.md)  
- [AnyPPG CSV demo detail](docs/AnyPPG_CSV_Demo.md)  
- [cBP-Tnet cleanup inventory](docs/archive/cbp-tnet-cleanup-inventory.md)  
- [Archived cBP-Tnet](archive/cbp-tnet/README.md)  
- Plain-language / calibration docs under `docs/` may still contain **historical cBP-Tnet** sections — treat those as archive context.

Keep private CSVs out of Git (e.g. `private-recordings/`). The committed SparkFun fixture is for regression only.
