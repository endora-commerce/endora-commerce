# Feature Specification: One sales-representative reach rule on every surface

**Feature Branch**: `fix/305-sales-rep-reach-rule`
**Created**: 2026-11-08
**Status**: Implemented, except FR-006 (the performance budget is not met — `research.md` R-3)
**Input**: GitHub issue #305, and the owner's rulings on it of 2026-11-07 ("one rule, every
surface, do it now") and 2026-11-08 (E-305-1 confirmed; E-305-2: no cache unless the governor
table fails the budget).

The design is `plan.md` (architect, binding); `research.md` records what the implementation
measured and chose.

## User story

As an operator running a team of sales representatives, I want every admin screen to agree on
which Organizations a representative reaches, so that a row a representative is shown always
opens, and an Organization they may act on shows its members, orders and requests.

## Requirements

- **FR-001**: A sales representative reaches an Organization exactly when
  `SalesRepAssignmentPort.canSeeOrganization` says so — assigned, roll-up (nearest assignment
  wins) and the unassigned fallback — on every admin surface: the Organization screens, the
  Organizations list and pickers, admin search, and every tenant-scoped read and write.
- **FR-002**: Every unassigned Organization is reached by every representative, personal (B2C)
  Organizations included (E-305-1).
- **FR-003**: The tenant scope describes the reach by its complement (`excluded-set`), on the
  row's own organization column, and never matches a row with no organization.
- **FR-004**: The reach is computed server-side, per request, with no cache; a failure refuses
  rather than widens.
- **FR-005**: The excluded set and `canSeeOrganization` are one rule: for every Organization and
  representative, flat and roll-up, they agree.
- **FR-006**: The reach costs at most 5 ms p95 per request at the design's reference volume,
  and a representative's admin list p95 stays within 1.5× a platform administrator's.

## Traceability

| Requirement | Test |
| --- | --- |
| FR-001, FR-002 | `backend/test/integration/organizations/sales-rep-reach-one-rule.test.ts` |
| FR-003 | `packages/platform/src/tenancy/excluded-set.test.ts` |
| FR-004 | `packages/modules/organizations/src/backend/services/admin-tenant-scope.test.ts` |
| FR-005 | `backend/test/integration/organizations/sales-rep-reach-property.test.ts`, `packages/modules/organizations/src/backend/services/sales-rep-reach.test.ts` |
| FR-006 | `backend/test/perf/organizations/sales-rep-reach.perf.test.ts` |
| Excluded ids stay in the platform | `backend/test/unit/tenancy/excluded-ids-stay-in-platform.test.ts` |
