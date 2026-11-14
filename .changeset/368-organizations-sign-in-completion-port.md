---
'@endora-commerce/mod-organizations': patch
---

`organizations` publishes `customerSignInCompletionPort` (`CustomerSignInCompletionPort`), the post-sign-in step its password sign-in runs: the contributed `organizationsLoginHook` merges the signed-out basket and adopts the anonymous comparison. The password route now runs the same function, so its answer and its `b2b_cart_anon` handling are unchanged (issue #368).
