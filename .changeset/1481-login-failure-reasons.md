---
'@endora-commerce/admin-kit': minor
'@endora-commerce/admin-shell': patch
---

The sign-in screen no longer shows English the kit hard-coded (issue #1481). When a password or code step fails without a backend message — the network dropped, the answer was not an error envelope — `AuthProvider` now leaves `lastLoginError` as `null` and sets `lastLoginReason` to `'sign_in_failed'` or `'verification_failed'`; the exported `LoginErrorReason` type gains those two members. A custom sign-in screen should word those two reasons itself, as `@endora-commerce/admin-shell`'s `LoginPage` does: before, it received `'Sign-in failed.'` or `'Verification failed.'` in `lastLoginError`. A `switch` over `LoginErrorReason` that was exhaustive needs the two new cases.

The two-step verification step of `LoginPage` takes its words from the shell's pre-auth copy like the rest of the sign-in screen, and its code field is described by the error it caused.
