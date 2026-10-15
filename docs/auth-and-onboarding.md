# Login and health-data onboarding

Status: works end to end with a **local development** auth adapter. Waiting on the AWS Cognito user pool before it can ship.

## Flow

`app/_layout.tsx` gates routes with `Stack.Protected` based on `useAuth().status`:

| Status | Reachable routes |
| --- | --- |
| `loading` | none (splash screen stays up while the saved session is checked) |
| `signed-out` | `(auth)/sign-in`, `(auth)/sign-up` |
| `onboarding` | `onboarding` (5 steps: name/phone → date of birth → height & weight → skin tone → review) |
| `ready` | `(tabs)`, `modal` |

Screens never navigate after sign-in, sign-up, or finishing onboarding. They update auth state, and the guards move the user to the right screen.

## Files

| File | Role |
| --- | --- |
| `services/auth/auth-service.ts` | Provider-agnostic `AuthService` contract, `AuthError` codes, and friendly messages (raw backend errors are never shown). |
| `services/auth/local-auth-service.ts` | Pure logic for the local dev adapter (tested in Node). |
| `services/auth/device-auth.ts` | Wires the dev adapter to `expo-sqlite` (accounts), `expo-secure-store` (session), and `expo-crypto` (salted SHA-256). **Dev only.** |
| `services/user-data-db.ts` | `user-data.db` with versioned migrations (`PRAGMA user_version`). Kept separate from the existing `profile.db`. |
| `services/profile/health-profile.ts` | Onboarding data model in canonical units (cm, kg, ISO date), unit conversion, and validation. |
| `services/profile/health-profile-store.ts` | Saves progress after each step and marks onboarding complete. Also copies the data into the existing `profile` row so the Profile tab shows it. |
| `context/auth-context.tsx` | `AuthProvider` / `useAuth`. A generation counter discards stale async results. |
| `components/auth/*` | Form screen layout (taps still work while the keyboard is open), labeled fields with autofill hints, announced error banner, pill buttons. |

## Swapping in Cognito

1. Implement `AuthService` in `services/auth/cognito-auth.ts` (Amplify Auth or `amazon-cognito-identity-js`), mapping Cognito errors to `AuthErrorCode`s. Cognito handles token storage; use `expo-secure-store` only if the library asks for a storage adapter.
2. Use `provider: 'cognito'` and the Cognito `sub` as `userId`. `health_profiles` is already keyed by `user_id`, so it keeps working.
3. Pass the new service to `<AuthProvider service={...}>` in `app/_layout.tsx`. No screen changes needed.
4. Cognito sign-up usually requires an email confirmation code. Add a `confirmSignUp` method plus a code-entry screen under `(auth)/`.
5. Delete `local-auth-service.ts`, `device-auth.ts`, and the `local_accounts` table migration once Cognito is live.

## Known limits

- Local accounts exist only on one device/simulator; there is no password reset.
- The skin-tone swatches reuse the Profile palette. They are not a validated Fitzpatrick scale, and the ML team should decide what it needs.
- The current ONNX model on `rithika-ML` takes no demographic inputs. Age, height, and weight are collected to match the planned `PredictionProfile` and calibration work.

## Checks

`npm test` covers auth (sign-up/sign-in/restore/error handling) and health-profile validation and unit conversion. The full flow was also run by hand on the iOS Simulator: sign up → onboarding → force-quit and relaunch (session and step restored) → finish → Profile tab shows the data → sign out.
