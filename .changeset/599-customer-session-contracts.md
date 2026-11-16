---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-organizations': patch
---

The buyer's session replies are described by their contract (issue #599, section 1):

- `@endora-commerce/contracts` publishes `customerMeResponseSchema` / `CustomerMeResponse` for `GET /api/v1/me`: `data.customerAccount` (the account with its `preferredLanguage`), `data.organization` (`null` without one) and `data.impersonation` (`{ impersonatorAdminUserId }` while an administrator impersonates the buyer, else `null`). Its Organization, `customerMeOrganizationSchema`, declares the four keys the reply has always carried and `organizationSchema` does not: `legalName`, `version`, `canTransact` and `moderationMessage`.
- `@endora-commerce/contracts` publishes `customerSignInResponseSchema` / `CustomerSignInResponse` for `POST /api/v1/auth/customer/login`: a `data` union on `status`, where `authenticated` carries the whole `customerAccount` and, when a guest basket was merged, `cartMerge`; `mfaRequired` carries `challengeId` and `mfaSetupRequired` carries `setupTicket`.
- `customerLoginResponseSchema` / `CustomerLoginResponse` are deprecated: they declare no `status` and refuse the two second-step answers. Parse with `customerSignInResponseSchema` instead. They stay exported until the next breaking-change release.
- `mod-organizations` builds both replies as the contract's types. Nothing on the wire changes.
