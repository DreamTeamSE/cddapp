# Synchronized PPG/IMU recording contract

**Contract kind:** `cdd_ppg_imu_recording_v1`  
**Schema version:** `1`  
**Status:** Phone/firmware interface definition for prototype development.  
**Hardware caveat:** AFE4404 + SFH 7050A + BMI270 acquisition rates, LED/gain settings, and clock behavior are **not yet confirmed on physical hardware**. Values marked provisional must be filled from measured firmware configuration before claiming a device is compatible.

This contract is separate from the legacy demonstration formats:

| Format | Kind / header | Role |
|---|---|---|
| Legacy PPG JSON | `cdd_ppg_recording_v1` | Single-channel engineering import/preview |
| Legacy serial CSV | `time_stamp_millis,RawRed,RawIR` | AnyPPG CSV demo only |
| Raw serial CSV | six-column diagnostic | Inspection only; AnyPPG rejects |
| **This contract** | `cdd_ppg_imu_recording_v1` | Synchronized PPG + IMU for wearable → BLE → phone |

## Design rules

1. Never silently label filtered data as raw. `ppg.provenance` must be `raw_adc` or `firmware_filtered` (or both streams if both are delivered).
2. Do not assume PPG and IMU share the same sample rate. Declare each rate independently.
3. BMI270 acceleration is linear acceleration in m/s²; gyroscope is angular rate in rad/s. These are **not** displacement or orientation coordinates.
4. Monotonic device sample timing is authoritative for alignment. Phone arrival time is metadata only.
5. Incomplete, out-of-order, checksum-failing, or incompatible-version payloads must be rejected before inference.
6. Legacy CSV print timestamps are **not** this contract’s sample clock.

## Top-level fields

| Field | Type | Required | Notes |
|---|---|---|---|
| `schemaVersion` | integer | yes | Must be `1` for this document |
| `kind` | string | yes | `cdd_ppg_imu_recording_v1` |
| `recordingId` | string | yes | Stable unique ID for this contiguous candidate |
| `deviceId` | string | yes | Wearable identity |
| `sessionId` | string | yes | Power-on / pairing session |
| `intervalId` | string | yes | Scheduled 15-minute interval ID |
| `captureStartedAt` | ISO-8601 UTC ms | yes | Wall clock at capture start when available |
| `uploadedAt` | ISO-8601 UTC ms or null | yes | Set by phone after integrity-verified receipt |
| `ppg` | object | yes | Optical samples and settings |
| `imu` | object | yes | BMI270 accel + gyro samples |
| `alignment` | object | yes | Cross-sensor timing policy |
| `sensorSettings` | object | yes | Optical/IMU configuration provenance |
| `transfer` | object | yes | Chunking / integrity metadata |
| `qualityHints` | object | no | Firmware motion/quality scores (advisory) |

Identifier alphabet: `A–Z a–z 0–9 _ -`, length 1–64.

## PPG block

```json
"ppg": {
  "sampleRateHz": 100,
  "timingSource": "sample_clock",
  "channels": {
    "red": {
      "available": true,
      "wavelengthNm": 660,
      "units": "adc_counts",
      "provenance": "raw_adc",
      "adcMin": 0,
      "adcMax": 1048575
    },
    "infrared": {
      "available": true,
      "wavelengthNm": 950,
      "units": "adc_counts",
      "provenance": "raw_adc",
      "adcMin": 0,
      "adcMax": 1048575
    }
  },
  "samples": [
    [0, 0.0, 512000, 498000, 0]
  ]
}
```

Sample tuple: `[sequence, offset_ms, red, infrared, missing_flag]`

- `sequence`: nonnegative integer, expected contiguous when `missing_flag=0`
- `offset_ms`: milliseconds from capture start on the PPG clock domain
- `red` / `infrared`: finite float32-range values, or `null` when that channel is unavailable **and** `channels.*.available` is false
- `missing_flag`: `0` present, `1` placeholder for a known missing slot (do not invent interpolated physiology)

`sampleRateHz` is provisional until measured. AnyPPG currently expects a **125 Hz** model grid after explicit resampling on the phone; firmware may deliver a different native rate.

## IMU block

```json
"imu": {
  "accelSampleRateHz": 100,
  "gyroSampleRateHz": 100,
  "accelUnits": "m/s^2",
  "gyroUnits": "rad/s",
  "timingSource": "sample_clock",
  "samples": [
    [0, 0.0, 0.12, -0.05, 9.71, 0.01, -0.02, 0.0, 0]
  ]
}
```

Sample tuple: `[sequence, offset_ms, ax, ay, az, gx, gy, gz, missing_flag]`

Gravity is present in acceleration unless firmware documents removal. Motion gating must state whether it removes gravity before RMS.

## Alignment

```json
"alignment": {
  "clockDomain": "device_monotonic",
  "ppgImuToleranceMs": 5,
  "ppgEpochOffsetMs": 0,
  "imuEpochOffsetMs": 0
}
```

- `ppgImuToleranceMs`: maximum allowed absolute offset between corresponding PPG and IMU sample times after applying epoch offsets.
- Do not assume both streams are 100 Hz. Alignment uses timestamps, not index equality alone.
- If either stream cannot meet the tolerance for a candidate window, reject the window.

## Sensor settings (provisional placeholders)

```json
"sensorSettings": {
  "optical": {
    "afe": "AFE4404",
    "emitter": "SFH7050A",
    "ledCurrentMa": null,
    "gain": "unconfirmed",
    "site": "wrist_unconfirmed"
  },
  "imu": {
    "model": "BMI270",
    "accelRangeG": null,
    "gyroRangeDps": null
  },
  "firmwareVersion": "unconfirmed"
}
```

Null/unconfirmed fields are allowed in fixtures and early captures; production acceptance may require them to be populated.

## Transfer / integrity

```json
"transfer": {
  "schemaVersion": 1,
  "chunkCount": 1,
  "chunkIndex": 0,
  "payloadSha256": "hex-or-null-for-local-fixtures",
  "encoding": "json_recording_v1"
}
```

BLE notifications carry normalized `SensorPacket` frames whose `manifest.contractVersion` must be `cdd_ppg_imu_recording_v1`. The phone must verify completeness and checksum **before** acknowledging upload and before quality gating or inference.

### Invalid / error behavior

| Condition | Phone behavior |
|---|---|
| Wrong `kind` or unsupported `schemaVersion` | Reject; do not coerce |
| Missing required field / extra unknown top-level field | Reject |
| Out-of-order sequence without `missing_flag` | Reject |
| Checksum mismatch | Reject; keep pending for retry |
| Incomplete chunk set | Remain pending; never infer |
| Duplicate complete `recordingId` | Deduplicate; keep first integrity-verified copy |

## Shared fixtures

Fixtures live under `tests/fixtures/sync-recordings/`:

| File | Intent |
|---|---|
| `valid.json` | Minimal well-formed synchronized recording |
| `missing-sample.json` | Declared missing PPG/IMU slots |
| `out-of-order.json` | Sequence reversal |
| `corrupted.json` | Checksum / non-finite sample failure |
| `incompatible-version.json` | Unsupported schema version |

Firmware and mobile tests should consume the same fixtures without guessing units or timing.

## Relation to AnyPPG

- Active phone BP path: **AnyPPG** (125 Hz, 30 s / 3750 samples, three 10 s chunk mean/std normalizations).
- cBP-Tnet beat extraction / `normalize_beats` is legacy and is **not** this contract’s preprocessing path.
- See `docs/anyppg-watch-compatibility.md` for resampling ownership, polarity caveats, and quality gates.
