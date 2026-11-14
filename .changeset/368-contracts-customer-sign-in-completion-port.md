---
'@endora-commerce/contracts': minor
---

New port contract `CustomerSignInCompletionPort` (`complete(input)`), with `CustomerSignInCompletionInput` (`customerAccountId`, the request's `cookies`, a `log` with `error(details, message)`) and `CustomerSignInCompletion` (`cartMerge: CartMergeOutcomePublic | null`, `clearAnonymousCartCookie`). It is the post-sign-in step of a customer sign-in, the signed-out basket merge and the anonymous comparison adoption, for a route that establishes the customer session itself (issue #368). Additive: no existing export changes.
