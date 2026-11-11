# Research: one sales-representative reach rule on every surface (#305)

The design is `plan.md` (the architect's, 2026-11-07, binding). This file records what the
implementation measured and where it had to choose. Owner rulings: E-305-1 confirmed
(2026-11-08, every unassigned Organization, B2C included, on every surface); E-305-2 no cache
unless the governor table fails the budget (it was not needed, see R-3).

## R-1. Spike D3 — an array-parameter fragment in a filter `cond`

Measured on MikroORM 6.6.16 / PostgreSQL 16 (the `dev:infra:test` container), a scratch
schema with one filtered entity, 100 rows plus one with a null `organization_id`, and the
filter returning either form:

| Form | `find` | `count` | `populate` (1:m) | fork + `transactional` | 70 000 ids |
| --- | --- | --- | --- | --- | --- |
| `{ [raw(a => `${a}.organization_id <> all(?::uuid[])`, ['{…}'])]: [] }` | 90 | 90 | **101** (filter dropped) | 50 | ok, 518 ms |
| `{ organizationId: { $nin: ids } }` | 90 | 90 | 90 | 50 | ok, 576 ms |

- A JS array passed to `raw()` is expanded to `'a', 'b'` inline and fails to parse; a
  PostgreSQL array literal string is one parameter and works.
- **The `raw()` fragment is dropped when the filter runs for a `populate`.** That is a widening
  (the null-organization row came back), so D3's array-parameter form is rejected for the
  filter, as the design's fallback allows. The filter uses `$nin`.
- `$nin: []` renders as `1 = 1`, which matches a null organization. The filter therefore spells
  `{ $ne: null, $nin }` (and `{ $ne: null }` for an empty list), so a null organization never
  matches at either length (D1's Principle XI clause).
- The raw-SQL helper (`orgScopeSql`) does use one `?::uuid[]` array parameter, as D3 intended:
  raw SQL is not subject to the `populate` problem.

## R-2. D4 — the statement

- `organizations.path` has `organizations_path_prefix_idx (path text_pattern_ops)` (migration
  `20260720T044254`), so no migration was needed.
- One statement per request, answering both sets (`reachOf`): flat is a `group by` over the
  assignment table with `bool_or(admin_user_id = rep)`; roll-up is the same aggregate joined to
  each governing node's path, `union all` every node under one of them (range compare
  `~>=~ / ~<~` for the index, `like` as the recheck). The nearest-governor decision is made in
  TypeScript (`services/sales-rep-reach.ts`, pure, unit-tested) from each node's **own** path —
  the exact chain `canSeeOrganization` walks — rather than in a correlated SQL subquery.
- `listAssignedOrganizationIds` is now the `assignedOrganizationIds` half of the same
  statement (it used to run one `subtreeNodes` query per assigned node plus a full load of the
  assignment table).
- **Deviation from D4, an unreadable governing path.** D4 had an unreadable path fail the query
  and the scope answer `unresolved`. Implemented that way first, the targeted contract and
  integration run showed what it costs: the harness seeds organizations with an empty path
  (`TEST_SUSPENDED_ORGANIZATION_ID`, and children created without one), and as soon as one of
  them carried an assignment, **every roll-up representative was refused on every request** —
  120 failed tests across 25 files, all with the same error. One defective row would do the same
  in production. Instead, a governing node whose path cannot be read is resolved exactly as
  `canSeeOrganization` resolves it: it governs itself (its own path names no ancestor), and its
  descendants are found by the segment their own paths carry (`like '%/<id>/%'`, a scan paid
  only while such a row exists). That is the one-id rule's answer, never wider, and the property
  test now includes such a node. **Accepted** (ruling Q1 on PR #954); each request that hits the
  fallback logs one `warn` naming the organizations; the harness's seed paths are #956.
- A failure of the statement fails the request (the port does not catch it).
- The property test (`backend/test/integration/organizations/sales-rep-reach-property.test.ts`)
  holds `canSeeOrganization(rep, id) === !excluded(rep).includes(id)` over a fixture with every
  governance shape, three reps, flat and roll-up.

## R-3. Performance (design §3) — **the budget is not met; #955 blocks the release**

*Superseded in part by R-5 (issue #955): the reach now meets its budget; the list ratio does not.*

Budget not met; issue #955 (the governor table and the array parameter) blocks the release that ships this change, not its merge (ruling Q5 on PR #954). The 1.5× list assertion is marked as a known failure pointing at #955; its threshold is unchanged.

Seed as §3 (`backend/test/perf/organizations/sales-rep-reach.perf.test.ts`): 50 000
organizations (45 000 personal), 5 000 company organizations in trees of 10, 3 000 assignment
rows over 40 representatives. Measured 2026-11-08 on the shared 16-thread development host
(load average about 3), PostgreSQL 16 in the `dev:infra:test` container, p95:

| Measurement | Budget | Measured |
| --- | --- | --- |
| `reachOf`, flat representative | 5 ms | 6.5 ms |
| `reachOf`, roll-up representative | 5 ms | 72.8 ms |
| `GET /admin/customers?pageSize=50`, roll-up rep vs platform admin | ≤ 1.5× | 136.2 ms vs 17.7 ms (7.7×) |
| `GET /admin/orders?pageSize=50`, roll-up rep vs platform admin | ≤ 1.5× | 295.4 ms vs 13.0 ms (22.7×) |

- Two plan defects were found and fixed on the way, and are pinned in the statement: the planner
  flattened the unreadable-path branch into a nested loop over every organization × every
  governing node (11.5 s), and once that was fixed it still priced the statement at 3.5 M and
  spent 448 ms in JIT compilation for a 45 ms execution. The statement now pins one index probe
  per governing node and runs with `jit = off`.
- What remains is inherent to D4: one prefix probe per governing node (3 000 of them), and,
  on the list endpoints, a `NOT IN` of the whole excluded set (about 8 000 ids for a roll-up
  representative of this seed) bound into every tenant-scoped statement of the request.
- Per the owner's ruling (E-305-2, 2026-11-08) nothing was cached. The design's next step is the
  materialised `organization_reach_governor` table (D5 step 1); it was **not** built in this
  change, which stops here and reports the measurement.

## R-5. Issue #955 — the governor table and one array parameter

Seed and host as R-3 (PostgreSQL 16, `dev:infra:test`), measured 2026-11-09. The host was shared
with two other agents' runs; the load average is given with each figure, and the ratio is the
number that means something, because both sides of it are measured in the same minute.

### Step 0 — where one list request went

`backend/test/perf/organizations/sales-rep-reach.perf.test.ts`'s seed, 20 requests each after
5 warm-ups, medians, every `Connection.execute` timed (load average 10–20):

| Request | Total | Reach statement | Other SQL | Remainder (ORM build, hydration, Fastify) |
| --- | --- | --- | --- | --- |
| orders, platform admin | 18.3 ms | — | 8.9 ms (11 statements) | 9.4 ms |
| orders, roll-up rep | 1 207.6 ms | 133 ms | 984 ms: four tenant statements of 222–334 ms, each carrying **8 760** parameters | 90.5 ms |
| customers, platform admin | 40.5 ms | — | 20.8 ms | 19.7 ms |
| customers, roll-up rep | 554.9 ms | 128.4 ms | 245.5 ms: two tenant statements of 111 / 114 ms, 4 381 parameters each | 181 ms |

The rep's excluded set is 4 380 organizations. Every orders statement carries it **twice**: the
`@OrgScoped` filter, and `orderListScopeFor`'s explicit `orgScopeWhere('organizationId')` for the
same ambient constraint.

### Step 1 — `organization_reach_governor` (design D5.1)

Migration `20261109T144721_organizations_reach_governor`. One row per organization that has a
governing node: the nearest ancestor-or-self carrying an assignment, read off the organization's
**own** path (the chain `canSeeOrganization` walks; an unreadable path names no ancestor; an
assignment on an organization that does not exist governs itself). One function writes it,
`organizations_reach_governor_rebuild(ids)`; the backfill is that function over everything.

**Deviation from the issue's wording, for the architect.** The issue says the table is
"maintained inside the assign, unassign, move, create and delete Commands". It is maintained
inside those Commands' transactions, but by **statement-level triggers** on `organizations` and
`organization_sales_rep_assignments` that call the rebuild function for what the statement
touched, not by a call in each Command. A stale row widens reach, and the Commands are not the
only writers: 45 test files and the demo reset write assignments directly, and organizations are
inserted by registration, personal-organization provisioning and other modules' migrations. A
trigger is the one place none of them can skip, which is why this module's
`organizations_seed_predefined_roles` is one. Each maintenance step takes one transaction-scoped
advisory lock first, so an assignment on X and a concurrent move of D under X cannot each miss
the other's uncommitted change (under `READ COMMITTED` the second waits, then reads with a fresh
snapshot). A randomised history of 400 writes of every kind — assign, bulk assign, unassign,
truncate, orphan assignment, create, move, delete, breaking a path — compared the table with the
chain rule after each write, twice, with no difference; the integration property
(`sales-rep-reach-property.test.ts`) now does the same after a create, every assignment change,
set-parent, move, delete and three raw writes, through the real routes, against
`canSeeOrganization` and against a rebuild from scratch.

`reachOf` is now one statement over the table — flat reads its self-rows (an organization
governs itself exactly when it carries an assignment) — answering both lists as `string_agg`
aggregates, one row instead of one per id. The unreadable-path `warn` (ruling Q1) is a probe of a
partial index that is empty on undamaged data; `organizations_tree_path_readable` is PL/pgSQL so
the index predicate is matched as written (inlined, it was not, and the probe scanned every
organization: 126 ms of a 130 ms statement). It no longer warns about an assignment whose
organization does not exist — that is not a stored path that cannot be read.

### Step 2 — one array parameter

`excludedOrganizationsPredicate` (`packages/platform/src/tenancy/excluded-predicate.ts`):
`{ organizationId: { $ne: raw('all(?::uuid[])', [literal]) } }`, `{ $ne: null }` when empty. The
spike matched `$nin` row for row on `find`, `count`, `findAndCount`, `findByCursor`, a joined and a
select-in `populate`, `Collection.init`, a fork, a transaction, `nativeUpdate` / `nativeDelete`,
a filter merged with a `where` on the same column (`$ne` against `$ne`: MikroORM `$and`s them),
an empty list and 70 000 ids, and MikroORM's raw-fragment cache stayed empty over 1 800
statements. Rejected: a `raw()` key (dropped in a joined populate, R-1); `$nin: raw('select
unnest(…)')` (rendered `not in select …` in a joined populate — a syntax error — and, with
parentheses, a scalar subquery in the main query); a binary-format array parameter (MikroORM
inlines a `Buffer` as `E'\\x…'`).

### Result

| Measurement | Budget | #954 (2026-11-08, load ~3) | Before, this branch's base (load ~10) | After (load ~4–6) |
| --- | --- | --- | --- | --- |
| `reachOf`, flat rep, p95 | 5 ms | 6.5 ms | 8.0 ms | **2.8 ms** |
| `reachOf`, roll-up rep, p95 | 5 ms | 72.8 ms | 87.8 ms | **4.9 ms** |
| customers list, roll-up rep vs admin, p95 | ≤ 1.5× | 136.2 vs 17.7 ms (7.7×) | 174.1 vs 24.2 ms (7.2×) | 57.4 vs 16.0 ms (**3.6×**) |
| orders list, roll-up rep vs admin, p95 | ≤ 1.5× | 295.4 vs 13.0 ms (22.7×) | 417.0 vs 17.5 ms (23.9×) | 122.2 vs 11.4 ms (**10.8×**) |

**The reach meets its budget; the list ratio does not**, and the 1.5× assertion stays a known
failure with its threshold unchanged.

### Why the array parameter cannot close the gap

MikroORM 6 does not bind parameters: `AbstractSqlConnection.execute` formats every parameter into
the statement text (`platform.formatQuery`) and sends `knex.raw(formatted)`. "One array
parameter" is therefore one 160 KB literal per occurrence, rather than 4 380 quoted literals each
coerced and planned as a constant — about twice as cheap, and still the size of the list. Measured
in isolation on `customer_accounts` (median of 20, through the entity manager's connection,
load ~4):

| Statement (excluded list of 4 380) | Median | Planning | Execution |
| --- | --- | --- | --- |
| `count(*) … where organization_id <> all(?::uuid[])` | 10.5 ms | 1.2 ms | 0.2 ms |
| `select cardinality(?::uuid[])` — the parse alone | 9.1 ms | 0.0 ms | 0.0 ms |
| `count(*) … where length(?) > 0` — carrying the 160 KB string, unused | 4.7 ms | 0.4 ms | 0.0 ms |
| `count(*) … where organization_id not in (select unnest(?::uuid[]))` | 12.2 ms | 0.1 ms | 1.2 ms |
| `count(*) … where organization_id not in (select g.organization_id from organization_reach_governor g where not exists (… the rep's assignment on g.governor_id))` | **2.1 ms** | 0.2 ms | 2.0 ms |

Directly over `pg` (no MikroORM), `array_in` alone takes 4.8–5.3 ms for 4 380 uuids. So every
tenant-scoped statement pays ~5–10 ms for carrying the list, whatever its spelling, against a
platform admin's ~0.5 ms statement: customers runs two such statements, orders four (each
carrying the list twice). The only form measured that does not ship the list is the subquery on
the governor table, and it **revises FR-002 / exit (a′)** ("no join, no subquery") and puts an
`organizations`-owned table into the platform's filter — so it was not built, and goes to the
architect.

### For the architect

1. The subquery (or an `organizations`-owned set-returning function the platform filter calls,
   which keeps the table name out of the platform) — 2.1 ms a statement at this seed, and it would
   also let the scope hook stop computing the excluded list on every admin request; `reachOf`
   would remain for ranking and `scope=mine`.
2. Independently of 1: the orders list carries the predicate twice per statement (the global
   filter and the explicit `orgScopeWhere` for the same ambient constraint). Dropping the
   redundant one halves that cost; it does not reach 1.5× alone.
3. The trigger-based maintenance above, in place of per-Command calls.

## R-6. The architect's ruling on #955 (2026-11-09), implemented

### Q1 — trigger maintenance accepted; its known costs

- **Serialisation.** The maintenance takes one platform-wide transaction-scoped advisory lock,
  so every assignment write, organization insert and path change serialises from its triggering
  statement until its transaction commits. An update that changes no path takes no lock
  (`v_changed is null`). Registration runs at human speed; a parallel bulk organization import
  serialises. A lock keyed by tree root is a possible follow-up, on a measurement only: its
  correctness under unreadable paths and orphan assignments is subtle, and a wrong key widens reach.
- **Deadlocks.** The advisory lock can invert order against row locks the same transaction already
  holds; PostgreSQL detects that and aborts one side. Accepted.
- **Proven, not only argued.** `test/integration/organizations/reach-governor-maintenance.test.ts`
  races an assignment on X against a create, and against a move, of D under X on two real
  connections, in both commit orders; D stays governed by X and a roll-up representative other
  than the assignee does not reach it. The same file asserts all eight triggers exist with
  `tgenabled = 'O'`. The property test now also assigns through the Command Bus, undoes it (the
  inverse write) and runs a Command that fails after its write.

### Q2 — the subquery, and the spelling that survived

The two property-keyed spellings the ruling named, in order:

1. `{ organizationId: { $ne: null, $nin: <knex query builder over S> } }` — **passed the whole
   matrix** (spike on scratch entities, then the integration file above on
   `quote_request_org_policies`, `Cart` and scratch entities filtered by the platform's own conds):
   `find`, `count`, `findAndCount`, `findByCursor`, joined and select-in `populate`,
   `Collection.init`, fork, `transactional`, `nativeUpdate`, `nativeDelete`, a filter merged with a
   `where` on the same column (`=`, `$ne`, `$nin`), a genuinely empty S with an organization-less
   row, and MikroORM's raw-fragment cache unchanged over 1 000 statements. It renders
   `col is not null and col not in (select * from (S) as "reach_excluded")` in the main query and
   in a joined populate's `on` clause alike. The builder comes from a connection-less knex
   instance, so `orgScopeWhere` stays pure.
2. `{ $not: { organizationId: { $in: … } } }` — not needed; in the spike it failed in a joined
   populate (`'[object Object]'` rendered into the `on` clause) and in a `where` on a relation.

`organizations_reach_excluded(admin_user_id, rollup)` is `language sql stable`: inlined, it plans
as a hashed anti join over the governor table (1.4 ms roll-up, 2.4 ms flat at the perf seed), and
the filtered statement as a hashed SubPlan — pinned by an `EXPLAIN` assertion on
`customer_accounts` and `orders`. It is the `not mine` half of `organizations_reach_split`, which `reachOf` reads in one scan for both of its lists.

### Q3 — the orders list carries the reach once

`orderListScopeFor()` with no argument answers `where: {}`; the perf file asserts that every
`orders` and `customer_accounts` statement of a representative's list names
`organizations_reach_excluded` exactly once.

### Result after Phase 1 and Q3 (2026-11-09)

Perf seed as R-3, `sales-rep-reach.perf.test.ts`, each run started only once the load average
had fallen below 8 (the host was shared with two other agents; a run that spiked to 24 mid-way is
discarded). p95:

| Measurement | Budget | Run A (load 6.9 → 4.3) | Run B (load 4.3 → 3.6) |
| --- | --- | --- | --- |
| `reachOf`, flat | 5 ms | 3.1 ms | 4.9 ms |
| `reachOf`, roll-up | 5 ms | 4.5 ms | 4.9 ms |
| customers list, rep vs admin | ≤ 1.5× | 23.1 vs 15.4 ms (**1.50×**) | 27.5 vs 18.8 ms (**1.46×**) |
| orders list, rep vs admin | ≤ 1.5× | 21.3 vs 14.7 ms (**1.45×**) | 24.6 vs 11.9 ms (**2.07×**) |

The reach meets its budget (both lists now come from one scan of
`organizations_reach_split`, of which `organizations_reach_excluded` is the `not mine` half). The
lists are **at the threshold, not reliably under it**: three of four ratios pass, one does not, so
the 1.5× assertion keeps its `it.fails` marker and its threshold. What remains on a list request
is the reach statement the scope hook still runs on every admin request (~3–5 ms, about a third of
the platform administrator's whole orders request) — Phase 2 of the ruling, which removes it from
the hot path, is a breaking platform-API change and waits for the owner. The reach budget is still
to be re-measured on a quiet host (load < 2) before the release.

## R-7. Phase 2 — the reach off the hot path (owner ruling 2026-11-10)

The owner allowed the uncorrelated `organizations`-owned subquery in the tenant filter — this amends
the FR-002 / exit (a′) ruling of 2026-08-24 for that shape — and ordered Phase 2 into the same
release.

- **Lazy, memoised reach.** `adminTenantScopePort` no longer calls `reachOf`: the `excluding` scope
  carries `excludedOrganizationsQuery` (what the filter renders) and `loadReach()`, which the
  port memoises and `resolveTenantContext` memoises again per tenant context. A request that only
  lists pays the role read and the roll-up permission, never the reach statement. A failed load
  rejects every helper awaiting it — a refusal, never a widening.
- **Async helpers.** `isOrgInScope` / `ruleVisibleForScope` were removed and replaced by
  `orgInScope` / `ruleInScope`; `assignedOrganizationIdsForRanking` is async. Where a caller judges
  many rows it already holds, `orgScopeTest()` gives a synchronous predicate taken once (price books,
  projects' reach, page filters). This replaces the ruling's "one statement per check" with one
  memoised load per request over the same `organizations_reach_split` definition: fewer statements,
  same rule.
- **Call sites:** carts, credit_limits, crm (7 files), customers, invoice_ledger, invoices (3),
  mfa, orders, organizations, price_lists (scope taken async, checks sync), projects (reach taken
  async), quick_order (`canManagePreference` and `PreferenceActor.reaches` async), and the
  platform's write guard (`beforeCreate` / `beforeUpdate` awaited by MikroORM's flush).
- **Lint.** `@typescript-eslint/no-floating-promises` and `no-misused-promises`, with
  `projectService`, on every touched source file (root `eslint.config.js`); a canary
  (`if (orgInScope(x))` and an unawaited call) fails both rules.

### Result (perf seed, p95, runs started at load < 6)

| Measurement | Budget | Run 1 (load 4.8) | Run 2 (load 3.5) | Run 3 (load 4.1 → 7.5) |
| --- | --- | --- | --- | --- |
| `reachOf`, flat | 5 ms | 3.3 ms | 3.1 ms | 3.6 ms |
| `reachOf`, roll-up | 5 ms | 4.3 ms | 4.4 ms | 5.5 ms |
| customers, rep vs admin | ≤ 1.5× | 23.0 / 17.9 ms (1.28×) | 20.7 / 16.3 ms (1.27×) | 22.7 / 18.0 ms (1.26×) |
| orders, rep vs admin | ≤ 1.5× | 14.6 / 10.6 ms (1.39×) | 14.6 / 10.6 ms (1.38×) | 19.2 / 12.6 ms (1.53×) |

After rebuilding every package (runs 1–3 above had stale builds of modules this change does not
touch), two more runs, started at load < 5:

| Measurement | Budget | Run 4 (load 2.9) | Run 5 (load 2.2 → 2.0) |
| --- | --- | --- | --- |
| `reachOf`, flat | 5 ms | 4.3 ms | 3.7 ms |
| `reachOf`, roll-up | 5 ms | **5.08 ms** | 4.9 ms |
| customers, rep vs admin | ≤ 1.5× | 23.2 / 18.7 ms (1.24×) | 23.4 / 20.5 ms (1.14×) |
| orders, rep vs admin | ≤ 1.5× | 16.1 / 11.8 ms (1.37×) | 18.0 / 12.1 ms (1.48×) |

The list assertions are plain `it` now, and every list measurement after Phase 2 but one passes
(run 3's 1.53× was taken while the shared host's load rose to 7.5). Roll-up `reachOf` sits at the
budget: 4.3–5.5 ms, over it in two of five runs. It no longer runs on a list request (Phase 2 took
it off the hot path); it bounds the single-id helpers and the ranking. The quiet-host (load < 2)
measurement the architect asked for before the release is still owed: the host never went below 2
while this ran.

## R-4. Choices the design left open

- **Consumers that took an `AdminTenantScope` of another administrator** (`crm` assignee and
  bell reach, `projects` `canSeeAs`) read it through a new platform helper,
  `orgConstraintForAdminScope(scope)`, so no module names the excluded ids.
- **Consumers with a constraint parameter** (analytics, status-usage counts, price books,
  projects) pass the constraint to the helpers, which now accept a context or a constraint.
- **`orders`' `resolveAdminOrdersScope`** answers only `{ allowAll }`; what is reached comes from
  the ambient context. `orderListPort`'s contract scope (an explicit allowed set a caller has
  already authorised) is unchanged.
- **`customers`' moderation actor** no longer carries ids: the list and global search pass
  `allowedOrganizationIds: null` to `customer_accounts`' search and rely on the `@OrgScoped`
  tenant filter, which is the rule.
- **Organization pickers in `crm` and `projects`** page through `searchByName` with a doubling
  window for a representative, because the reachable population is the platform's minus a
  bounded excluded set.
- **`quick_order` default preferences**: "no assignment" no longer means "platform admin"; the
  actor kind follows the tenant context, and the `salesperson` actor carries `reaches(id)`.
- **The quote-request list's per-row `canSeeOrganization` pass is kept**, against `plan.md` §2
  ("delete the loop"). That list applies the rule to every role but `platform_admin`, so a custom
  role holding `rfqs:handle` — whose tenant scope is unrestricted — is filtered only by the loop;
  deleting it widened such an admin to every request (measured:
  `test/integration/admin_search/quote-requests-provider.test.ts`). For a sales representative
  the loop now agrees with the tenant filter. **Ruling Q3 on PR #954:** kept, and run only when
  the ambient constraint is `all` and the actor is not `platform_admin`, in both passes (list and
  search). The PO ruled custom roles platform-wide (option A); that change is #957.
- **Organization ids that do not exist** are "in reach" under the complement (ruling Q4:
  accepted). The quick-order default-preference write now refuses one with 404 for a
  representative; the price-book audience already refused it (400 `PRICE_BOOK_AUDIENCE_KIND`).
  Pinned by `backend/test/contract/organizations/sales-rep-nonexistent-organization.contract.test.ts`.
- **The static pin** allowlists the producer files in `organizations`; no module source names a
  tenant mode (a module test that observes the mode is allowed).
