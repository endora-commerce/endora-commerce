---
'@endora-commerce/mod-carts': patch
---

`carts` declares the three error codes it owns, and the seven refusal tokens under one of them.

The module's `manifest.ts` gains an `errorCodes` array
(`specs/090-module-owned-error-codes/`, Phase 3), which is what routes each code's translated
sentence to this package's own `i18n/{en,pl}.json` under `errors.<CODE>`. No exported symbol
changes shape and no sentence moves: the list is exactly what the platform's incumbent prefix
chain routes here today, so a consumer sees the identical envelope for `CART_EMPTY`,
`CART_LINE_CAP_EXCEEDED` and `CART_COUPON_REJECTED`.

`CART_COUPON_REJECTED` is the first declaration in the migration to carry `tokens` — the seven
`errors.CART_COUPON_REJECTED.<token>` discriminators the envelope reads from `details.code`.
They are the members of `couponDropReasonSchema` in `@endora-commerce/contracts`, which is the
type of the value the raise site produces, rather than the seven keys the bundle happens to hold.
