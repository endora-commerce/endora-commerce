---
'@endora-commerce/mod-admin-roles': patch
---

Issue #349 — comments only: the `AdminRole` entity and the `adminRolePort` adapter no longer claim that `requiresTwoFactor` is enforced by the `requireAdmin` guard or by `admin_users`; it is read by `mfa` at sign-in.
