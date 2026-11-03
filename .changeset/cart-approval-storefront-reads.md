---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-carts': minor
---

Two additive reads for the storefront's cart-approval screens (issue #650).

- **The buyer learns their basket was rejected.** A rejection closes the basket (`status = 'rejected'`), so the buyer's next `GET /api/v1/cart` was a new basket whose `approvalStatus` could never say `rejected_by_org_admin`, and the reason was shown nowhere. Every full cart answer (`GET /api/v1/cart` and the line, coupon and quantity answers) now carries `previousRejection: { cartId, rejectedAt, reason } | null`: the buyer's most recent rejected basket on the request's sales channel, while the current basket has not been sent for approval and no basket of theirs on that channel has been ordered or converted to a quote request since. It is `null` otherwise, and for an anonymous basket. In `@endora-commerce/contracts`, `cartFullPayloadSchema` gains the field as `cartPreviousRejectionSchema.nullable().default(null)`, so a reply without it still parses; `CartFullPayload` now has the key, so code that builds one must set it.
- **The administrator sees what they approve.** `GET /api/v1/organization/carts/:id` now answers `items`: each line's `id`, `productId`, `variantId`, `displayName` (in the response language, the packaging unit appended), `productSku`, `quantity`, and `unitPrice` and `lineTotal` as stored. The new `orgCartDetailViewSchema` / `orgCartDetailViewResponseSchema` describe that route as it answers; the older `orgCartDetailPayloadSchema` never matched it and is left unchanged.

`CartsOrganizationRoutesDeps` (the options of `registerCartsOrganizationRoutes`) gains a required `catalogProducts` member; the module's own composition provides it.
