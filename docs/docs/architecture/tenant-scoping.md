---
title: Tenant Scoping (Multi-Tenant Isolation)
---

# Tenant Scoping

The backend enforces multi-tenant isolation with a **framework-level guard**, not
per-service `where`-clauses. Every
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
  - API key bound to an organization → `single-org` (its organization + service
    account); an unbound key and anonymous traffic → `system`.

  **The mapping is the platform's, and every composition gets it.** `composeApp`
  installs it with the request-scope hook, so an instance — whose entry point
  calls `composeApp({ deploymentRoot })` and nothing else — runs with it without
  wiring anything. The answers that belong to a module are read through ports
  the composed modules register: `customerRollupScopePort` (`customer_accounts`)
  for the subtree widening of a roll-up account, and `adminTenantScopePort`
  (`organizations`) for the organizations an admin's role lets them reach. A
  composition that registers neither **confines rather than widens**: the
  customer stays on its own organization and the admin reaches no organization
  at all — `composeApp` logs a warning at boot when `adminTenantScopePort` is
  missing, which is what a partial upgrade looks like. An admin is confined the
  same way while `organizations`, `admin_users` or `admin_roles` is absent:
  routes over global data keep answering, and the first tenant-scoped read
  answers 503 `MODULE_DISABLED` naming the absent module rather than an empty
  result. **An admin who holds no role is refused the same way**: the reach is
  read off the role, so without one the admin reaches no organization and the
  first tenant-scoped read answers 403 `ADMIN_ROLE_REQUIRED` — the absence of a
  role is never read as "every organization".
  `ComposeAppOptions.buildTenantContext`
  replaces the mapping for a deployment that needs to, and a replacement is
  refused — the request fails — when it answers a customer or a bound API key
  with a `system` or `all` context, or an admin with a `system` one.

  **The route decides whose request it is, not which cookies are present.** One
  browser can hold an admin session and a customer session at once — an operator
  who is also signed in to the storefront, and every request made while
  impersonating. The context is opened from the ambient actor, which is the
  customer session whenever one is present, and the route's own gate settles it:
  - a route behind `requireAdmin` runs as the admin and in the admin's scope, and
    a Command it runs records the admin;
  - a route behind `requireCustomer` runs as the customer and in the customer's
    scope — during impersonation with the impersonating admin recorded beside
    the customer;
  - a route behind neither keeps the ambient actor's context;
  - a gate refuses a request that carries only the other session. It never
    falls back to that session's scope.

  The gate is the one source for both answers. Once it has accepted an actor it
  calls `scopeRequestToActor(request)` (`@endora-commerce/platform/kernel`), and
  the platform derives the request's context again through the same mapping. A
  module that publishes a gate of its own which chooses between sessions calls
  it too; it takes no context, so it cannot be used to pick one.
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
| `@TransitivelyScoped('Parent', 'fk')` | is scoped through a parent aggregate's org (e.g. `Invoice` → `Order`) |
| `@RuleScoped()` | targets orgs via a rule/JSONB, not a column (e.g. `price_lists.applicationRule`) |
| `@GlobalEntity()` | is platform-global / config (no tenant) |

`@OrgScoped` / `@CustomerScoped` attach the filter; the others are metadata only —
their enforcement (where needed) is explicit in the owning service.

**The transitive parent is named by its class name, not by the class.** Both of
this platform's transitive chains cross a module boundary, and a
module that has become a package publishes an `entities` array and no named
entity class — so `@TransitivelyScoped(() => Order, 'orderId')` would be an
import the child cannot write. The name is resolved lazily against the
classification registry, because a child is routinely imported before its
parent, and the whole registry is reconciled once at boot, in
`backend/src/db/configured-entities.ts`, the instant after every classification
decorator has run and before the ORM exists. A name that resolves to nothing —
or to more than one entity — stops the boot with
`UnresolvableTenantParentError`. There is no fallback: a transitively scoped
entity has no tenant column of its own, so a chain that quietly stopped
resolving would be an untenanted read.

You do **not** write a tenant filter by hand — `em.find(MyEntity, { ...business filters })`
is already confined to the ambient tenant.

## Crossing tenants (the escape hatch)

The **only** sanctioned way to read across organizations is the audited, greppable
escape hatch. A module imports it from the platform's published tenancy barrel:

```ts
import { withSystemScope } from '@endora-commerce/platform/tenancy';

// platform-wide read inside an execution that already has a context
// (reporting, reconciliation)
await withSystemScope('nightly reconciliation', () => em.find(Order, { status: 'paid' }));
```

`withSystemScope` requires a non-empty `reason` and emits one escape-hatch audit
record. A repository-wide grep for `withSystemScope` and `enterSystemScope`
enumerates every cross-org access.

### How a crossing is audited

Every widening is recorded twice:

- **A structured stderr line**, written synchronously at the moment of the call:
  `{"level":"info","msg":"tenant.escape_hatch","scope":"system","reason":"…"}`,
  plus `organizationId` for an organization-pinned scope and `entryPoint` for a
  scope that `enterSystemScope` starts.
- **A row in `audit_log_entries`** with the action `tenant.escape_hatch`. The
  admin audit log lists these rows as *Cross-organization access*. `composeApp`
  attaches the writer for every server, worker and CLI command that composes, in
  this repository and in a scaffolded instance alike. The `module:*` operator
  commands do not compose, so they attach the writer themselves.

The row is written **asynchronously**. The hatch is often entered before any
transaction exists (in the auth hook, as the first line of a worker job, in a
boot reconciler), and most crossings are reads. An audit row in the caller's
transaction would roll back with a failed read and erase an access that did
happen. So the record is captured when the call is made and written about every
10 seconds on a separate EntityManager fork. The caller never waits for the
audit write.

Identical crossings in one window are **aggregated, not sampled**. Two
crossings land in the same row only when they share the scope, the reason, the
target organization, the module, the entry point, the actor and the
impersonation. The row counts every occurrence:

| Column | Value |
|---|---|
| `object_type`, `object_id` | `organization` and its id for an organization-pinned scope; `tenant_scope` and `system` otherwise |
| `actor_admin_user_id`, `impersonated_customer_account_id` | the admin who caused the crossing, and the customer they acted for, when there is one |
| `request_id`, `ip_address`, `user_agent` | set when every occurrence in the row came from one request |
| `acted_at` | the first occurrence |
| `state_after` | `scope`, `reason`, `organizationId`, `module`, `entryPoint`, `occurrences`, `firstAt`, `lastAt`, up to 20 `requestIds`, and `actor`: its kind and id plus `context`, the reason of the scope the caller was already in, such as `actor:anonymous` for an anonymous storefront request |

Aggregation matters because two crossings run on every authenticated storefront
request: `auth: resolve customer org` and `tenant: resolve customer roll-up flag`.
`module` is taken from the call stack. It names the module package or overlay
module that made the call, `platform` for the kernel, and `host` for an
application entry point.

**A failed write loses nothing.** The stderr line is already written. The batch is
put back, merged with anything recorded since, and retried on the next tick, and
`tenant.escape_hatch.persist_failed` is logged. During a long outage, more than
5000 distinct pending records fold into one overflow row per scope and module,
so the outage costs detail but keeps the count. On shutdown, `dispose()` runs a
final flush. Anything still unwritten is printed as one
`tenant.escape_hatch.unpersisted` line per row. An operator command that never
opened a database read no organization's data, and prints its records as
`tenant.escape_hatch.not_persisted`.

The audit write does not use the escape hatch itself, so it records nothing and
cannot recurse. `audit_logs` cannot be switched off. Writing these rows does
not depend on it in any case, because the writer and the
`audit_log_entries` table belong to the platform. The module only provides the
viewer.

`@endora-commerce/platform/tenancy` is one of the five platform subpaths a module
may import (`kernel`, `http`, `tenancy`, `commands`, `events`);
`check:platform-surface` reports a module that imports any other platform subpath.

**Pinning work to one organization is not available to modules.** The platform
implements `withOrgScope(organizationId, reason, fn)` beside `withSystemScope`
(`packages/platform/src/tenancy/escape-hatch.ts`), but it is not on the published
barrel: ruling D-285 keeps it host-only until a module needs work pinned to one
organization that a system scope plus an explicit `organizationId` constraint cannot
express (`specs/conventions/module-composition.md`, item 10a). A module that needs a
per-organization job today runs it under a system scope and filters by
`organizationId` itself.

## Background jobs

Queue consumers run detached from any request, so they carry **no** context by
default and must establish one explicitly — otherwise a tenant-scoped query
fail-closes. Start the job under `enterSystemScope(reason, fn)` from
`@endora-commerce/platform/kernel`: it opens a system tenant context and the
platform resolution scope in one step, and emits the same escape-hatch audit
record as `withSystemScope`. Use `withSystemScope` to widen an execution that
already has a context, such as a request handler.

### A scheduled tick with nothing to do enters no scope

A repeating job — a BullMQ Job Scheduler, an interval timer — is the one caller
that defeats the audit's aggregation: its ticks are further apart than one flush
window, so a scope entered on every tick is one `tenant.escape_hatch` row per
tick, whether or not the tick did anything. A sixty-second worker writes 1,440
rows a day on an instance where nothing happened, and those rows bury the ones
an auditor is looking for. An audit log is for what happened.

So a scheduled tick **asks first, and enters the scope only when there is
work**:

```ts
export async function runSweepTick(deps: SweepDeps): Promise<void> {
  let hasWork = true;
  try {
    hasWork = await deps.service.hasSweepWork(); // no scope: answers yes or no
  } catch (error) {
    rethrowIfModuleDisabled(error); // a module switched off is never absorbed
    hasWork = true; // cannot tell — run as before, scope and audit row included
  }
  if (!hasWork) return;
  await enterSystemScope('orders: sweep outstanding order follow-ups', () => deps.service.sweep());
}
```

The question runs with **no** tenant context, so it cannot go through a
tenant-scoped entity — that read fail-closes with `MissingTenantContextError`,
by design. It is a raw statement over the module's own tables, and it is held
to four rules. They are what keeps it from becoming a way around the audit:

1. **It returns one boolean.** `select exists(…)`, and nothing else: no row, no
   id, no organization, no count. A caller that learns only "go and look" has
   read no tenant's data, which is why there is nothing to record. A probe
   that returns anything more is an unaudited cross-tenant read. Widen the
   scope instead.
2. **It is the job's own predicate.** `false` must mean the pass would read and
   write nothing. Where the exact predicate needs something that belongs
   inside the scope — a setting, another module's port — ask a wider question
   that can only err towards `true`.
3. **Its answer is never handed to the pass.** The work re-reads everything
   inside the scope. The probe decides *whether* the scope is entered, never
   *what* is done in it.
4. **A probe that fails counts as `true`.** The tick then runs exactly as it
   did before, audit row included. A failing probe may cost a row and can
   never save one.

Presence is still decided first: a module that is off asks its tables nothing.

A tick that has work is recorded exactly as before, and so is every job that
is work by definition — a queue consumer handed a job to process, a scheduled
feed generation, a taxonomy check. Do not put a probe in front of those. If no
scope-free question can be asked honestly, leave the scope where it is and
accept the row: an extra audit row is noise, a missing one is a hole.

This rule covers scheduled ticks only. The scope entries a process makes while
it starts (`boot: …`) are still written one row each.

## Tests

The backend test harness sets a default `system` context
(`backend/test/tenancy-setup.ts`) so direct-EM seeding/cleanup works without
wrapping every site; the request pipeline still overrides it with the real scoped
context, so cross-tenant behavior is exercised for real. That harness does not
go through `composeApp`, so it attaches no audit writer and its escape-hatch
records only reach stderr. Host tests can call
`runWithoutTenantContext(fn)` (`packages/platform/src/tenancy/tenant-context.ts`)
to assert fail-closed behavior explicitly; it is not on the published barrel.
