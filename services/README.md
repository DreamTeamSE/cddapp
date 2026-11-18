# Service scaffold

`database.ts` implements profile/journal SQLite storage. Active BP inference lives in
`anyppg/` (local ONNX Runtime + ridge head). Shared measurement types, BLE reassembly,
packet validation, the synchronized PPG/IMU contract (`recordings/syncContract`),
quality gating (`recordings/qualityGate`), interval scheduling, recording-transfer integrity,
and in-memory prototype estimate history are implemented as testable modules.
Legacy cBP-Tnet adapters were removed from `services/`; historical copies are under
`archive/cbp-tnet/`. Importing these modules does not connect a physical device or claim
hardware validation. Wire UUID adapters and AFE4404/BMI270 firmware behavior remain unconfirmed.

The remaining temporary exported names and `never` return types mark unimplemented entry points,
not final interfaces. Replace them with the typed contracts and implementations in
[the ordered implementation plan](../docs/service-foundations-implementation-plan.md).
The domain types file now defines the deliverable 1 contracts.

| Folder | Responsibility |
| --- | --- |
| `device/` | BLE service interface, packet decoder boundary, validation/reassembly and demo placeholders. |
| `measurement/` | Input checks, clocks, future end-to-end coordinator and validation placeholders. |
| `prediction/` | Artifact-backed inference adapter and explicitly labeled fixed-output mock. |
| `sync/` | Local rolling PPG retention contracts, sync state/retry flow and DynamoDB writer adapter. |
| `readings/` | Future local reading repository and migration placeholders. |
| `demo/` | Explicitly invoked future full-pipeline composition. |

No new module is wired to the UI. Do not add production BLE constants, quality rules,
preprocessing, or a real predictor until the hardware/ML contracts are available.

See [initial-services-integration.md](../docs/initial-services-integration.md) for
the interfaces, setup points, boundaries, and test commands for the inference, AWS
sync, and BLE services.

## Validation

After dependencies were installed, `npm test` passed all 18 packet, inference, AWS
sync, and BLE service tests. `npm run typecheck` and `npm run lint` also passed.
An earlier dependency installation attempt failed with `ENOSPC`; this was resolved
after disk space was freed. These are the current validation results.
