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
