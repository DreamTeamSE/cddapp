# Auth-onboarding merge readiness (PR #5)

**Branch tip:** `feature/auth-onboarding` after merging `origin/main`  
**Status:** Conflicts resolved locally. **Do not merge to main until** the team undrafts PR #5 and reviews.

## What was resolved

- Merged `origin/main` (AnyPPG watch pipeline + Android package updates) into `feature/auth-onboarding`.
- Kept **auth** packages: `expo-crypto`, `expo-secure-store`, `@noble/hashes`, SQLCipher in `app.json`.
- Kept **main** Expo versions: `expo-dev-client`, `expo-linking`, `expo-router`, `expo-splash-screen`, `postinstall` / `test:roadmap` scripts.
- Test script uses main’s `node --experimental-strip-types --test …` (no `--experimental-default-type=module`).
- Regenerated `package-lock.json` via `npm install`. Took main’s `ios/Podfile.lock` as baseline — run a fresh native iOS build / `pod install` before device QA.

## Verification on this tip

- `npm test` — 63/63 pass (includes SQLite 24h PPG cache + auth/storage).
- `npm run test:roadmap` — pass.
- DynamoDB adapter left as injectable stub (teammate owns cloud wiring).

## Still before merging PR #5

1. Push this branch and refresh the PR.
2. Undraft only after Anson/Tess + ML agree **local-dev auth** is OK on main (Cognito later).
3. Smoke `npm run ios:build` / Android after Pod/Gradle refresh.
4. Confirm ML routes still work behind `Stack.Protected`.
