---
'@endora-commerce/mod-inventory': minor
---

Back-in-stock notification requests are now gated as an acquisition: the caller's audience and
the request's sales channel both have to allow the product, and every refusal is the single
`404 PRODUCT_NOT_FOUND` the other acquisition seams already answer with.

**Why it is a security fix.** `AvailabilityNotificationService.subscribe` resolved the product
through the row-level catalogue read port and applied neither `isProductVisibleTo` nor the
channel assortment gate, so a product an operator had restricted to one organisation, or
published on one channel only, was reachable by id from the unauthenticated storefront route
and answered differently from a product that is not there. Both storefront routes
(`POST /api/v1/storefront/inventory/notify-when-available` and the backward-compatible
`POST /api/v1/catalog/products/:id/notify-when-available`) went through that service, so both
are closed by the same change.

**What consumers have to change.** Two shapes gained a required member, both of them the same
port:

- `new AvailabilityNotificationService(emFactory, catalogProducts, customerAccounts, mailer?, templateEmail?)`
  becomes
  `new AvailabilityNotificationService(emFactory, catalogProducts, customerAccounts, salesChannelMembership, mailer?, templateEmail?)`.
- `InventoryModuleOptions` gained `salesChannelMembership: SalesChannelMembershipPort`. A
  composition using the container resolves it as `salesChannelMembershipPort`; it is a kernel
  registration, so it adds no module dependency edge.

`SubscribeInput` gained an optional `audience?: ProductAudience`, defaulted to the anonymous
audience — a caller that does not pass one gets the most restrictive answer rather than no
answer, which is the fail-closed end. A caller acting on behalf of a signed-in buyer should pass
`productAudienceOf(request)`.

`major` would be the literal shape of the constructor change; D-225 refuses one while the
package is in `0.x`, and a `minor` already takes every caret dependent out of range.
