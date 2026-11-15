---
'@endora-commerce/mod-mfa': patch
---

A federated customer sign-in (Google, Microsoft) now carries the signed-out basket over (issue #1188). When `GET /api/v1/auth/customer/oauth/:provider/callback` signs the customer in itself, it runs `organizations`' `customerSignInCompletionPort` over the browser's `b2b_cart_anon` on the channel the sign-in was started on: the basket is adopted or merged as on the password sign-in, `b2b_cart_anon` is cleared when the basket was consumed, and an `adopted` or `merged` outcome sets the storefront's `b2b_cart_merge_flash` notice cookie (30 seconds). A customer handed to the second step is completed by the code screen, as since #368; a failed merge still issues the session; the admin surface is unchanged. `MfaOAuthDeps` gains the required `customerSignInCompletion`, which `mfaModule` already receives.
