---
'@endora-commerce/contracts': minor
---

`CustomerSignInCompletionInput` gains the optional `salesChannelId` (`string | null`): the sales channel a customer sign-in belongs to when its request carries none, so only the signed-out basket of that store is merged. Absent or `null` keeps today's behaviour, the request's resolved channel. New constant `CART_MERGE_FLASH_COOKIE_NAME` (`'b2b_cart_merge_flash'`), the storefront's one-render "basket carried over" notice, now written by the backend too (issue #1188). Additive: no existing export changes.
