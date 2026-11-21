# Implementation Plan: Contributed record tabs

**Branch**: `spec/record-tab-contributions` | **Date**: 2026-11-21 | **Spec**: `specs/183-record-tab-contributions/spec.md`
**Input**: the owner decision of 2026-11-21 (OD-1, OD-2); issue #1526 (WORK-12); PR #1758 (DS-20)
and its design record's Q1.

## Summary

The work adds a **record-tab zone**: a closed zone-enum member whose contributions are whole tabs,
each with a label and a lazily loaded count, inside a host's `RecordTabs`.

- **Contracts.** A `tab` field on the zone contribution, plus a TS-only `count` factory.
- **Kit.** A typed helper, `recordTabComponent()`, and an enumeration hook, `useRecordTabZone()`,
  which returns the tab items and renders the selected panel. The host keeps its strip, its slot
  choice and `?tab=`.
- **`check:admin-zones`.** It learns the two new spellings.
- **First host.** `crm` mounts `opportunity.detail.tabs` after Events.
- **First contributor.** `tasks` moves its opportunity panel out of `opportunity.detail.sidebar`
  into a **Tasks** tab. The count comes from a new `GET /api/v1/admin/tasks/count`.

There is no database change and no new dependency, permission, setting or palette action.

## Technical Context

**Language/Version**: TypeScript 5.x strict, React 19 (admin), Node ≥ 22.17 (backend)
**Primary Dependencies**: existing only
**Storage**: none new (the count is one aggregate over the indexed `task_record_links`)
**Testing**: Vitest.
- `admin/test/kit/` and `admin/test/modules/{crm,tasks}/` (jsdom).
- `packages/contracts/src/*.test.ts`.
- `backend/scripts/check-admin-zones.test.ts`.
- `backend/test/contract/tasks/`.

**Target Platform**: admin SPA, plus one `tasks` HTTP route
**Performance Goals**: a visible contributed tab costs one count request per record view. A tab
that is not visible costs zero bytes and zero requests.
**Constraints**: the host names no contributor (`foreign-module-id`); zone names are literals (Z7)
**Scale/Scope**: 1 enum member, 1 kit hook and 1 kit helper, 1 host, 1 contributor, 1 route

## Constitution Check

| Principle | Verdict | Note |
| --- | --- | --- |
| I. Modular (NN) | Pass | `crm` names no contributor. `tasks` calls only its own API. No lifecycle edge is added. |
| II. API-first | Pass | The zone contract and `TaskCountQuery/Response` are defined in `packages/contracts` first. Both changes are additive. |
| III. TDD (NN) | Pass | See § Requirement → test traceability. Every test is red first. |
| IV. Minimal dependencies | Pass | No new dependency. |
| VI / VIII | Pass | English identifiers and docs. `tab.id` `tasks` is a URL token, not prose. |
| IX. UI reuse | Pass | `RecordTabs`, `TabItem.count/countLabel`, `ZoneErrorBoundary`, `EditorSection` chrome and `TasksPanel` are reused. No new primitive. |
| XI. Multi-tenant (NN) | Pass | The count composes the same visibility pre-filter and query path as `GET /tasks`. There is no new tenant-scoped entity and no no-organization path. |
| XII. Channel scoping (NN) | N/A | Admin-only, no channel-scoped read. |
| XIII. Command Bus (NN) | N/A | Read-only. No write path is added. |
| XIV. Extensibility | N/A | |
| XV. Untouched core | Pass | Overlays can contribute record tabs through the same helper. |
| XVI. Palette | N/A | No new screen. The opportunity's existing actions already reach the tab, and `?tab=tasks` is a deep link. |
| XVII. Toggleable (NN) | Pass | The presence filter runs before any chunk or count loads, so with `tasks` off the screen is identical to never-installed (FR-015, tested). The route is absent when the module is off. |

**Verdict: PASS.** No item needs Complexity Tracking.

## Cross-cutting design

- **Permissions.** No new code. The tab is gated by `tasks:read` (`requiredPermission`), and the
  route by `requireAdmin('tasks:read')`. The permission inventory scanner reads both. The
  `recordTabComponent` options are read the way `zoneComponent`'s are, so confirm that
  `permission-inventory-scanner` resolves `requiredPermission` in the new helper's options object
  (add a fixture if it keys on the callee name).
- **Palette.** No change (XVI N/A above).
- **i18n.** New `tasks` keys, EN and PL, in `packages/modules/tasks/i18n/{en,pl}.json`:
  - `recordTab.label`: "Tasks" / "Zadania";
  - `recordTab.countLabel`: "{label}, open: {count}" / "{label}, otwarte: {count}", or nothing
    under OQ-1 B.
  - Remove `panel.title` only if nothing else uses it (order and RFQ still do, so keep it).
  - `crm` gains no string.
- **Settings, cache, audit.** None (research R5).
- **Activation.** The presence filter is the existing `selectZoneContributions` step 3. Follow
  `specs/conventions/module-activation.md` for the off-state test.
- **Docs.** `packages/modules/crm/docs/crm.md` (the opportunity's tabs list),
  `packages/modules/tasks/docs/tasks.md` ("Tasks on other records": opportunity is a tab, order and
  quote request stay sidebar sections), and the PL counterparts under
  `docs/i18n/pl/docusaurus-plugin-content-docs/current/modules/`. Re-pin with
  `check:docs-translations` (`specs/conventions/module-documentation.md`).

## Project Structure

### Documentation (this feature)

```text
specs/183-record-tab-contributions/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── record-tab-zone.md
│   └── task-count-api.md
└── checklists/requirements.md
```

### Source code (touched)

```text
packages/contracts/src/admin-contributions.ts        # member, RECORD_TAB_ZONE_NAMES, RecordTabDeclarationSchema,
                                                     # tab/count on the contribution, props map entry, doc comments
packages/contracts/src/tasks.ts                      # TaskCountQuerySchema, TaskCountResponseSchema
packages/admin-kit/src/contributions/zone-component.ts   # zoneComponent excludes tab zones; recordTabComponent
packages/admin-kit/src/contributions/index.ts        # export recordTabComponent + types (explicit barrel, R2)
packages/admin-kit/src/zones/use-record-tab-zone.tsx # new hook
packages/admin-kit/src/zones/AdminZone.tsx           # export lazyComponentFor module-internally (no public API change)
packages/admin-kit/src/zones/index.ts                # export useRecordTabZone + RecordTabZoneItem
backend/scripts/check-admin-zones.ts                 # two spellings (R7)
packages/modules/tasks/src/backend/services/task-service.ts   # count()
packages/modules/tasks/src/backend/routes/routes.tasks.ts     # GET /count (before /:id)
packages/modules/tasks/src/admin/api.ts              # countTasksBy(query, signal)
packages/modules/tasks/src/admin/index.ts            # contribution move
packages/modules/tasks/src/admin/zones/OpportunityTasksTab.tsx      # new
packages/modules/tasks/src/admin/zones/opportunity-task-count.ts    # new
packages/modules/tasks/src/admin/zones/OpportunityTasksPanel.tsx    # deleted
packages/modules/tasks/src/admin/zones/TasksPanel.tsx               # layout prop
packages/modules/tasks/i18n/{en,pl}.json
packages/modules/crm/src/admin/pages/OpportunityDetail.tsx          # hook + splice + renderPanel
packages/modules/crm/src/admin/pages/opportunity-detail/tabs.ts     # tabFromSearch/searchForTab take extra ids
packages/modules/crm/src/admin/pages/opportunity-detail/tabs.test.ts
```

**Host file rule.** No `crm` file may contain the string `tasks` as a module id in code. The host
comment must say "contributed tabs", never which module. `check:admin-zones` `foreign-module-id`
holds this.

## Delivery phases and work packages

Both MRs branch off `origin/master` **after PR #1758 merges**. If #1758 is still open, MR-A can
start (it does not touch zones), and MR-B waits.

**MR-A — `tasks` count read (backend + contracts only).**

1. Write the contract tests first (red): `TaskCountQuerySchema` accepts the list filters and
   refuses `limit`, `cursor` and a half-linked pair. `TaskCountResponseSchema` holds.
2. Write the `backend/test/contract/tasks/tasks-count.contract.test.ts` cases first (red):
   - count equals the list's total, across more than one page;
   - another user's private Task and another user's draft are excluded;
   - `statusCategory=open` narrows;
   - 401 and 403 without `tasks:read`;
   - the route is absent when `tasks` is off;
   - `/count` is not captured by `/:id`.
3. Implement `TaskService.count`, the route and `tasksApi.countTasksBy`.
4. Changesets: `@endora-commerce/contracts` minor, `@endora-commerce/mod-tasks` minor (new
   endpoint).

**MR-B — mechanism + opportunity adoption.**

1. **Contracts (red then green).** In `admin-contributions.test.ts` and
   `admin-contributions.placement.test.ts`:
   - the member exists;
   - `RECORD_TAB_ZONE_NAMES` is a subset of the enum;
   - the schema requires `tab` on `opportunity.detail.tabs` and refuses it on
     `opportunity.detail.sidebar`;
   - the `tab.id` and `labelKey` regexes hold;
   - `expectTypeOf` checks the props map.
2. **Kit (red then green).** New `admin/test/kit/kit-record-tab-zone.test.tsx`:
   - ordering by weight and then module;
   - presence and permission filter before any import (spy the factories);
   - labels come from the contributor's bundle;
   - the count is null, then a number, and stays null on rejection or a non-integer;
   - no count import for a hidden contribution;
   - abort on unmount and on a props change;
   - reserved-id and duplicate-id drops with a dev warning;
   - `renderPanel` error isolation;
   - `renderPanel(unknown)` returns `null`;
   - type tests: `zoneComponent('opportunity.detail.tabs', …)` and
     `recordTabComponent('order.detail.after', …)` are `@ts-expect-error`.
3. **Check.** `check-admin-zones.test.ts`:
   - `useRecordTabZone('x')` is a render site;
   - a computed name is reported;
   - `recordTabComponent('x', …)` is a contribution site;
   - a fixture with the member contributed but not rendered reports
     `contribution-to-unrendered-zone`.
   - Then run `pnpm run check:admin-zones` on the tree.
4. **Host.** `admin/test/modules/crm/OpportunityDetail.tabs-zone.test.tsx` (new), using probe
   contributions as in `OpportunityDetail.sidebar-zone.test.tsx` of #1758:
   - a contributed tab appears between Events and Notes, with its count and accessible name;
   - `?tab=<id>` selects it on first paint;
   - an unknown or hidden id falls back to Overview without rewriting the address;
   - the selection replaces the history entry;
   - a contribution colliding with `notes` is not drawn;
   - axe passes on the strip and the panel.
   - Extend `tabs.test.ts` for the extra-ids parameter.
5. **Contributor.**
   - In `packages/modules/tasks/src/admin/index.test.ts`: the opportunity contribution is a
     record tab on `opportunity.detail.tabs` with `tasks:read` and id `tasks`, and nothing of
     `tasks` targets `opportunity.detail.sidebar`.
   - `admin/test/modules/tasks/TasksPanel.test.tsx`: the `tab` layout has no duplicate heading,
     *Add task*'s `returnTo` carries `?tab=tasks`, and the limit is 50.
   - `admin/test/modules/tasks/off-state.test.tsx`: with `tasks` off, and without `tasks:read`,
     there is no tab, the count module is not imported, and no fetch is made to `/tasks`.
   - The count loader calls `countTasksBy` with `linkedKind=opportunity`, `linkedId` and
     `statusCategory=open`, and passes `signal`.
6. **Re-derive the ledgers named in the AGENTS.md traps** (a file is deleted and a contribution
   moves). Grep `backend/test/**` and `admin/test/**` for `OpportunityTasksPanel`, then run:
   - `backend/test/unit/kernel/module-removal.test.ts`;
   - the contribution-absent-owner and gating-graph units;
   - the `batch-*-surfaces.module-owned-surface` tests that list `tasks`' zones (#1758 touched
     `batch-fourteen` and `batch-fifteen`).
7. **Docs (EN+PL), i18n, changesets.**
   - `@endora-commerce/contracts` minor: the new member, `RECORD_TAB_ZONE_NAMES`, and `tab` on
     contributions.
   - `@endora-commerce/admin-kit` minor: `useRecordTabZone` and `recordTabComponent`.
     `zoneComponent` refusing a tab zone is not breaking, because no such zone existed.
   - `@endora-commerce/mod-crm` minor: the new extension point.
   - `@endora-commerce/mod-tasks` patch: the Tasks tab on the opportunity, if MR-A already carried
     the minor; otherwise minor.
   - In the consumer-facing text, name `opportunity.detail.tabs`, and say that the Tasks panel
     left `opportunity.detail.sidebar`. Follow `specs/conventions/release-intent.md`.

## Requirement → test traceability

| FR | Test |
| --- | --- |
| FR-001, FR-003 | contracts `admin-contributions*.test.ts`; kit type tests |
| FR-002 | contracts schema tests; `recordTabComponent` type tests |
| FR-004, FR-005, FR-006, FR-007, FR-008 | `admin/test/kit/kit-record-tab-zone.test.tsx` |
| FR-009 | `check-admin-zones.test.ts`; `pnpm run check:admin-zones` |
| FR-010, FR-011 | `OpportunityDetail.tabs-zone.test.tsx`; `opportunity-detail/tabs.test.ts` |
| FR-012 | `tasks/src/admin/index.test.ts` |
| FR-013 | `tasks-count.contract.test.ts`; count-loader unit test |
| FR-014 | `TasksPanel.test.tsx` (tab layout) |
| FR-015 | `tasks/off-state.test.tsx`; host test with the contribution hidden |
| FR-016 | `i18n:hardcoded`, bundle parity test |
| FR-017 | permission inventory (`admin_roles` scanner); no-migration (nothing to check) |
| FR-018 | `check:docs-translations` |

## Other hosts

The reasoning is in research R9. In short:

- **project:** it already has its own Tasks tab, so no change.
- **organization:** it is not a Task link kind, so it is out of scope.
- **order and RFQ:** they stay in the sidebar. Moving them is a follow-up issue to open after MR-B,
  if the owner wants the same treatment there: "Tasks as a record tab on order and quote request
  detail".

## Risks

| Risk | Mitigation |
| --- | --- |
| #1758 is not merged, or is reworked, before MR-B. | MR-B is rebased onto it. The only overlap is `tasks/src/admin/index.ts` and `OpportunitySidebar.tsx` (unchanged here). |
| A tab id collision with a future host tab breaks a saved `?tab=` link. | The host wins (FR-008), a dev warning is shown, and the host test asserts the current ids. Reserved ids are passed from the host's own array, so they cannot drift. |
| The count's visibility differs from the list's, so the badge and the list disagree (cf. #222). | The same private `#where` is used, and the contract test compares the count with the list's total across pages. |
| A props object literal re-triggers the count on every render. | Count reads are keyed on the props' string values, not on identity (RT3). A kit test renders the host twice and asserts one call. |
| The hook's label namespace is spoofed by a module. | `module` is the registry key (D-142), never declared. |
| A stale derived ledger after deleting `OpportunityTasksPanel.tsx`. | Phase step 6: an explicit grep and re-run. |
| Parallel agents. | Briefs forbid `git stash` and `pgrep -f` wait loops. |

## Complexity Tracking

No entries. There is no new runtime dependency, no new module, no new permission and no new
package.

## Handoff to `endora-commerce-dev`

- **Branches.** Two branches off `origin/master`, one per MR, each in its own worktree via
  `scripts/setup-worktree.sh`.
- **MR-A** (tasks count read) may start now. **MR-B** starts after #1758 merges.
- **MR-B order.** contracts, then `pnpm run build:packages`, then red kit tests, then the kit, then
  the check, then the red host test, then the host, then the contributor move, then docs, i18n and
  changesets.
- **Verify.**
  - `pnpm -r run typecheck` and `lint`;
  - `check:admin-zones`, `check:release-intent`, `check:docs-translations`, `i18n:hardcoded`,
    `check:naming`, `check:language`;
  - the targeted admin and contract tests above, plus the derived-ledger units;
  - `pnpm --filter '!backend' run test` (packages);
  - for MR-A, `backend/test/contract/tasks/` on `dev:infra:test`.
- **OQ-1.** Ship A (open Tasks) unless the owner has ruled B.
- **Designer review** of the tab layout of `TasksPanel` (spacing, toolbar) is non-blocking.
