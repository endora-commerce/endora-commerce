---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-mfa': patch
---

The two-step sign-in replies are described by their contract (issue #1352):

- `@endora-commerce/contracts` publishes `mfaVerifyResponseSchema` / `MfaVerifyResponse` for `POST /api/v1/auth/{customer|admin}/mfa/verify`: `data.status` is `'authenticated'`, and on the customer surface `data.cartMerge` is present when a guest basket was merged, as in `customerSignInResponseSchema`.
- `@endora-commerce/contracts` publishes `mfaSetupTicketCompleteResponseSchema` / `MfaSetupTicketCompleteResponse` for `POST /api/v1/auth/{customer|admin}/mfa/setup-ticket/complete`: the same answer plus the ten `recoveryCodes` the enrolment minted.
- `mod-mfa` builds both replies as the contract's types. Nothing on the wire changes.
