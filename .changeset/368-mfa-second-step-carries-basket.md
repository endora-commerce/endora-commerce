---
'@endora-commerce/mod-mfa': patch
---

A two-step customer sign-in now carries the signed-out basket over (issue #368). `POST /api/v1/auth/customer/mfa/verify` and `POST /api/v1/auth/customer/mfa/setup-ticket/complete` run `organizations`' `customerSignInCompletionPort` once the session is set: the `b2b_cart_anon` basket the request carries is merged into the customer's, the answer gains the optional `cartMerge` (`{ outcome: 'adopted' | 'merged' | 'noop', destinationCartId }`) the password sign-in already returns, and the anonymous cookie is cleared when the basket was consumed. A failed merge still issues the session. The admin routes are unchanged. The port is resolved per request; `mfa` already depends on `organizations`, so no manifest edge is added.
