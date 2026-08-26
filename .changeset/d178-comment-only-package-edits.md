---
---

D-178 touches three packages without changing what any of them does.

`@endora-commerce/platform` — comments on `orgFilterCond`'s and `orgConstraintFor`'s
`single-org` arms, and `@endora-commerce/mod-returns` — a comment on
`ReturnListService`'s `whereNull('organization_id')`. All three branches now match
nothing, because a `single-org` tenant context with a null organisation was
producible by exactly one thing — a signed-in customer whose
`customer_accounts.organization_id` was NULL — and that column is `NOT NULL`. The
code is unchanged: each `?? null` is still required by `TenantContext`'s optional
field, and deleting a belt-and-braces coalesce is not worth a behaviour risk. What
was wrong was the comments around them, which read as though the state were
reachable.

The release meaning is in `@endora-commerce/contracts`' own changeset.
