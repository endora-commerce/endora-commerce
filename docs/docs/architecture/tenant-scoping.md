---
title: Tenant Scoping (Multi-Tenant Isolation)
---

# Tenant Scoping

The backend enforces multi-tenant isolation with a **framework-level guard**, not
per-service `where`-clauses (Constitution Principle XI, feature `050`). Every
persisted entity is classified once, and reads/writes are automatically confined
to the caller's tenant at the data-access layer — so isolation holds even when a
service forgets an explicit filter.

## How it works

- **Ambient `TenantContext`** — set once per request (or background job) from the
  authenticated actor, and carried through the async call chain via
  `AsyncLocalStorage`. It is derived server-side and is **never** taken from the
  request body, query string, or headers.
  - Customer → `single-org` (their organization + customer account).
  - Platform admin → `all` (no restriction).
  - Scoped sales-rep admin → `allowed-set` (their assigned organizations).
  - Worker / migration / escape hatch → `system`.
- **MikroORM global filters** (`org`, `customerAccount`) read the ambient context
  directly at query time and add the tenant predicate. Because they read the
  context per query (not per fork), they apply on `em.transactional` sub-forks and
  any other fork.
- **Fail-closed** — a query against a tenant-scoped entity with **no** ambient
  context raises `MissingTenantContextError`. A forgotten context is a loud error,
  never a silent cross-tenant read.

## Classifying an entity

Add **exactly one** classification decorator to every `*.entity.ts` (the CI check
`check-entity-tenant-classification.ts` fails the build otherwise):

| Decorator | Use when the entity… |
|-----------|----------------------|
| `@OrgScoped()` | has an `organizationId` column |
| `@CustomerScoped()` | has a `customerAccountId` column and no org column |
| `@TransitivelyScoped(() => Parent, 'fk')` | is scoped through a parent aggregate's org (e.g. `Invoice` → `Order`) |
| `@RuleScoped()` | targets orgs via a rule/JSONB, not a column (e.g. `price_lists.applicationRule`) |
| `@GlobalEntity()` | is platform-global / config (no tenant) |

`@OrgScoped` / `@CustomerScoped` attach the filter; the others are metadata only —
their enforcement (where needed) is explicit in the owning service.

You do **not** write a tenant filter by hand — `em.find(MyEntity, { ...business filters })`
is already confined to the ambient tenant.

## Crossing tenants (the escape hatch)

The **only** sanctioned way to read across organizations is the audited, greppable
escape hatch:

```ts
import { withSystemScope, withOrgScope } from '../../tenancy/escape-hatch.js';

// platform-wide read (reporting, reconciliation, migrations)
await withSystemScope('nightly reconciliation', () => em.find(Order, { status: 'paid' }));

// pin to one organization (per-org background job)
await withOrgScope(job.data.organizationId, 'rfq-expiry sweep', () => sweep());
```

Both require a non-empty `reason` and emit an audit record. A repository-wide grep
for `withSystemScope|withOrgScope` enumerates every cross-org access.

## Background jobs

Queue consumers run detached from any request, so they carry **no** context by
default and must establish one explicitly — otherwise a tenant-scoped query
fail-closes. Wrap job processing in `withSystemScope` (system-wide sweep) or
`withOrgScope(orgId, …)` (per-org job).

## Tests

The test harness sets a default `system` context (`test/tenancy-setup.ts`) so
direct-EM seeding/cleanup works without wrapping every site; the request pipeline
still overrides it with the real scoped context, so cross-tenant behavior is
exercised for real. Use `runWithoutTenantContext(fn)` to assert fail-closed
behavior explicitly.
