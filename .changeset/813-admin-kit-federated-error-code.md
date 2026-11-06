---
'@endora-commerce/admin-kit': minor
---

**Breaking:** `useAuth()` gains `federatedSignInError: FederatedSignInErrorCode | null`, and the `?error=` a federated sign-in leaves on `/login` no longer arrives in `lastLoginError`. `AuthProvider` passes on only a value that parses with `federatedSignInErrorCodeSchema`; any other value, a sentence an older `mod-mfa` sent included, arrives as `'sign_in_failed'`, so the raw value is never available to print. A login screen that rendered `lastLoginError` to show a federated refusal now reads `federatedSignInError` and words the code itself. `lastLoginError` still carries the backend's answer to a password or second-step attempt and the session-expired notice. The next sign-in attempt clears both (issue #813).
