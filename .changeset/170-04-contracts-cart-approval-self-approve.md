---
'@endora-commerce/contracts': minor
---

`ERROR_CODES` gains `CART_APPROVAL_SELF_APPROVE` (422 — an approver may not approve or reject their own pending cart; `details.cartId`; `specs/170-organization-roles/`, R-36) and loses `CART_APPROVAL_SELF_SUBMIT`, which nothing raises any more: a buyer whose role lets them order without approval — an administrator included — is refused `CART_APPROVAL_NOT_REQUIRED` instead. Replace `ERROR_CODES.CART_APPROVAL_SELF_SUBMIT` with `ERROR_CODES.CART_APPROVAL_NOT_REQUIRED` where a client branched on it. A consumer switching exhaustively over `ErrorCode` has one case more and one fewer.
