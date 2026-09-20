---
'@endora-commerce/mod-autopay': minor
---

`AutopayPaymentMethodOrgDisable` is `@OrgScoped()` — an untenanted read of `autopay_payment_method_org_disables` now throws

**If you query `AutopayPaymentMethodOrgDisable` outside a tenant context, this release makes that call fail.**
The entity declares `organization_id uuid NOT NULL` as half of its composite primary key,
foreign-keyed to `organizations` `on delete cascade`, while classifying itself `@GlobalEntity()` —
so no tenant filter was attached and every read returned every organization's deny rows. The
Stripe twin of the same table was already `@OrgScoped()`; this one had inherited the wrong
classification by copy (D-259, category 1).

What changes for a consumer, in the order you will meet it:

- **Reads narrow.** A query under a `single-org` context returns that organization's deny rows;
  one under an `allowed-set` context (a scoped admin) returns the assignment's. Previously both
  returned everything, so `GET /api/v1/admin/autopay/methods` disclosed the id of every organization
  that had denied a method to any admin holding `autopay:read`, and
  `PUT /api/v1/admin/autopay/methods/:id` — which replaces the set wholesale against that same
  unfiltered read — removed deny rows for organizations outside the caller's assignment. `all`
  and `system` contexts are unaffected: the filter returns no predicate for either, so a platform
  admin reads and writes across organizations exactly as before.
- **A read with no ambient tenant context throws `MissingTenantContextError`** instead of
  succeeding. The guard is fail-closed by design. If you call into this entity from outside a
  request — a script, a job of your own, a fixture — wrap it in `withSystemScope('<reason>', …)`,
  which is what the platform's escape hatch is for.
- **No migration, and no schema change.** The column is already part of the composite primary
  key, already `NOT NULL`, and already foreign-keyed; only the classification moved. It emits no
  DDL against a database this module has already migrated.

`minor` rather than `major` because no package in this repository leaves `0.x` yet; in a `0.x`
series a minor already takes every caret dependent out of range, which is the consumer-facing
meaning of the break.

No route, service or DTO changed. `AutopayEligibility.isOrgDisabled` keeps its own `organizationId`
predicate: a service may narrow the guard and may never stand in for it.
