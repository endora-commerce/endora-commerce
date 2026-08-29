---
'@endora-commerce/platform': major
'@endora-commerce/mod-customers': patch
'@endora-commerce/mod-quick-order': patch
---

**`customerFilterCond`'s `allowed-set` arm stops returning `{}`, and the function takes an
argument.**

`customerFilterCond()` is now `customerFilterCond(organizationColumn: CustomerOrganizationColumn)`,
where `CustomerOrganizationColumn` is `'present' | 'absent'` — both exported from
`@endora-commerce/platform/tenancy`'s `filters` module. Any direct caller must pass one:

```ts
// before
const where = customerFilterCond();
// after — `'present'` iff the entity you are filtering carries `organizationId`
const where = customerFilterCond('absent');
```

`@CustomerScoped()` itself is source-compatible and takes no new argument. It derives the answer
per query from the ORM's discovered metadata, so an entity that gains an `organizationId` column
starts being filtered on it with no further change.

**The behaviour change is confined to the `allowed-set` mode** — the mode a scoped
(assignment-limited) administrator resolves to. It previously contributed **no predicate at all**
to any `@CustomerScoped` entity, so such an entity behaved as if it were `@GlobalEntity` for that
actor. It now contributes `{ organizationId: { $in: allowed } }` when the entity carries the
column, and a predicate that matches nothing when it does not. `all`, `system` and `single-org`
are unchanged, and a buyer resolves `single-org`.

A surface that has already established the caller's authority by other means and reads a
`@CustomerScoped` entity with no organization column will now read nothing under a scoped
administrator. Cross that deliberately with `withSystemScope(reason, fn)` after the check that
establishes the authority; do not catch.

`@endora-commerce/mod-quick-order`'s `registerQuickOrderAdminRoutes` takes a new required dep,
`customerAccounts: CustomerAccountReadPort`. It is the tenant boundary of the admin build route:
`onBehalfOf` names the customer account and organization the built Cart or Quote Request is
written to, and it arrives in the request body, where no read filter can reach it.
