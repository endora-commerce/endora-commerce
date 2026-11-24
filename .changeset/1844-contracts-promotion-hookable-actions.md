---
'@endora-commerce/contracts': minor
---

New `PROMOTION_HOOKABLE_ACTIONS` (issue #1844): the refs a hook author registers against to take part in `promotions`' writes — `create` (`promotion.create`), `update` (`promotion.update`), `createCoupon` (`coupon.create_single`) and `generateCouponBatch` (`coupon.generate_batch`), each offering `beforeCommit` and `afterCommit`. Their data types are exported too: `PromotionHookSummary`, `PromotionCreateHookData`, `PromotionUpdateHookData` (with `changedFields` and `activationChange`), `CouponCreateSingleHookData`, `CouponGenerateBatchHookData`, and the outbox types `PromotionCreateOutbox`, `PromotionUpdateOutbox`, `CouponCreateSingleOutbox` and `CouponGenerateBatchOutbox`. Also new: `promotionUsageLimitScopes(limits)` and the `PromotionUsageLimitScope` type, which name the usage caps a promotion sets without their limits.
