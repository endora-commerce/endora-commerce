# Tasks: one sales-representative reach rule on every surface (#305)

Order as in `plan.md` §9.

- [x] T001 Spike D3 (array-parameter filter fragment); result in `research.md` R-1 — `$nin` for the filter, one array parameter for raw SQL
- [x] T002 Red tests: platform unit (`excluded-set.test.ts`), organizations decision unit (`sales-rep-reach.test.ts`), property and one-rule integration tests, static pin; re-pins of the tests that encoded the old split
- [x] T003 Contracts: `AdminTenantScope` `excluding` member; `PreferenceActor` `salesperson.reaches`
- [x] T004 Platform: `excluded-set` mode, `OrgConstraint` (`'set'` removed, `'allowed'` / `'excluded'` added), both filter arms, helpers (`orgScopeWhere`, `orgScopeSql`, `isOrgInScope`, `ruleVisibleForScope`, `reachesNoOrganization`, `assignedOrganizationIdsForRanking`, `orgConstraintForAdminScope`); customer / bound API key refused an `excluded-set` context
- [x] T005 organizations: `reachOf` (one statement), `listAssignedOrganizationIds` from it, `adminTenantScopePort`, list and admin search narrowed
- [x] T006 Every compile error and hand-built site moved to the helpers: analytics, carts, crm, customers, orders, price_lists, projects, quick_order, quote_requests (the list's per-row pass kept, see `research.md` R-4), returns; test harness mirrors
- [x] T007 Perf test (`backend/test/perf/organizations/sales-rep-reach.perf.test.ts`) — written and run; **the budget fails** (`research.md` R-3)
- [x] T007a The materialised `organization_reach_governor` table (design D5 step 1) and the one-array-parameter filter — issue #955, `research.md` R-5; the reach meets its budget
- [x] T007b Architect ruling on #955 Phase 1 + Q3: the reach as an organizations-owned subquery, the orders list carrying it once (`research.md` R-6)
- [x] T007c Phase 2 (owner ruling 2026-11-10): the reach loads lazily, memoised per request; the sync `isOrgInScope` / `ruleVisibleForScope` replaced by async helpers at every call site; promise lint rules on the touched files (`research.md` R-7)
- [x] T008 Docs EN + PL (organizations, organization hierarchy, tenant scoping, customers, quote requests, admin search), upgrade note with the query, translation pins, spec 150 FR-015 amended
- [x] T009 Changesets
