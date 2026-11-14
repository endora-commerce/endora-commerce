---
'@endora-commerce/mod-promotions': minor
'@endora-commerce/contracts': patch
---

Six `promotions` refusals have error codes of their own instead of `VALIDATION_FAILED`, and a
sentence in English and Polish (issue #628, part of #86). **A caller that matches on
`VALIDATION_FAILED`, or on the token at the front of the message, now sees the specific code.** The
HTTP status is unchanged. Until now the reader saw the machine token, because the error envelope
never replaces the message of `VALIDATION_FAILED`, and the buyer refused at placement was shown the
promotion's id.

| Route | Was | Is | `details` |
| --- | --- | --- | --- |
| `POST /api/v1/orders` (and every placement that finalizes promotion usage) | `409 VALIDATION_FAILED`, `promotion_unavailable: usage limit reached for <promotion id>` | `409 PROMOTION_USAGE_LIMIT_REACHED` | `promotionId`; with a coupon applied also `code: 'with_coupon'` and `couponCode` |
| `POST /api/v1/admin/promotions/:id/coupons` | `409 VALIDATION_FAILED`, `coupon_code_taken: <code>` | `409 PROMOTION_COUPON_CODE_TAKEN` | `couponCode` |
| `POST /api/v1/admin/promotions/:id/coupon-batches` | `400 VALIDATION_FAILED`, `coupon_space_exhausted: increase length or widen the format` | `400 PROMOTION_COUPON_SPACE_EXHAUSTED` | `requested`, `generated` |
| `POST /api/v1/admin/promotion-rules`, `PUT /api/v1/admin/promotion-rules/:id` | `409 VALIDATION_FAILED`, `rule_name_taken: <name>` | `409 PROMOTION_RULE_NAME_TAKEN` | `name` |
| `DELETE /api/v1/admin/promotion-rules/:id` | `409 VALIDATION_FAILED`, `rule_in_use: referenced by N promotion(s)` | `409 PROMOTION_RULE_IN_USE` | `ruleId`, `promotionCount` |
| `POST /api/v1/admin/promotions`, `PUT /api/v1/admin/promotions/:id` | `400 VALIDATION_FAILED`, `attribute_not_promo_eligible: <key>` | `400 PROMOTION_ATTRIBUTE_NOT_ELIGIBLE` | `attributeKey` |

The buyer's sentence names the coupon they applied, or speaks of the promotion without its name
when there was none; it never shows the promotion's id. The storefront's checkout failure page names
the new code instead of its generic failure. A batch larger than the generator's bound, an unknown
action type, rule or attribute, an operator the attribute's type does not allow and an option the
attribute does not have stay `VALIDATION_FAILED`. The six codes are members of `ERROR_CODES` in
`@endora-commerce/contracts`, declared by the `promotions` manifest, and the module's documentation
page lists them. No setting, permission or migration changes.
