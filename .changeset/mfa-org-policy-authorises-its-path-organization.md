---
'@endora-commerce/mod-mfa': minor
---

`POST /admin/organizations/:organizationId/mfa-policy` authorises the organization it is given — out of scope now answers `404`

**If a scoped admin in your deployment sets per-organization TOTP enforcement for organizations
it is not assigned to, this release makes those calls fail with `404 NOT_FOUND`.** One route
handler changed; no entity, service, DTO or migration did.

The route read `:organizationId` out of the path and wrote `MfaOrganizationPolicy` for it with
no authorisation beyond the `mfa:manage` permission code. `MfaOrganizationPolicy` is
`@GlobalEntity()` and correctly so — the row *is* the per-organization rule, keyed by an id the
module does not own — so no column filter could reach the write, and a permission code is not a
tenancy boundary: an operator may put `mfa:manage` on any role. A `sales_representative`
assigned only to organization A was measured forcing TOTP on organization B and then lifting it
again, `200` on both.

What changes for a consumer, in the order you will meet it:

- **The route calls `isOrgInScope(request.params.organizationId)` and answers `404 NOT_FOUND`
  when it is false**, byte-identical to the answer a non-existent organization gets. `all` and
  `system` contexts are unaffected and keep writing any organization's policy.
- **A scoped admin keeps the capability for its own assignments.** This is a narrowing, not a
  removal: the same actor still enforces and lifts TOTP for the organizations it is assigned.
- **`404` rather than `403`** because the organization id addresses the resource — it is the
  path parameter and the row's own key — so nothing about existence may be disclosed. The model
  is `credit_limits`' grant route.
- **The customer-facing `PUT /api/v1/account/organization/mfa-policy` is untouched**: it derives
  its organization from the signed-in account rather than from the request.

`minor` rather than `major` because no package in this repository leaves `0.x` yet; in a `0.x`
series a minor already takes every caret dependent out of range, which is the consumer-facing
meaning of the break.

Implements D-260/B: wherever a route accepts a tenant identity as input rather than deriving it
from the actor, the guard has to be at that route.
