---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-promotions': patch
---

Promotion admin replies are described by their contract (issue #599, section 6):

- `@endora-commerce/contracts` publishes four envelopes whose rows were already described: `promotionListResponseSchema` / `PromotionListResponse` for `GET /api/v1/admin/promotions`, `promotionRuleListResponseSchema` / `PromotionRuleListResponse` for `GET /api/v1/admin/promotion-rules`, `promotionRuleDetailResponseSchema` / `PromotionRuleDetailResponse` for `GET /api/v1/admin/promotion-rules/:id` (the rule plus `usedBy`, the promotions referencing it), and `promotionCouponListResponseSchema` / `PromotionCouponListResponse` for `GET /api/v1/admin/promotions/:id/coupons`.
- `mod-promotions` builds its promotion, rule and coupon replies as the contract's `Promotion`, `PromotionRuleRecord` and `PromotionCouponDto` instead of `Record<string, unknown>`, and the handlers declare those reply types. The admin client's `Coupon` is now an alias of `PromotionCouponDto` instead of a hand-written interface of the same shape. Nothing on the wire changes.
