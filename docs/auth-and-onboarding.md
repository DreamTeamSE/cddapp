# Login and health-data onboarding

Status: works end to end with a **local development** login. It isn't shippable until the AWS Cognito user pool replaces that login (see below).

## Flow

`app/_layout.tsx` uses `Stack.Protected` to decide which screens can be reached, based on `useAuth().status`:

| Status | Reachable routes |
| --- | --- |
| `loading` | none (the splash screen stays up while the saved session is checked) |
| `signed-out` | `(auth)/sign-in`, `(auth)/sign-up` |
| `onboarding` | `onboarding` (5 steps: name/phone → date of birth → height & weight → skin tone → review) |
| `ready` | `(tabs)`, `modal`, and the `ml-*` research screens |

Screens never navigate on their own after sign-in, sign-up or finishing onboarding. They update the auth state, and the route guards move the user to the right place.

Only the onboarding lookup decides that route (`services/auth/session-gate.ts`). If it fails, the user is sent to onboarding to be safe. If the Profile tab fails to load, the error is only logged.

## Data and security

- **Accounts (dev only):** stored on the device in `user-data.db`.
  - Passwords are hashed with PBKDF2-HMAC-SHA256 at 10k iterations, using `@noble/hashes`. Each hash records its own iteration count, and older hashes are upgraded on the next successful sign-in.
  - Every sign-in attempt costs the same, whether or not the email exists, so response time doesn't reveal which emails are registered.
  - 5 wrong attempts lock that email: 30 s at first, doubling up to 15 min. Attempts run one at a time.
- **Encryption:** `user-data.db` and `ppg-cache.db` are encrypted with SQLCipher (the `expo-sqlite` `useSQLCipher` plugin option). A random 256-bit key per install lives in the iOS keychain (`services/secure-database.ts`).
  - A file is recreated only when SQLite reports it can't be read with that key (SQLITE_NOTADB). Any other error is rethrown so data is never thrown away.
  - Expo Go and web builds have no SQLCipher; the app logs a warning and those files are stored unencrypted.
- **Session:** only the user ID is kept, in `expo-secure-store` (this device only, readable after first unlock).
- **Profile tab:** the existing tab reads one shared row in `profile.db`.
  - Each account keeps its own copy (`profile_mirrors`). It's loaded on sign-in and cleared on sign-out.
  - `profile.db` runs with `secure_delete`, and its WAL is truncated after clearing, so the old copy doesn't linger on disk.
  - Profile-tab edits are checked against the stored health profile. Unreadable values keep the old value, age follows the date of birth, and the sign-in email can't be edited there.
- **Journal:** entries are stored per account in `user_journal_entries` (in `profile.db`). Rows in the older shared `journal_entries` table predate accounts and are no longer shown.
- **Not encrypted yet:** `profile.db`, which holds the Profile tab and Journal. Moving it to the encrypted helper is a team decision.

## Files

| File | Role |
| --- | --- |
| `services/auth/auth-service.ts` | The `AuthService` contract, `AuthError` codes, and user-facing messages (raw backend errors are never shown). |
| `services/auth/local-auth-service.ts` | Logic for the local dev login: hashing, lockout, timing. Tested in Node. |
| `services/auth/device-auth.ts` | Connects the dev login to SQLite, the keychain and PBKDF2. **Dev only.** |
| `services/auth/session-gate.ts` | Decides whether a signed-in user goes to onboarding or the app. |
| `services/secure-database.ts` | Opens SQLCipher-encrypted databases with the keychain key. |
| `services/sql-database.ts` | The `SqlDatabase` interface and `isWrongKeyError`, shared with tests. |
| `services/user-data-schema.ts`, `services/user-data-db.ts` | Versioned schema for `user-data.db` and its on-device connection. |
| `services/shared-profile-db.ts` | Per-account journal SQL and shared-profile clearing for `profile.db`. |
| `services/profile/health-profile.ts` | The onboarding data model in fixed units (cm, kg, ISO date), unit conversion and validation. |
| `services/profile/profile-repository.ts` | Onboarding progress, completion, per-account Profile tab and edit validation. Tested in Node. |
| `services/profile/health-profile-store.ts` | On-device wiring of the repository. |
| `context/auth-context.tsx` | `AuthProvider`, `useAuth`, and `useSignOutHandler`, which alerts if sign-out fails. A generation counter discards stale async results. |
| `components/auth/*` | Form layout (taps work while the keyboard is open), labeled fields with autofill hints, an error banner screen readers announce, and pill buttons. |

## Swapping in Cognito

1. Implement `AuthService` in `services/auth/cognito-auth.ts` with Amplify Auth or `amazon-cognito-identity-js`, mapping Cognito errors to `AuthErrorCode`s. Cognito handles token storage and lockout; use `expo-secure-store` only if the library asks for a storage adapter.
2. Use `provider: 'cognito'` and the Cognito `sub` as `userId`. Health profiles, profile copies and journal entries are already keyed by user ID, so they keep working.
3. Pass the new service to `<AuthProvider service={...}>` in `app/_layout.tsx`. No screen changes are needed.
4. Cognito sign-up usually requires an email confirmation code. Add a `confirmSignUp` method and a code-entry screen under `(auth)/`.
5. Once Cognito is live, delete `local-auth-service.ts` and `device-auth.ts`, and stop using the `local_accounts` and `sign_in_attempts` tables.

## Known limits

- Local accounts exist only on one device or simulator. There is no password reset.
- Pure-JS PBKDF2 at 10k iterations takes about 1.2 s per sign-in on the simulator (100k took about 12.5 s). That's weaker than a server-side login; Cognito replaces it.
- The skin-tone swatches reuse the Profile palette. They are not a validated Fitzpatrick scale, and the ML team should decide what it needs.
- The current ONNX model takes no demographic inputs. Age, height and weight are collected to match the planned `PredictionProfile` and calibration work.
- After pulling, run a fresh native build (`npm run ios:build`), because SQLCipher, `expo-secure-store` and `expo-crypto` are native modules.

## Checks

`npm test` covers:
- sign-up, sign-in, session restore and error messages
- lockout, equal-cost timing, hash upgrades and concurrent attempts
- health-profile validation and unit conversion
- per-account Profile tab and journal
- edit validation and session routing
- wrong-key detection and schema migration

Storage tests use Node's built-in SQLite.

Manual runs on an iOS 26.5 simulator dev build covered:
- sign up → onboarding → force-quit and relaunch (session and step restored)
- two accounts on one device (Profile and Journal stay separate)
- invalid Profile edits snapping back
- lockout on the 6th wrong attempt
- no names left in the database files after sign-out
- the ML synthetic test still matching Python
