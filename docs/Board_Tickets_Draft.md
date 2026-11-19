# Board / issue tracking notes

Many draft tickets were filed as GitHub issues. **Duplicates were closed** Nov 18, 2026.  
**Phone software without live watch data is done** (PRs #33–#36 on `main`). Remaining open issues need hardware, BLE, or evaluation data.

## Open (need hardware / BLE / live data)

| Issue | Topic | Suggested board column |
|---|---|---|
| [#7](https://github.com/DreamTeamSE/cddapp/issues/7) | Recording contract — phone schema done; firmware fixtures pending | Waiting on hardware |
| [#8](https://github.com/DreamTeamSE/cddapp/issues/8) | Motion select on wearable — phone algo done; on-watch + real IMU pending | Waiting on hardware |
| [#9](https://github.com/DreamTeamSE/cddapp/issues/9) | 15-minute schedule — software state machine done; firmware / iOS background pending | Waiting on hardware |
| [#10](https://github.com/DreamTeamSE/cddapp/issues/10) | BLE transfer — chunk assembler done; live radio pending | Waiting on hardware |
| [#11](https://github.com/DreamTeamSE/cddapp/issues/11) | Quality + preprocess — phone path done; real AFE thresholds pending | Waiting on hardware |
| [#12](https://github.com/DreamTeamSE/cddapp/issues/12) | BP estimates + history — phone + SQLite done; watch-live pending | Waiting on hardware |
| [#13](https://github.com/DreamTeamSE/cddapp/issues/13) | Accuracy / coverage / battery | Waiting on hardware |
| [#14](https://github.com/DreamTeamSE/cddapp/issues/14) | Motion-triggered capture (stub off) | Waiting on hardware |
| [#15](https://github.com/DreamTeamSE/cddapp/issues/15) | IMU denoise experiment (stub off) | Waiting on hardware |

## Closed (done or merged duplicate)

| Issues | Why closed |
|---|---|
| #19–#25 | Implemented on watch-prep / auth merge |
| [#26](https://github.com/DreamTeamSE/cddapp/issues/26) | SQLite prototype BP history (PR #35) + phone bind on sign-in (PR #36) |
| [#27](https://github.com/DreamTeamSE/cddapp/issues/27) | Packet → sync JSON builder stub (PR #35) |
| [#28](https://github.com/DreamTeamSE/cddapp/issues/28) | Red then IR fallback, no fusion (PR #35) |
| #29 | Docs duplicate of #16 / AnyPPG chunk-norm clarification |
| #30 | KAN-20 already on `main` |
| #31 | Duplicate of #13–#15 |
| #32 | cBP-Tnet archived — not shipping |

**Do not add DynamoDB tickets here** — teammate owns that.

**Do not invent more phone-only tickets** until live watch clips exist.

How to put an issue on the board: open [project 11](https://github.com/orgs/DreamTeamSE/projects/11/views/1) → **+ Add item** → search `#7` (etc.) → drag to a column.
