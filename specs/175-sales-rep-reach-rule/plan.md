# Design: #305, one sales-representative reach rule on every surface

Architect, 2026-11-07. Read-only: nothing was edited, committed or posted. Code was read at
`origin/master` 76a4f9e50. The local `master` checkout is stale: it does not contain #847, so
cite `origin/master`.

**Owner ruling (2026-11-07, on #305):** there is one rule, `SalesRepAssignmentPort.canSeeOrganization`
(assigned, roll-up, unassigned fallback), and it applies to every surface. That includes the
organization list, admin search, and the tenant-filtered member, customer, quote-request and
customer-settings reads. Do it now.

This replaces escalation E1 in my ruling on #847 (`arch-rulings-1.md` §A). Two parts of that
ruling no longer hold:
- ruling 1 ("the list stays wide");
- the accepted side effect that a list row could open a not-found page.

The `organizationInReach` preHandler (`routes.admin.ts:238` on `origin/master`) stays as shipped.

---

## 0. The rule, stated once

A sales representative R can see Organization X when X is **not governed by somebody else**:

| R holds `organizations:rollup`? | X is governed by | R sees X when |
| --- | --- | --- |
| no (flat) | X's own assignment rows | X has no assignment row, or one of its rows is R's |
| yes | the nearest ancestor-or-self of X that has any assignment row | there is no such node, or that node has a row for R |

This is exactly `canSeeOrganization` (`packages/modules/organizations/src/backend/services/sales-rep-assignment-service.ts:75-100`).
- Under the flat rule, an unassigned child of an organization assigned to another rep is visible. That is today's behaviour and it stays.
- A platform-wide admin (any role other than `sales_representative`) sees everything, as today (`admin-tenant-scope.ts:43`).
- An admin with no role sees nothing (`unresolved`), as today.

**Consequence the owner should know about (not an escalation; it follows from "every surface").**
- Reps cannot be assigned to personal (B2C) organizations (`assign()` refuses `isPersonal`, line 166). So every B2C customer is unassigned.
- Under the ruling, every rep therefore gains **tenant** read and write on every B2C customer's orders, invoices, carts, returns, addresses and quote requests, plus every unassigned company's. Today only the organization screens and the `customers` authority checks reach them.
- That is the ruling applied consistently (D-3W and `customers` FR-037 already let reps act on these accounts). The changeset must say it in a **"Behaviour change on upgrade."** paragraph.

---

## 1. How the tenant scope includes unassigned organizations without breaking Principle XI

### What is wrong today
`adminTenantScopePort` answers `allowedOrganizationIds = listAssignedOrganizationIds(rep)` (`packages/modules/organizations/src/backend/services/admin-tenant-scope.ts:46`). The platform turns that into a literal `organization_id IN (…)` on the row's own column (`packages/platform/src/tenancy/filters.ts:63-64, 132-136`; `derived-scope.ts:38-58`). Unassigned organizations are not in that set, and that is the #305 symptom.

### Decision D1: describe a rep's reach by its complement, the organizations governed by someone else
- `organizations` computes `excludedOrganizationIds`: the set of X for which `canSeeOrganization(R, X)` is false.
- The tenant predicate becomes `organization_id NOT IN (excluded)`, on the row's own column.

**Rationale**
- **Size.** The visible set includes every personal organization, so it grows with the customer base (100 000 B2C customers means 100 000 ids in every admin request's `IN`). The excluded set contains only organizations that carry an assignment, plus their subtrees under roll-up. Those are company organizations and, by `assign()`'s refusal, never personal ones. It is bounded by the B2B book, not by B2C volume.
- **Same rule.** The complement of `canSeeOrganization` is exactly the excluded set. There is no second rule to drift (#305's complaint).
- **Same filter shape.** It stays a predicate on the filtered row's own column, with no join and no subquery. That keeps the FR-002 / exit (a′) constraint recorded in `filters.ts:86-89`.

**Principle XI holds, and here is how each clause is met:**
- *Server-derived.* The set comes from `organizations`' tables for the authenticated admin, never from request input.
- *No "no-organization" path.* `organization_id NOT IN (…)` is `NULL` (not true) for a row whose `organization_id` is null, so such a row never matches. Since D-178 such rows do not exist for `@OrgScoped` data anyway. Pin it with a test.
- *Fail closed.* If the computation throws, the port answers `unresolved` (existing mechanism, `resolve-tenant-context.ts:158-168`): no organization, refused at the first tenant read. The computation must not catch. An empty excluded set is a legitimate answer: it means nobody else holds an assignment, so R sees everything. It must never be produced by an error.
- *Writes.* `org-write-guard.ts` and `isOrgInScope` get the same arm, so a rep may write only where they may read.

**Rejected alternatives**
- *Materialise the visible set (assigned ∪ unassigned) as an `allowed-set`.* Its size is O(customers) per admin request, it can exceed PostgreSQL's 65 535 bind-parameter limit, and the cost lands on every admin request, because the scope hook runs before every route.
- *A subquery in the filter (`organization_id NOT IN (SELECT … FROM organization_sales_rep_assignments …)`).* The platform's filter would name a module's table (Principle I, `check:module-boundary`). It breaks the "no join, no subquery" ruling. The roll-up rule would need a recursive or path query inside every filtered statement.
- *Drop the fallback from `canSeeOrganization` instead.* That is the other #305 option, and the owner rejected it.
- *A denormalised `governing_rep_ids` column on every tenant table.* That is a migration in every module that owns an `@OrgScoped` table, for a fact `organizations` owns.

### Decision D2: a new tenant mode, and a constraint union with `'set'` removed so every consumer has to be revisited
**Contracts** (`packages/contracts/src/organizations.ts:791-806`). `AdminTenantScope` gains a member:

```ts
| {
    readonly allowAll: false;
    readonly reach: 'excluding';
    /** Organizations governed by another representative: never reachable. */
    readonly excludedOrganizationIds: string[];
    /** The rep's own assignments (roll-up expanded). Ranking and "mine" filters only; never a filter input. */
    readonly assignedOrganizationIds: string[];
  }
```

The existing `allowedOrganizationIds` member stays. Customer roll-up and API keys still use `allowed-set`.

**Platform** (`packages/platform/src/tenancy/`):
- `TenantScopeMode` gains `'excluded-set'`.
- `TenantContext` gains `excludedOrganizationIds?` and `assignedOrganizationIds?`.
- `AdminScopeInput` gains the same.
- `resolveTenantContext` maps `reach: 'excluding'` to `mode: 'excluded-set'`. The `unresolved` check comes first, unchanged.

**`OrgConstraint` (`derived-scope.ts:18-21`): remove `'set'`, add `'allowed'` and `'excluded'`.**

```ts
| { kind: 'all' }
| { kind: 'single'; organizationId: string | null }
| { kind: 'allowed'; organizationIds: readonly string[] }
| { kind: 'excluded'; excludedOrganizationIds: readonly string[]; assignedOrganizationIds: readonly string[] }
```

**Rationale for removing `'set'` rather than adding beside it.** There are about 40 module files that branch on the constraint or the mode (`git grep -n "kind === 'set'\|case 'set'\|'allowed-set'\|allowedOrganizationIds" origin/master -- packages/modules`). The usual shape is `constraint.kind === 'set' ? filter : noFilter`. If a new kind were simply added, those sites would treat a rep's `excluded` constraint as "no filter", which widens a rep to **everything**, silently. With `'set'` removed:
- every `=== 'set'` comparison is TS2367 ("no overlap");
- every `case 'set'` is TS2678;
- so `tsc` lists each site and none can be forgotten.

`mode === 'allowed-set'` checks still compile, because the mode survives for customer roll-up. The dev audits those by grep, and a unit test pins it (§5).

**Helpers, so consumers stop reading raw ids.** Each helper gains the new arm:
- `orgScopeWhere(field)` gives `{ [field]: { $nin: excluded } }`;
- `isOrgInScope(id)` gives `!excluded.includes(id)`;
- `ruleVisibleForScope(targets)` gives `targets.length === 0 || targets.some(t => !excluded.has(t))`.

Two helpers are new:
- `orgScopeSql(columnSql)`, which returns `{ sql, params }` for the raw-SQL consumers (catalog, analytics, search availability, customers search);
- `assignedOrganizationIdsForRanking()`, which returns `[]` unless the constraint is `excluded` or `allowed`.

`filters.ts`:
- `orgFilterCond` adds `case 'excluded-set'`, which gives `{ organizationId: { $nin: excluded } }`.
- `customerFilterCond` does the same for the `present` column. For the `absent` column it matches nothing and notes the refusal, exactly as the `allowed-set` arm does today (lines 137-145).

### Decision D3: the id list travels as one array parameter, not N placeholders
- Both arms (`allowed-set` and `excluded-set`) emit `organization_id = ANY(?::uuid[])` and `organization_id <> ALL(?::uuid[])`, each with **one** bind parameter.
- **Rationale.** `IN (?, ?, …)` puts one bind per id. Today's roll-up `allowed-set` can already approach the 65 535-parameter protocol limit on a large tree, and the excluded set can be thousands of ids. PostgreSQL 14+ hashes a long `= ANY` array, and 15+ also hashes `<> ALL`.
- **Validation spike required (dev, first task):** confirm that a MikroORM global-filter `cond` can return `raw()`-keyed fragments that survive `em.fork`, `populate` and `em.count`. If it cannot, fall back to `$in`/`$nin` and chunk nothing. Record the measured ceiling in the plan.
- **Rejected:** a temporary table per request. It is a write on every admin request.

### Decision D4: the excluded set is computed in one statement by `organizations`, using the materialised `path`
This is the new method `SalesRepAssignmentService.listExcludedOrganizationIds(adminUserId)`. It is internal, not on the port, and `adminTenantScopePort` calls it.

**Flat (no roll-up capability):**
```sql
select organization_id
from organization_sales_rep_assignments
group by organization_id
having not bool_or(admin_user_id = :rep)
```

**Roll-up**, over the existing `organizations.path` (`'/<root>/…/<id>/'`, `organization-tree-service.ts:8-25`):
```sql
with gov as (                      -- every node carrying an assignment, and whether R is on it
  select o.id, o.path, bool_or(a.admin_user_id = :rep) as mine
  from organization_sales_rep_assignments a
  join organizations o on o.id = a.organization_id
  group by o.id, o.path
),
cand as (                          -- every node under a node governed by someone else
  select distinct d.id, d.path
  from gov g
  join organizations d on d.path like g.path || '%'
  where not g.mine
)
select c.id from cand c
where not (                        -- the nearest governing node decides (FR-011 override)
  select g.mine from gov g
  where c.path like g.path || '%'
  order by length(g.path) desc
  limit 1
)
```
- The paths hold only `/`, hex digits and `-`, so `LIKE` needs no escaping. Every reader must still pass `isReadableTreePath` (`organization-tree-service.ts:110`). ~~A path that is not readable makes the query fail, and the scope answers `unresolved`.~~ **Amended 2026-11-08 (ruling Q1 on PR #954):** a governing node whose path is not readable resolves through the one-id rule — it governs itself, and its descendants are the nodes whose own paths name it (`like '%/<id>/%'`) — and no longer refuses; each request that hits this fallback logs one `warn` naming the organizations. A statement that throws still fails the request (the scope answers `unresolved` only for the refusals the port already carries).
- The dev must confirm that `organizations.path` has a `text_pattern_ops` (or `COLLATE "C"`) btree index, which is what the tree service's "scan on path" relies on. If it does not, adding one is an `organizations` migration (`pnpm --filter backend run migration:new`).

**`assignedOrganizationIds`** keeps today's `listAssignedOrganizationIds`, which ranking and `scope=mine` need. Rewrite it as one statement over the same `gov` CTE, so the request runs at most two queries. Today it runs one `subtreeNodes` query per assigned node and loads the whole assignment table (lines 110-141).

**`canSeeOrganization` stays the one-id question.** Its answer must equal `!excluded.includes(id)` for every id. A property test enforces that (§5), and there is no second implementation of the rule's semantics. `canSeeOrganization` itself is cheap and is kept for the `/:id` preHandler and the three existing consumers.

### Decision D5: no cache in this change
- **Rationale.** A stale **excluded** set *widens* reach. For example, a new child of another rep's governed node, created after the cache was filled, would be visible to everyone until the cache is refreshed. The cache would therefore need invalidation that is synchronous and post-commit on every assignment change, tree move and organization creation. That is new machinery, it exists only for a cost that has not been measured, and computing the set per request bounds staleness to one request.
- **If the performance budget fails (§3), the fallback, in this order:**
  1. **A materialised `organization_reach_governor (organization_id, governor_id)` table, owned by `organizations`.** `assign`, `unassign`, move and create maintain it inside their own Command transactions. The excluded set then becomes an indexed join.
  2. **Only if that is still not enough, a per-process cache keyed by a governance generation.** The generation is bumped after commit by those Commands and announced on a Redis channel, following the pricing-generation pattern described in `specs/conventions/pricing.md`. It has a short TTL, and a lost announcement is bounded by that TTL. This step needs an owner ruling, because staleness widens reach.

---

## 2. List and search narrow to the same rule

### Organization list
`GET /api/v1/admin/organizations` (`routes.admin.ts` on `origin/master`, about line 300) adds `Object.assign(where, orgScopeWhere('id'))`. `Organization` is `@GlobalEntity`, so it is filtered explicitly on its primary key.
- Platform admin: `{}`, so no change.
- Rep: `id NOT IN excluded`.
- `includePersonal=true` shows personal organizations to a rep. They are unassigned, so that is correct.
- The pickers that read this endpoint (parent picker, order-create organization picker) narrow with it.

### Admin search
`OrganizationAdminSearchService.search` (`services/organization-admin-search.service.ts`):
- adds the same `orgScopeWhere('id')` to its `where`;
- takes the assigned ids from `assignedOrganizationIdsForRanking()`, not from `constraint.organizationIds`. The boot hook at `index.ts:1275-1278` passes it today and would compile-break under D2.
- FR-015a's assigned-first ranking stays: assigned first, then the rest of the visible set.

The `customers` search provider (`packages/modules/customers/src/backend/admin-search-provider.ts`) and `moderationActorFor` (`customers/src/backend/index.ts:165-185`) stop calling `listAssignedOrganizationIds` and read the ambient constraint through the helpers.

### Spec amendment
In `specs/150-admin-global-search/spec.md`, FR-015's exception ("every non-personal, non-deleted organization, for anyone who may read that list") is replaced by: "the organizations the list shows the searching admin, which for a sales representative is the reach rule of `organizations`". Add a note that Q2's answer is superseded by the owner's ruling of 2026-11-07 on #305. FR-015a is unchanged. The glossary line at `spec.md:37` already says "plus the unassigned ones, as everywhere else in the admin", and it becomes true.

### Other surfaces that hand-build reach (they move to the helpers)

| Site | Today | Change |
| --- | --- | --- |
| `orders/src/backend/index.ts:540-560` (admin order list scope) | `listAssignedOrganizationIds` | read the ambient `OrgConstraint` through `orgScopeWhere` |
| `quote_requests/.../rfq-admin-service.ts:212-219` | one `canSeeOrganization` per row after the tenant filter (N+1) | delete the loop: the tenant filter now *is* the rule. `scope=mine` keeps `listAssignedOrganizationIds`, and `scope=unassigned` stays as it is |
| `quick_order/.../routes.preferences.admin.ts:38-46` | "has assignments" means salesperson | use the role-derived constraint: platform admin when `all`, otherwise `isOrgInScope` per scope id |
| `projects/.../project-access.ts`, `lookup-service.ts`, `document-lookup-service.ts` and `crm/.../admin-reach.ts` | `adminTenantScopePort` answer read as an allowed list | follow the compile errors, then use the helpers |
| `quote_requests/src/backend/routes.sales-reps.ts:58` (`/sales-reps/:id/organizations`) | lists a rep's **assignments** | unchanged: it reports assignments, not reach |
| PR #900 (#856, gating `/admin/organizations/:id/sales-reps` on reach) | in review | must use `canSeeOrganization` / `organizationInReach`, which it does per my #847 ruling (b). No conflict |

The rest of the compile-error list (catalog, search availability, analytics, returns, seo, inventory, customer_accounts, mfa admin routes) is mechanical. Each site takes the helper for its own shape. **None** of them may read `excludedOrganizationIds` directly; only the platform's tenancy directory does.

---

## 3. Performance on large organization trees

**Budget.** The excluded-set computation adds at most **5 ms p95** to an admin request, with a seed of:
- 50 000 organizations (45 000 personal), 5 000 company organizations in trees of depth ≤ 6;
- 3 000 assignment rows over 40 reps;
- roll-up on for half of them.

**Expected cost.**
- Flat: one aggregate over the assignment table, O(assignments).
- Roll-up: one aggregate, plus a path-prefix range scan for each node governed by another rep, plus a nearest-governor probe per candidate over `gov`. That is O(nodes under foreign governance × log). `gov` is small: it is the set of assigned nodes.
- This replaces today's roll-up cost, which is one query per assigned node plus a full load of the assignment table on every admin request.

**Filter cost.**
- `<> ALL(array)` of k uuids is hashed on PostgreSQL ≥ 15. Check the deployment's floor in `docker-compose` / the docs (PostgreSQL 16 in `dev:infra`). On 14 it is a linear probe per row, so for k > ~1 000 the plan should be checked with `EXPLAIN ANALYZE`.
- The filter column is `organization_id`, which every `@OrgScoped` table indexes. With a `NOT IN`, the planner will mostly seq-scan or use another index. For a rep this is no worse than today's `IN` over a roll-up set.

**Perf test.** `backend/test/perf/organizations/sales-rep-reach.perf.test.ts` (new) seeds the shape above and asserts:
- the budget for `listExcludedOrganizationIds` and `listAssignedOrganizationIds`;
- the p95 of `GET /admin/customers?limit=50` and `GET /admin/orders?limit=50` for a roll-up rep, measured against the platform admin's p95 for the same requests. The rep's p95 may be at most 1.5× the admin's, and the threshold is written down in the test. Read `specs/conventions/backend-test-suite.md` before adding a perf file.

**The scope hook runs on every admin request**, including session-only routes. If the budget fails only because of that, make the tenant context's id list lazy, resolved on the first tenant read. MikroORM filter `cond` may be async. That is a follow-up, not this change.

---

## 4. Cross-cutting

- **Command Bus / audit:** no new writes. Assignment writes are already audited (`organization.sales_rep_assign` / `_unassign`).
- **Admin permissions / palette / i18n:** nothing new. No new user-facing string except the docs.
- **Settings:** none. The rule is not configurable (owner ruling).
- **Module activation:** `organizations` is `nonDeactivatable`. The port's "owner off" fail-closed paragraph is unchanged.
- **Contracts and release intent (`specs/conventions/release-intent.md`):** the packages are 0.x, so `major` is refused and these are **minor** changesets.
  - `@endora-commerce/contracts`: a new `AdminTenantScope` member.
  - `@endora-commerce/platform`: `OrgConstraint` `'set'` becomes `'allowed'`, plus `'excluded'` and the new mode. Name the old and new spellings in the body, as the convention requires for a break.
  - `organizations`, `customers`, `orders`, `quote_requests`, `quick_order`, `projects`, `crm`, and every module the compile errors touch.
  - The `organizations` changeset carries the **"Behaviour change on upgrade."** paragraph from §0.
- **Generated artefacts:** none expected. Run `composer:generate` / `manifests:generate` only if a manifest changes, and none should.

---

## 5. Tests (written first)

**Unit, platform** (`packages/platform/src/tenancy/*.test.ts`):
- `resolveTenantContext`: `reach: 'excluding'` maps to `excluded-set`; `unresolved` beside it still holds nothing.
- `orgFilterCond`: `excluded-set` gives a `<> ALL` fragment; an empty list gives no restriction.
- `customerFilterCond`: column present gives the same; column absent matches nothing and notes the refusal.
- `orgScopeWhere`, `isOrgInScope`, `ruleVisibleForScope`, `orgScopeSql`: one case per arm.
- A row whose `organization_id` is NULL is never matched (against a real query in an integration file).

**Unit, organizations** (`packages/modules/organizations/src/backend/services/sales-rep-assignment-service.test.ts`, extended):
- A table over a fixture tree. Nodes: assigned to R; assigned to R and to S; assigned to S; unassigned; unassigned child of S's node; R's node under S's node (the override); S's node under R's node.
- Each case runs flat and roll-up. Expected `canSeeOrganization`.
- **Property:** for every node and every rep, `canSeeOrganization(rep, id) === !excluded(rep).includes(id)`. This is the one guarantee that the rule exists once.

**Integration: the test #305 asks for** (`backend/test/integration/organizations/sales-rep-reach-one-rule.test.ts`, new). Setup:
- rep A assigned to O1;
- U is unassigned and has a member, a quote request and a customer-level setting;
- F is assigned to rep B;
- P is a personal organization.

For A:

| Surface | O1 | U | P | F |
| --- | --- | --- | --- | --- |
| `GET /admin/organizations/:id` | 200 | 200 | 200 | 404 |
| `GET /admin/customers/:id` (member) | 200 | 200 | 200 | 404 |
| quote requests of the org | listed | listed | listed | absent, `/:id` 404 |
| customer-level setting read and write | 200 | 200 | 200 | 404 |
| `GET /admin/organizations` (`includePersonal=true`) | present | present | present | absent |
| admin search by name | hit, ranked first | hit | (not searched) | no hit |

Two more cases in the same file:
- roll-up: A holds `organizations:rollup`, and F's unassigned child Fc is hidden. Without roll-up, Fc is visible (the flat rule).
- a platform admin sees all four columns.

**Tests to re-pin (they encode the old split).** Each re-pin cites #305 and the 2026-11-07 ruling:
- `backend/test/contract/organizations/admin-organization-reach.contract.test.ts`: re-add the list cases, now *narrowing*.
- `backend/test/integration/admin_search/organizations-provider.test.ts`: search equals the narrowed list.
- `backend/test/integration/quote_requests/rep-scope.test.ts`: unassigned organization's requests listed and readable.
- `backend/test/integration/orders/sales-rep-scope.test.ts`: unassigned organization's orders visible.
- `packages/modules/customers/src/backend/sales-rep-scope-wiring.test.ts`.

Grep `backend/test/**` for `listAssignedOrganizationIds` and `allowedOrganizationIds` before finishing (AGENTS.md trap 2). The contract and integration trees are not in `test:unit:fast`.

**Static pin.** `backend/test/unit/tenancy/excluded-ids-stay-in-platform.test.ts` (new) fails if any file under `packages/modules/**/src` names `excludedOrganizationIds` or compares `mode === 'allowed-set'`. It has an explicit, commented allowlist; the customer roll-up site is the expected entry. A test, not a new `check-*` script, so the check estate is untouched.

**Perf:** §3.

---

## 6. Docs (EN and PL, same merge request)

| EN | PL |
| --- | --- |
| `packages/modules/organizations/docs/organizations.md`: the "Which Organizations a sales representative reaches" paragraph (line 54), the assignment section (about line 238), the list endpoint row | `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/organizations.md` |
| `packages/modules/organizations/docs/organization-hierarchy.md`: roll-up "nearest assignment wins", now stated for every surface | `…/current/modules/organization-hierarchy.md` |
| `docs/docs/architecture/tenant-scoping.md`: the new `excluded-set` mode, why it is the complement, NULL behaviour, fail-closed | `…/current/architecture/tenant-scoping.md` |
| `packages/modules/customers/docs/customers.md:53`: the fallback sentence, now true on the tenant side too | `…/current/modules/customers.md` |
| `packages/modules/quote_requests/docs/quote_requests.md:525-550`: one rule, tenant filter equals it | its PL page (`module-reference/quote-requests.md`, check the current location) |
| `packages/modules/admin_search/docs/admin-search.md:71-73`: organizations follow the narrowed list | `…/current/modules/admin-search.md` |

- Refresh the PL translation pins as `docs/docs/contributing/documentation-i18n.md` describes, and run `check:docs-translations`.
- `docs/docs/upgrading-an-instance.md` (EN and PL) gets an "After upgrading" note covering two things:
  - reps gain the unassigned organizations' tenant data;
  - lists and search lose other reps' organizations.

  Include a query listing, per rep, how many organizations become visible and how many disappear.

---

## 7. ESCALATE

- **E-305-1 (owner, confirmation only).** "Every surface" gives every rep tenant access to **every B2C customer's** orders, invoices, carts and returns (§0). Recommendation: proceed as ruled. If the owner wants B2C data kept from reps, that is a different rule (exclude `isPersonal` from the fallback), and it must be ruled before implementation starts, not after.
- **E-305-2 (owner, only if §3's budget fails).** Allowing a cache whose staleness widens reach (D5, step 2). Recommendation: try the governor table first.

---

## 8. Constitution Check

| Principle | Verdict |
| --- | --- |
| I Modular | PASS: the rule and both queries stay in `organizations`; consumers use platform helpers and ports |
| II API-first | PASS: contracts change first (additive member). The platform type change is versioned by changeset |
| III TDD | PASS: §5. The one-rule integration test and the property test are red first |
| IV Minimal deps | PASS: no dependency |
| XI Multi-tenant (NN) | PASS: server-derived, fails closed, NULL never matches, writes guarded by the same arm |
| XII Channel scoping | n/a |
| XIII Command Bus | PASS: no new writes |
| XVII Toggleable | PASS: `organizations` non-deactivatable; unchanged |

**Verdict: PASS.**

## 9. Handoff to `endora-commerce-dev`

**Size:** L. Cross-cutting: platform, contracts, organizations, and about 15 consumer modules by compile error.

**Spec home:** create `specs/<n>-sales-rep-reach-rule/` with `.specify/scripts/bash/create-new-feature.sh`, which applies the feature floor. Paste this design as `plan.md` / `research.md` and amend spec 150 FR-015. No D-number is needed: the owner's ruling is on #305.

**Order:**
1. Spike D3, the array-parameter filter fragment. Record the result.
2. Red tests: the platform unit tests, the organizations property test, and the integration test from §5.
3. Contracts: the `AdminTenantScope` member.
4. Platform: mode, `OrgConstraint` (remove `'set'`), filters, helpers.
5. organizations: `listExcludedOrganizationIds`, the rewritten `listAssignedOrganizationIds`, the port, list and search.
6. Fix every compile error with the helpers, plus the hand-built sites in §2.
7. Re-pin the old tests; the static pin; the perf test.
8. Docs EN and PL, upgrade note, changesets.
9. `pnpm run build:packages`, `pnpm -r run typecheck`, `pnpm -r run lint`, the targeted contract and integration files above, and `pnpm --filter '!backend' run test`.
