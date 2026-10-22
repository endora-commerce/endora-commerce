# Implementation Plan: Price-book editor (P2 of D-287)

**Branch**: `feat/161-price-book-editor` (from the release branch `feat/160-pricing-model-v2`) | **Date**: 2026-10-22 | **Spec**: [spec.md](./spec.md)
**Input**: `specs/161-price-book-editor/spec.md`, planned against the implemented P1
(`origin/feat/160-pricing-model-v2` at `2910477da`)

## Summary

Build the admin screens of the price-book model on P1's API: the book list and header editor, a
tiered grid with bulk add, paste, keyboard entry, undo and one-batch save, CSV export and import with
a server-validated preview, duplication, the product editor's base-price panel and its list of books
pricing the product, the explanation screen with named runner-ups, the read-only precedence and the
list-price switch on *Pricing settings*, the storefront list-price pair, and representative scope —
restoring `/price-lists` as the module's landing and registering the three palette actions. Seven
small additive backend gaps found while reading P1's code (G11–G17) are built first. Design decisions:
`research.md`; screen ↔ API mapping of every FR: `contracts/ui-api-mapping.md`.

## Technical Context

**Language/Version**: TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM
**Primary Dependencies**: React 19 + Vite + react-router-dom 7 through `@endora-commerce/admin-kit`
and `@endora-commerce/admin-shell` (admin); Next.js 15 App Router (storefront, list-price pair only);
Fastify + Zod (backend gaps) — **no new runtime or dev dependency** (`axe-core` already an admin
devDependency, feature 147)
**Storage**: none new — P1's tables; one query-parameter and several response fields (G11–G17)
**Testing**: Vitest + Testing Library + `admin/test/helpers/axe.ts` (`expectNoAxeViolations`) for
admin; backend contract/integration suites for the gaps; storefront component tests
**Target Platform**: browser admin, SSR storefront, Linux API
**Project Type**: modular monolith web application
**Performance Goals**: FR-036 / SC-004 — grid interactions under 100 ms at 200 lines × 6 columns;
feedback within 400 ms; a 5 000-row save stays interactive
**Constraints**: P1's API is the contract — changed only through G11–G17, each additive; no client
price computation except labelled previews with the server's own rounding (G17)
**Scale/Scope**: books up to 5 000 rows; one admin-kit primitive (editable grid); five admin routes;
one zone contribution; three palette actions; FR-001–FR-042, SC-001–SC-009

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 (below).*

| Principle | Verdict | How |
| --- | --- | --- |
| I. Modular (NN) | pass | Screens in `price_lists`' own `src/admin/`; the base-price panel enters the product editor through the existing `product.editor.pricing.after` zone; `audit_logs` (G13) and `catalog` (G14) change only their own code; the grid primitive lives in admin-kit with no pricing knowledge |
| II. API-first | pass | Every gap is a Zod schema change in `@endora-commerce/contracts` before the route; additive; `minor` changesets |
| III. TDD (NN) | pass | Each phase writes failing tests first (component, axe, contract); every FR and SC traced in `tasks.md`; SC-001, SC-002 and the wall-clock half of SC-004 are recorded manual measurements (stated, not hidden) |
| IV. YAGNI | pass | No dependency; no virtualisation; no column mapping; saved views pending OQ-2 |
| V/VI/VIII | pass | strict TS; naming check; English in code, pl + en strings |
| VII. Storefront | pass | the list-price pair renders in existing server components (`BaseSalePriceBlock`/`PriceTag`), SSR intact |
| IX. UI reuse | pass | admin-kit pickers (product 145, organization, customer, customer group, category, sales channel), modal dialog, responsive table, pagination, sticky form actions, unsaved-changes prompt; one new shared primitive (editable grid) justified in `research.md` R4 |
| X. Queues | n/a | no async work |
| XI. Tenancy (NN) | pass | visibility is the server's; writability via G11; organization pickers scope-filtered; SC-006 tested by equality with an unknown id |
| XII. Channels (NN) | pass | channel set through P1's bridge; the UI offers only channels offering the currency (`targets/sales-channels?currency=`) |
| XIII. Command Bus (NN) | pass | every write is a P1 endpoint already on the bus; G11–G17 add no write path |
| XIV, XV | pass | no host columns; overlays unaffected |
| XVI. Palette | pass | `open-price-lists`, `new-price-book`, `open-price-explainer` in the manifest; `check:action-route-permissions`, `registered-bundles-shape` |
| XVII. Toggleable (NN) | pass | contributions (routes, nav, palette, zone) dropped when off; off-state tests extended |

**Post-design re-check**: pass. Two FRs depend on the owner's answer (OQ-1, OQ-2); neither changes a
principle verdict.

## Project Structure

### Documentation

```text
specs/161-price-book-editor/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md, tasks.md
├── contracts/ui-api-mapping.md       # every FR → endpoint or gap
├── contracts/backend-gaps.md         # G11–G17
├── contracts/csv-format.md
└── checklists/requirements.md
```

### Source code

```text
packages/contracts/src/
├── price-books.ts               # G11 writable/creatableAudienceKinds, G15 pageSize, G16 candidate names
├── price-book-decimal.ts        # G17 (moved)
├── price-lists.ts               # G14 listPrice on productResolvedPriceSchema
└── catalog.ts                   # G14 ProductSummary carries it
packages/modules/price_lists/
├── src/backend/routes.price-books.ts, services/price-book-reads.ts, services/buyer-line-price-service.ts,
│   services/matrix-decimal.ts   # G11, G12, G15, G16, G17
├── src/manifest.ts              # palette actions; i18n keys
├── i18n/en.json, pl.json
└── src/admin/
    ├── index.ts                 # routes /price-lists, /new, /explain, /display-modes, /:id; nav; zone
    ├── lib/price-books-api.ts, book-edit-state.ts, price-cell.ts, price-book-csv.ts, cell-labels.ts
    ├── pages/PriceBooksPage.tsx, PriceBookCreatePage.tsx, PriceBookPage.tsx (header | grid | import),
    │   PriceExplainerPage.tsx, DisplayModeOverridesPage.tsx (→ Pricing settings)
    ├── components/PriceBookHeaderForm.tsx, PriceBookGrid.tsx, CellDetailDialog.tsx,
    │   DuplicateDialog.tsx, ImportDialog.tsx, PrecedenceView.tsx, ShowListPriceSwitch.tsx
    └── zones/ProductBasePrices.tsx
packages/admin-kit/src/components/editable-grid/   # the shared grid primitive
packages/modules/audit_logs/src/admin/pages/AuditLogViewer.tsx   # G13
packages/modules/catalog/src/backend/services/catalog-query.service.ts   # G14
storefront/components/pricing/BaseSalePriceBlock.tsx, storefront/components/PriceTag.tsx   # list-price pair
admin/test/modules/price_lists/*, admin/test/kit/editable-grid.test.tsx, admin/test/modules/audit_logs/*
backend/test/contract/price_lists/*, backend/test/integration/catalog/list-price-in-summaries.test.ts
storefront/test/catalog/list-price-pair.test.tsx
```

## Phases (sequential, each ends with a review checkpoint)

The owner asked for quality over speed: phases run **in order**, and each ends with a checkpoint —
the phase's tests green, `typecheck` + `lint` for the touched workspaces, a self-review against the
UX-laws skill (`.claude/skills/ux-laws/SKILL.md`) for UI phases, and a review by the coordinator
before the next phase starts. No budget, threshold or assertion is loosened to pass a checkpoint.

| # | Phase | Stories / FRs |
| --- | --- | --- |
| 1 | Setup and baseline | — |
| 2 | Backend gaps G11–G17 | FR-019, FR-023, FR-026, FR-027, FR-030; G13 for the history link |
| 3 | Foundations: API client, editable-grid primitive, cell parser, CSV codec, routes skeleton, nav and palette restored, i18n keys | FR-007, FR-011, FR-029, FR-031, FR-034, FR-035 |
| 4 | US1 — list and header | FR-001–FR-005 |
| 5 | US2 — grid | FR-006–FR-017, FR-037 |
| 6 | US3 — base-price panel and books on the product | FR-019–FR-021 (OQ-1) |
| 7 | US4 — duplicate | FR-022 |
| 8 | US5 — explanation | FR-023, FR-024 |
| 9 | US6 + US7 — precedence view, list-price switch, storefront pair | FR-025, FR-026 |
| 10 | US8 — representative scope across every screen | FR-027, FR-028 |
| 11 | US9 — CSV export and import | FR-018, FR-038–FR-042 |
| 12 | Cross-cutting: accessibility sweep, states, performance, off-state, residue, generators, changesets, full verification, measurements | FR-031–FR-036, FR-029 |
| 13 | Release-gate hand-off to feature 160 Phase 13 (documentation) | — |

### Documentation

Not in this feature: the documentation rebuild for P1 and P2 is **feature 160 Phase 13** (FR-048,
SC-010 of spec 160), run on the release branch after this feature. This feature delivers in-product
help text only, and Phase 13 here hands the screens over to it (`tasks.md`).

### Removal of the old screens

Already done by P1 (160 T124: pages, components, zones and their admin tests). What remains, and is
removed here (`research.md` R12): the temporary landing on `/price-lists/display-modes`, the palette
action and i18n descriptions pointing at it, stale comments in
`packages/admin-shell/src/components/AppShell.tsx`, the "exactly the two display-mode members"
assertions of `admin/test/modules/price_lists/price-lists-zones.test.tsx`; then the grep of
`backend/test/**`, `admin/test/**`, `storefront/test/**` for the old names and the module-removal
residue ledger re-derived (`AGENTS.md`, *The traps*).

## Open questions for the owner

- **OQ-1 — How does the base-price panel save (FR-020)?** The spec says the panel saves *with the
  product editor's save action*. Zone contributions cannot do that today: admin-kit's zone API has no
  save participation, and every existing zone panel on the product editor saves itself (`research.md`
  R7). Options: **(A)** build a save-participation contract — admin-kit lets a zone register a
  `flush()` the host awaits on Save, and the catalogue product editor adopts it (two modules, one new
  admin-kit API, also usable by the PIM panels); **(B)** the panel has its own *Save prices* button
  inside the Pricing tab, guarded by the unsaved-changes prompt, as every other zone panel; FR-020 is
  amended accordingly. The architect's recommendation is (B) (the platform's existing pattern, no
  cross-module protocol); `tasks.md` carries both paths and marks the (B) tasks as the default.
- **OQ-2 — Saved views on the book list (FR-034)?** FR-034 requires saved views "where lists have
  filters". Saved views exist for products, quotes and orders (feature 147), each with a table owned
  by its module. For the book list this means a new `price_lists`-owned table, migration and API.
  Options: **(A)** build them in this feature; **(B)** keep the list's filters in the URL (shareable,
  bookmarkable) now and add saved views when asked; FR-034 is amended. The recommendation is (B)
  (books are few compared with products or orders); `tasks.md` carries (A) as an optional block.

No other FR is unmapped (`contracts/ui-api-mapping.md`).

## Measurements (filled at Phase 12)

| What | Target | Measured | Machine |
| --- | --- | --- | --- |
| SC-002 paste 50 × 3 and save | < 2 min | — | — |
| SC-004 keystroke-to-paint, 200 × 6 | < 100 ms | — | — |
| SC-004 focus move, 200 × 6 | < 100 ms | — | — |
| FR-036 5 000-row save | stays interactive, progress shown | — | — |
| SC-009 1 000-row preview | < 10 s | — | — |

## Complexity Tracking

No violation and no new dependency: nothing to justify.
