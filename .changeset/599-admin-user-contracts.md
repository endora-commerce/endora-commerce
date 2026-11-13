---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-admin-users': patch
---

Admin user replies are described by their contract (issue #599, section 6):

- `adminUserSchema` in `@endora-commerce/contracts` now declares `preferredLanguage` (`string | null`, optional). `GET /api/v1/admin/me`, the admin-user list and detail, and the sign-in reply have answered it since feature 019, and the contract did not declare it. The field is optional, so a client that does not read it is unaffected.
- `@endora-commerce/contracts` publishes `adminLoginResponseSchema` / `AdminLoginResponse` for `POST /api/v1/auth/admin/login`: a `data` union on `status`, where `authenticated` carries `adminUser`, `mfaRequired` carries `challengeId` and `mfaSetupRequired` carries `setupTicket`.
- `mod-admin-users` builds every admin-user reply as the contract's `AdminUser` instead of `Record<string, unknown>`, and the sign-in handler returns `AdminLoginResponse`. Nothing on the wire changes.
