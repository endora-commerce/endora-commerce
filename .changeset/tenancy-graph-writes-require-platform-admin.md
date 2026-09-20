---
'@endora-commerce/mod-organizations': minor
---

Sales-rep assignment and organization parentage are platform-admin writes — a scoped admin now gets `403`

**If your operator has a scoped admin role that assigns sales representatives or moves
organizations in the tree, this release makes those calls fail with `403 FORBIDDEN`.**
Three route handlers changed; no entity, service, DTO or migration did.

- `POST /api/v1/admin/organizations/:organizationId/sales-reps`
- `DELETE /api/v1/admin/organizations/:organizationId/sales-reps/:adminUserId`
- `POST /api/v1/admin/organizations/:id/parent`

All three were gated on a `requireAdmin(...)` permission code alone, and a permission code is
not a tenancy boundary. `OrganizationSalesRepAssignment` is the table that *defines* an
`allowed-set` actor's `allowedOrganizationIds`, and `Organization.parentId` is what the
roll-up capability expands over, so an actor resolving to `allowed-set` could widen **its own
authority**: measured at `[orgA] → [orgA, orgB]` by one self-assignment (answered `201`) and
again by one re-parent (answered `200`). Both entities are `@GlobalEntity` and correctly so —
the assignment table cannot be `@OrgScoped` without circularity — so no classification and no
column filter could reach either write.

What changes for a consumer, in the order you will meet it:

- **The three routes require `mode: 'all'`.** A platform admin and a `system` caller are
  unaffected and keep writing across organizations exactly as before. An `allowed-set` or
  `single-org` actor is refused `403 FORBIDDEN` with a message naming no organization.
- **The refusal is categorical, including for the actor's own organization.** Assigning a
  second representative to an organization you already hold still edits the graph that decides
  who holds what. The graph is the boundary, not an operation inside it.
- **The gate answers before the existence lookup**, so the refusal does not depend on the
  organization or the admin user being there, and the response is the same either way.
- **Only the routes moved.** `SalesRepAssignmentPort.assign` / `.unassign` are unchanged, so an
  ERP import or an install hook calling the exported service — `comarch_xl`'s contractor apply
  is one — keeps working under its own `system` scope.

`minor` rather than `major` because no package in this repository leaves `0.x` yet; in a `0.x`
series a minor already takes every caret dependent out of range, which is the consumer-facing
meaning of the break.

Implements D-260's rule that a write which changes the acting principal's own authority cannot
be authorised by that authority. The idiom is this module's own credit-inheritance-mode
handler, which already required `mode: 'all'` on the weaker argument of a money-behaviour
switch.
