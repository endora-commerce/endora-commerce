---
'@endora-commerce/mod-promotions': minor
---

Creating and editing a promotion, adding a coupon and generating a coupon batch are now Commands, and the module declares them hookable (issue #1844): another module may run a `beforeCommit` hook inside each write, or an `afterCommit` handler through the outbox, by registering against `PROMOTION_HOOKABLE_ACTIONS` and depending on `promotions`. Switching a promotion on or off is an edit; its hook data says so in `activationChange`. The HTTP API, the audit entries (`promotion.create`, `promotion.update`, `coupon.create_single`, `coupon.generate_batch`) and the refusals are unchanged.
