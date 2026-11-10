# Legacy SparkFun recording — regression scope

| Item | Status |
|---|---|
| Source | `CDD_DataCollection.zip` → `data_collection/datalogs/[redacted_participant]_09_23_26.csv` |
| Repo fixture | `tests/fixtures/anyppg/legacy_sparkfun_ac_20260923.csv` |
| Companion files | firmware + logger copies under `tests/fixtures/anyppg/` |
| Hardware | Previous SparkFun Bio Hub path (**not** AFE4404 / SFH 7050A / BMI270) |
| IMU | Absent |
| Paired cuff | Absent |

## Tests this recording can support

- Legacy serial CSV parse/inspect (`cdd_serial_csv_v1` / `legacy_ac`)
- AnyPPG 125 Hz interpolation + 10 s chunk normalization stability
- Host AnyPPG ONNX + ridge-head numeric regression vs documented window BP values

## Tests that still require new watch data

- `cdd_ppg_imu_recording_v1` sync contract with PPG + IMU
- Motion selection / IMU quality gating on real BMI270 streams
- BLE chunk transfer of synchronized recordings
- 15-minute interval capture on wearable firmware
- AFE4404 polarity/rate/contact compatibility with AnyPPG
- Clinical / cuff BP accuracy, coverage, and battery (#13)
