---
'@endora-commerce/mod-admin-roles': patch
'@endora-commerce/mod-i18n': patch
---

Error-code ownership: `admin_roles` declares the three codes it owns and ships its first i18n
bundle.

`ADMIN_ROLE_CODE_TAKEN`, `ADMIN_ROLE_IN_USE` and `ADMIN_ROLE_PROTECTED` move from
`@endora-commerce/mod-i18n`'s manifest to `@endora-commerce/mod-admin-roles`'. For a consumer the
observable difference is **which bundle answers for them**: the sentences are no longer served from
the platform bundle and are now in this module's own `i18n/{en,pl}.json`, so a deployment that
ships `@endora-commerce/mod-admin-roles` gets them and one that does not gets the raising code's own
English.

Two of the three arrive with prose written for the first time — they carried a machine-shaped
restatement of their own code (`"Admin Role Code Taken."`), which is deleted rather than moved.

**`protectedRoleRefusal(code)` is a new export** of `@endora-commerce/mod-admin-roles/backend`, beside
the existing `roleInUseRefusal`. It is the refusal `AdminRoleService.remove` now throws for a
module-seeded role, extracted for the same reason its neighbour was: the translated sentence names
the role through a `{role}` placeholder, and only a test that renders a real refusal can see that
the placeholder has something to fill it.

**The 409 `ADMIN_ROLE_PROTECTED` response now carries `details: { role: '<role code>' }`.** It
carried no `details` before. This is additive — the member is `role` and never `code`, which is the
refusal token the error envelope keys `errors.<CODE>.<token>` on.
