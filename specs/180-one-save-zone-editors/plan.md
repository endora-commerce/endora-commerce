# Implementation Plan: One Save for every admin editor with zone panels

**Branch**: `spec/407-product-editor-one-save` | **Date**: 2026-11-14 (revised after the owner rulings) | **Spec**: `specs/180-one-save-zone-editors/spec.md`
**Input**: Issue #407; owner rulings OQ-1…OQ-8 (2026-11-14); `specs/161-price-book-editor/` (FR-020,
R7); `specs/174-product-editor-scope-switcher/` (FR-070…FR-076, `contracts/editor-ui.md`); PR #1217
(merged).

## Summary

Add a save-participation API to `@endora-commerce/admin-kit`: a save session the host editor
provides, a hook with which a zone contribution — or a host-owned section — registers its draft,
change count, validation and save, one orchestrator (`runSave`) that validates every part first and
then writes the host's own changes and each participant in order through its own module's API, and
two generic controls (Save with count, outcome summary). Every editor whose zone panels write adopts
it (OQ-8 = C): the product editor first (base prices, Inventory product-row settings), then the
category editor (price display mode), the organization and customer detail (ordering defaults,
display mode, price negotiation and, by OQ-9 A, their own draft sections), and the sales-channel
editor (session only; warehouse routing stays immediate). `price_lists` gains a dry run of its
base-price write. No database change, no new dependency.

## Technical Context

**Language/Version**: TypeScript 5.x strict, React 19 (admin), Node ≥ 22.17 (backend)
**Primary Dependencies**: existing only
**Storage**: none new
**Testing**: Vitest — `admin/test/` (jsdom) for hosts and panels, co-located `*.test.ts(x)` in
`packages/admin-kit` and `packages/modules/price_lists`, `backend/test/contract/price_lists/`
**Target Platform**: admin SPA; one `price_lists` HTTP route
**Project Type**: monorepo web application
**Performance Goals**: a Save adds one request per dirty participant (plus one dry run for base
prices); validation runs in parallel
**Constraints**: writes stay per module (XIII, issue); zone props checked by `tsc`
**Scale/Scope**: 5 adopting hosts, 5 participant components in 4 modules, 2 kit controls, ~10 host
sections converted (OQ-9 A)

## Constitution Check

| Principle | Verdict | Note |
| --- | --- | --- |
| I. Modular (NN) | Pass | No host names a contributor; participation flows through the zone props contract; each module keeps its write path |
| II. API-first | Pass | Handle type and new zone props in `packages/contracts/src/admin-contributions.ts`; dry-run schema in `packages/contracts/src/price-books.ts` |
| III. TDD (NN) | Pass | Every FR traces to a failing test first (*Traceability*) |
| IV. YAGNI / dependencies | Pass | No dependency; dry run only where the server has rules beyond the schema (R20); no correlation column (R7) |
| VI. Naming (NN) / VIII. English (NN) | Pass | `check:naming`, `check:language` |
| IX. UI reuse | Pass | Two kit compositions with written UX justification (R16); no new visual primitive |
| XI. Tenancy (NN) | Pass | No new entity or query |
| XII. Channel scoping (NN) | N/A | |
| XIII. Command Bus (NN) | Pass | Each part writes through its module's existing write and audit; the display-mode write stays deliberately unaudited as today (`command-coverage-ignore`) — unchanged, not introduced |
| XVI. Command palette | N/A | No new surface |
| XVII. Toggleable modules (NN) | Pass | Participants exist only through `useAdminZone`'s presence filter; module-gone and `503` handled (R8); off-state test per participant module |

**Verdict: pass, no violations.**

## Cross-cutting design

- **Admin permissions**: no new code. Save visibility per FR-035 (host writable or any participant
  writable); each participant registers writable from its existing permission (`price_lists` server
  `writable`, `customers:manage` for negotiation and defaults on customers, the organization codes on
  organizations).
- **Command palette**: nothing new.
- **i18n**: en + pl; kit strings in `core`; part labels in each module (`contracts/*-save-ui.md`).
- **Settings, migrations, tenancy, cache**: none new; each write's existing lifecycle invalidation
  runs unchanged.
- **Conventions**: FR-083 adds a rule to `specs/conventions/module-admin-surfaces.md` — a zone host
  whose panels write offers a save session.
- **Changesets**: contracts minor, admin-kit minor; mod-catalog, mod-price-lists, mod-organizations,
  mod-customers, mod-sales-channels, mod-quick-order, mod-quote-requests, mod-inventory minor (each
  with the WP that changes it).

## Project Structure

### Documentation (this feature)

```text
specs/180-one-save-zone-editors/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── contracts/
│   ├── save-participation.md
│   ├── base-prices-dry-run.md
│   ├── product-editor-save-ui.md
│   └── other-editors-save-ui.md
├── checklists/requirements.md
└── tasks.md
```

### Source code

```text
packages/contracts/src/admin-contributions.ts                 # handle; saveSession on 6 props types
packages/contracts/src/price-books.ts                         # basePricesDryRunResponseSchema
packages/admin-kit/src/save-session/                          # NEW: provider, hooks, run-save.ts
packages/admin-kit/src/components/save-session/               # NEW: SaveSessionActions, SaveSessionSummary
packages/admin-kit/src/components/custom-field-values/CustomFieldValuesPanel.tsx
packages/admin-kit/src/zones/AdminZone.tsx                    # zone contribution context
packages/admin-kit/src/{lib,components}/index.ts             # explicit exports
packages/modules/_i18n/i18n/{en,pl}.json
packages/modules/catalog/src/admin/pages/ProductEditor.tsx
packages/modules/catalog/src/admin/components/{ProductEditorSaveAction,ProductInventoryTab}.tsx
packages/modules/catalog/src/admin/pages/CategoriesTree.tsx
packages/modules/price_lists/src/admin/zones/ProductBasePrices.tsx
packages/modules/price_lists/src/admin/components/DisplayModeOverrideRow.tsx
packages/modules/price_lists/src/backend/{routes.price-books.ts,services/price-book-service.ts}
packages/modules/organizations/src/admin/pages/OrganizationDetail.tsx (+ panels/)
packages/modules/customers/src/admin/pages/CustomerDetail.tsx
packages/modules/sales_channels/src/admin/pages/SalesChannelEditPage.tsx
packages/modules/quick_order/src/admin/components/DefaultPreferencesPanel.tsx
packages/modules/quote_requests/src/admin/negotiation-panel.tsx (+ zones/)
packages/modules/inventory/src/admin/zones/ChannelWarehouses.tsx  # badge only
packages/modules/*/i18n/{en,pl}.json, packages/modules/*/docs/** (+ docs/i18n/pl/**)
specs/conventions/module-admin-surfaces.md                    # FR-083 rule
admin/test/kit/, admin/test/modules/{catalog,price_lists,organizations,customers,sales_channels,quick_order,quote_requests}/
backend/test/contract/price_lists/
```

**Structure Decision**: extend admin-kit and the existing modules; no new module.

## Delivery phases and work packages

The product editor's WPs come first and prove the API; the other editors follow, each in its own
merge request.

| WP | Content | Depends on | Stories |
| --- | --- | --- | --- |
| WP-1 | contracts handle (all six props types) + admin-kit session, hooks (zone and host-owned), `runSave`, zone context | — | US6 |
| WP-2 | product editor host: provider, props, count, `run`, summary, guard, permission | WP-1, WP-5 (summary) | US1–US4 |
| WP-3 | `price_lists` base prices: dry run (backend + contracts), panel as participant, off-state test | WP-1 (backend half independent) | US1–US3, US5 |
| WP-4 | product Inventory tab product-row settings into the host write (OQ-7 = B) | WP-2 | US7 |
| WP-5 | admin-kit `SaveSessionActions`, `SaveSessionSummary`; `CustomFieldValuesPanel` participation | WP-1 | US6, US9 |
| WP-6 | category editor: provider, guard, zone move; `DisplayModeOverrideRow` as participant; off-state test | WP-1, WP-5 | US8, US5 |
| WP-7 | organization detail: page Save, host part (gathered `PATCH`), immediate badges; `DefaultPreferencesPanel` and negotiation panel as participants; off-state tests (`quick_order`, `price_lists`, `quote_requests`) | WP-5, WP-6 (display mode) | US9 |
| WP-8 | customer detail: page Save, custom-fields host part, immediate badges; reuse WP-7's participants | WP-7 | US9 |
| WP-9 | sales-channel editor: session on the identity form; `ChannelWarehouses` badge | WP-5 | US10 |
| WP-10 | docs EN + PL for every changed screen; FR-083 convention rule; amendment pointers in 161 / 174 | each WP's docs may ship with it; WP-10 closes the rest | — |

WP-2 and WP-3's admin half merge together (the base-price panel must not lose *Save prices* before the
host saves it). WP-7 and WP-8 depend on OQ-9; with OQ-9 = B they shrink to the participants and
FR-060 only; with C they are dropped. WP-9 depends on OQ-10.

## Requirement → test traceability

| FR | Test |
| --- | --- |
| FR-001, FR-004, FR-005, FR-006 | `packages/admin-kit/src/save-session/*.test.ts(x)`, `admin/test/kit/save-session.test.tsx` |
| FR-002 | `packages/admin-kit/src/save-session/save-session.types.test-d.ts` (`@ts-expect-error` on non-adopting zones) |
| FR-003 | `admin/test/kit/save-session.test.tsx`, `admin/test/modules/catalog/product-editor-one-save.test.tsx` |
| FR-007 | `admin/test/kit/save-session-controls.test.tsx` |
| FR-010…FR-016 | `run-save.test.ts`; per host: `product-editor-one-save`, `categories-tree-one-save`, `organization-detail-one-save`, `customer-detail-one-save`, `sales-channel-editor-one-save` |
| FR-017 | existing audit tests of each module's write, unchanged |
| FR-020, FR-024 | `admin/test/modules/price_lists/product-base-prices.save.test.tsx`, `product-editor-one-save.test.tsx` |
| FR-021 | `backend/test/contract/price_lists/base-prices-dry-run.test.ts` |
| FR-022, FR-023 | existing `ProductEditor.channels-tab.test.tsx`, `product-editor-immediate-actions.test.tsx`, `product-editor-save.test.tsx` |
| FR-025 | `admin/test/modules/catalog/product-editor-inventory-save.test.tsx` |
| FR-026 | `admin/test/modules/catalog/product-editor-sticky-save.test.tsx` (from #1217) stays green |
| FR-030…FR-033 | per-host one-save tests (guard cases) |
| FR-034 | `admin/test/modules/{price_lists,quick_order,quote_requests}/*-off.test.tsx` |
| FR-035 | per-host one-save tests (writable-participant-only operator) |
| FR-050…FR-052 | `admin/test/modules/catalog/categories-tree-one-save.test.tsx`, `check:admin-zones` |
| FR-060…FR-062 | `admin/test/modules/organizations/organization-detail-one-save.test.tsx`, `admin/test/modules/customers/customer-detail-one-save.test.tsx`, `admin/test/kit/custom-field-values-participant.test.tsx` |
| FR-070 | `admin/test/modules/sales_channels/sales-channel-editor-one-save.test.tsx` |
| FR-080 | `i18n:hardcoded` ratchet, catalogue parity |
| FR-081 | axe in each host's a11y test |
| FR-082, FR-083 | `check:docs-translations`, `check:module-docs`, `agents-router` / conventions tests |

## Conflicts with in-flight work

- **PR #1217** — merged; WP-2 changes `ProductEditorSaveAction`'s caller and adds the summary.
- **PR #1053** (`organizations` write port) — touches `organizations` backend, not
  `OrganizationDetail.tsx`; WP-7 rebases on it if it merges first.

## Follow-ups (not in this feature)

- Versions on the participant writes (R11).
- An `inventory` participant for per-warehouse thresholds (OQ-7 C, not chosen).
- Hosts that later gain a writing panel (FR-083 makes it a rule).

## Complexity Tracking

No violations; no new runtime dependency.

## Handoff to `endora-commerce-dev`

OQ-1…OQ-8 are ruled; OQ-9…OQ-11 wait for the owner and affect WP-7, WP-8, WP-9 only. WP-1 → WP-5 →
(WP-2 + WP-3) → WP-4 may start now; WP-6 after WP-5. Tests first per *Traceability*.
`pnpm run build:packages` after contracts / admin-kit changes; verify with `pnpm -r run typecheck`,
`pnpm -r run lint`, the targeted admin and module tests, `pnpm --filter '!backend' run test`, and
`check:admin-zones` (WP-6 moves a mount).
