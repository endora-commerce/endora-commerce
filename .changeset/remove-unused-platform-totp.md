---
'@endora-commerce/platform': major
---

Remove `enroll` and `verifyTotp` from the kernel barrel, and delete
`kernel/crypto/totp` with them.

The primitive had no caller left once the superseded `/api/v1/me/two-factor/*`
path was deleted: `mfa` ships its own TOTP over its own `otpauth` dependency,
and nothing else in the tree named these symbols. `otpauth` is dropped from
the platform's and the backend's manifests and stays where it is used.

Withdrawing a published export is `major` even though the measured consumer
count is zero — the barrel is what a third-party module compiles against, and
this repository cannot see who has already done so.
