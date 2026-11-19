# Services

Active blood-pressure inference is **AnyPPG only** (`anyppg/` — local ONNX Runtime + ridge head).

Legacy **cBP-Tnet** adapters were removed from `services/`. Historical code/weights: [`archive/cbp-tnet/`](../archive/cbp-tnet/). Historical write-ups: [`docs/archive/cbp-era/`](../docs/archive/cbp-era/).

| Folder | Responsibility |
| --- | --- |
| `anyppg/` | CSV + watch AnyPPG prepare, ONNX inference, session history |
| `recordings/` | Sync contract, quality gate, CSV helpers |
| `device/` | BLE transfer helpers, motion selection, pipeline simulation |
| `measurement/` | Interval scheduler, prototype pipeline glue |
| `sync/` | Rolling 24h PPG cache contracts (+ SQLite impl on auth/`main`), AWS adapter stubs |
| `readings/` | Prototype estimate history |
| `auth/`, `profile/` | Login / onboarding (on `main`) |

Importing these modules does not connect a physical device or claim clinical accuracy. See [`docs/README.md`](../docs/README.md).
