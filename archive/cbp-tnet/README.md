# Archived cBP-Tnet materials

**Status:** Historical only. **Not** used for active blood-pressure inference.

The app’s only active BP model is **AnyPPG** (`assets/models/anyppg/`), executed locally with ONNX Runtime.

This archive keeps prior training scripts, the exported `cbp_tnet.onnx` package, synthetic fixtures, and packaging scripts for research provenance. Do not reintroduce these into the app bundle or Metro asset graph without an explicit team decision.

Scripts under `tools/` here historically expected live paths such as `services/bpPpgPreprocess.js` and `assets/models/onnx_export/`. Those active paths were removed; use the archived copies under this directory if you need to reproduce old checks offline.
