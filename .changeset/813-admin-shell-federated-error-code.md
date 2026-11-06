---
'@endora-commerce/admin-shell': minor
---

**Breaking (redirect contract):** `LoginPage` words a refused federated sign-in from its `federatedSignInError` code, with the English lines in `federatedSignInErrorCopy` (`preauth-login-copy.ts`; the pre-auth screen is English-only by construction). It never prints the `?error=` value: anything that is not a contract code, a crafted sentence or a sentence an older `mod-mfa` sent included, shows the generic "Sign-in failed". The `/expired/i` test on the message text is gone. The alert is titled "Session expired" for the federated code `sign_in_expired` and for `lastLoginReason === 'session_expired'` (an idle session that answered 401). Every other message is titled "Sign-in failed". Needs `@endora-commerce/mod-mfa` and `@endora-commerce/admin-kit` from the same release (issue #813).
