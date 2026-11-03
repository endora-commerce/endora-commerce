---
'@endora-commerce/mod-auth': minor
---

The customer actor carries the member's organization role (`specs/170-organization-roles/`, research R-15). `CustomerSessionAccount` — what `customerOrgResolver` answers — gains an optional `organizationRoleId`, and the request hook stamps it on `request.actor.organizationRoleId` for customer and impersonation sessions; a resolver that answers none leaves it `null`, and the session is bound exactly as before.
