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
small additive backend gaps found while reading P1's code (G11–G19 — G15 pages the grid by line at a
cost independent of the book — redesigned after its first implementation missed the budget
(`research.md` R14) —, G18 scopes batch validation and uncaps base books, G19 brings the list price to
search listings) are built first. Design decisions:
`research.md`; screen ↔ API mapping of every FR: `contracts/ui-api-mapping.md`.

## Technical Context

**Language/Version**: TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM
**Primary Dependencies**: React 19 + Vite + react-router-dom 7 through `@endora-commerce/admin-kit`
and `@endora-commerce/admin-shell` (admin); Next.js 15 App Router (storefront, list-price pair only);
Fastify + Zod (backend gaps) — **no new runtime or dev dependency** (`axe-core` already an admin
devDependency, feature 147)
**Storage**: `catalog` — four generated stored columns on `products` (`admin_name_key_<en|pl>`,
`admin_search_key_<en|pl>`), two IMMUTABLE SQL functions, a btree and a trigram index per admin language,
a trigram index on `product_variants.sku`; `price_lists` — one table `price_list_product_lines`; plus one
read endpoint (`GET …/:id/lines`), one catalogue port method (`pageProductsByAdminName`), one query
parameter and several response fields (G11–G19)
**Testing**: Vitest + Testing Library + `admin/test/helpers/axe.ts` (`expectNoAxeViolations`) for
admin; backend contract/integration suites for the gaps; storefront component tests
**Target Platform**: browser admin, SSR storefront, Linux API
**Project Type**: modular monolith web application
**Performance Goals**: FR-036 / SC-004 — grid interactions under 100 ms at 200 lines × 6 columns;
feedback within 400 ms; a 5 000-row save stays interactive
**Constraints**: P1's API is the contract — changed only through G11–G19, each additive; no client
price computation except labelled previews with the server's own rounding (G17)
**Scale/Scope**: non-base books up to 5 000 rows, base books as large as the catalogue (paged by line); one admin-kit primitive (editable grid); five admin routes;
one zone contribution; three palette actions; FR-001–FR-042, SC-001–SC-009

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 (below).*

| Principle | Verdict | How |
| --- | --- | --- |
| I. Modular (NN) | pass | Screens in `price_lists`' own `src/admin/`; the base-price panel enters the product editor through the existing `product.editor.pricing.after` zone; `audit_logs` (G13) and `catalog` (G14, and G15's `pageProductIdsByName` on its read port) change only their own code, and `price_lists` reaches catalogue ordering only through that port, handing it book membership as a sanctioned subquery (`priceBookMembership`, precedent `CustomFieldListFilterPort.condition`) — the catalogue owns names and their stored sort keys, `price_lists` owns rows and its product-line table; the grid primitive lives in admin-kit with no pricing knowledge |
| II. API-first | pass | Every gap is a Zod schema change in `@endora-commerce/contracts` before the route; additive; `minor` changesets |
| III. TDD (NN) | pass | Each phase writes failing tests first (component, axe, contract); every FR and SC traced in `tasks.md`; SC-001, SC-002 and the wall-clock half of SC-004 are recorded manual measurements (stated, not hidden) |
| IV. YAGNI | pass | No npm dependency; one Postgres extension (`pg_trgm`), already installed in the platform, justified in Complexity Tracking; no virtualisation; no column mapping; no saved views (OQ-2 = B, issue #408) |
| V/VI/VIII | pass | strict TS; naming check; English in code, pl + en strings |
| VII. Storefront | pass | the list-price pair renders in existing server components (`BaseSalePriceBlock`/`PriceTag`), SSR intact |
| IX. UI reuse | pass | admin-kit pickers (product 145, organization, customer, customer group, category, sales channel), modal dialog, responsive table, pagination, sticky form actions, unsaved-changes prompt; one new shared primitive (editable grid) justified in `research.md` R4 |
| X. Queues | n/a | no async work |
| XI. Tenancy (NN) | pass | visibility is the server's; writability via G11; organization pickers scope-filtered; SC-006 tested by equality with an unknown id |
| XII. Channels (NN) | pass | channel set through P1's bridge; the UI offers only channels offering the currency (`targets/sales-channels?currency=`) |
| XIII. Command Bus (NN) | pass | every write is a P1 endpoint already on the bus; G11–G19 add no write path |
| XIV, XV | pass | no host columns; overlays unaffected |
| XVI. Palette | pass | `open-price-lists`, `new-price-book`, `open-price-explainer` in the manifest; `check:action-route-permissions`, `registered-bundles-shape` |
| XVII. Toggleable (NN) | pass | contributions (routes, nav, palette, zone) dropped when off; off-state tests extended |

**Post-design re-check**: pass. The owner's rulings of 2026-10-22 (OQ-1 = B, OQ-2 = B) and the
by-line paging review are applied.

## Project Structure

### Documentation

```text
specs/161-price-book-editor/
├── spec.md, plan.md, research.md, data-model.md, quickstart.md, tasks.md
├── contracts/ui-api-mapping.md       # every FR → endpoint or gap
├── contracts/backend-gaps.md         # G11–G19
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
├── src/backend/routes.price-books.ts, services/price-book-reads.ts (lines read), services/price-book-service.ts
│   (G18), services/buyer-line-price-service.ts, services/matrix-decimal.ts   # G11, G12, G15–G18
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
packages/modules/catalog/src/backend/services/catalog-product-read.service.ts  # G15 pageProductIdsByName
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
| 2 | Backend gaps G11–G18 (done; G15 over budget) | FR-005, FR-006, FR-013, FR-015, FR-019, FR-023, FR-026, FR-027, FR-030; G13 for the history link |
| 2b | G15 redesign (stored catalogue keys, product-line table, membership seam) and G19 | FR-006, FR-015, FR-026; checkpoint: every bench case ≤ 150 ms p95 |
| 3 | Foundations: API client, editable-grid primitive, cell parser, CSV codec, routes skeleton, nav and palette restored, i18n keys | FR-007, FR-011, FR-029, FR-031, FR-034, FR-035 |
| 4 | US1 — list and header | FR-001–FR-005 |
| 5 | US2 — grid | FR-006–FR-017, FR-037 |
| 6 | US3 — base-price panel (own *Save prices*) and books on the product | FR-019–FR-021 |
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

## Owner rulings applied (2026-10-22)

- **OQ-1 = (B)**: the base-price panel has its own *Save prices* with an unsaved-changes prompt
  (FR-020 amended). One Save for the whole product edit page is the future direction — issue #407.
- **OQ-2 = (B)**: the book list keeps its filters in the URL (FR-034 amended); saved views on the
  price-book list are issue #408.
- **Review — G15 by line** (coordinator): the grid pages by product line through a new lines read
  whose per-page cost does not grow with the book; G18 removes the whole-book read from batch
  validation and lifts the 5 000-row cap from base books (`research.md` R2).

No FR is unmapped (`contracts/ui-api-mapping.md`).

## Measurements (filled at Phase 12)

| What | Target | Measured | Machine |
| --- | --- | --- | --- |
| SC-002 paste 50 × 3 and save | < 2 min | **needs a person** (a timed hand walkthrough in a browser); the scripted parts — a 150-cell paste applied as one group and saved — are covered by `price-book-grid.edit.test.tsx` and the 5 000-cell figure below | — |
| SC-004 keystroke-to-paint, 200 × 6 | < 100 ms | **needs a person** (browser paint timing); render counts asserted instead: typing re-renders no cell, a commit two (`admin/test/kit/editable-grid.perf.test.tsx`) | — |
| SC-004 focus move, 200 × 6 | < 100 ms | **needs a person** (browser paint timing); a move re-renders exactly the two cells it touches, a PageDown too (same test) | — |
| FR-036 5 000-row save | stays interactive, progress shown | client: a 5 000-cell paste applied and the batch built in 73–93 ms (`book-edit-state.perf.test.ts`; was 4 269 ms before `editCells`); server: preview 205 ms, commit 1 024 ms (`backend/test/perf/price_lists/editor-import-save.bench.ts`, 2026-10-23); progress is the save's live status | local `postgres-test`, 16 threads |
| SC-009 1 000-row preview | < 10 s | 83 ms from the file's text to the preview's answer (codec + `PUT …/rows?dryRun=true`; same bench) | local `postgres-test`, 16 threads |
| G15 100-line page, 50 000-line book — prototype, DB side (R14) | ≤ 150 ms p95 | first 35.8, middle 31.7, last 36.2; search 54.9–82.3 ms | local `postgres-test`, 16 cores |
| G15 end to end — bench T029, steady (VACUUM ANALYZE) | ≤ 150 ms p95, every case | 26 of 26 in each of 3 runs (largest 119.0 ms); after the page-rows lookup change, 1 run, 26 of 26 (largest 125.3 ms) | local `postgres-test`, 16 threads |
| SC-001 configure E1–E3 within 10 minutes | 10 min | **needs a person**: the walkthrough of `quickstart.md` §3 by an operator who has not seen the editor; the configuration reaching the vectors is T064 | — |
| G15 end to end — bench T029, fresh (no VACUUM) | reported | after the page-rows lookup change, 2 runs: over in 3 case-runs, all 50 003-line searches — broad first 151.9, all-matching last 152.6, two-character first 150.6 ms; the search count and the dense walk read every product's heap tuple until autovacuum's first pass. **Accepted by the owner on 2026-10-22**: the budget is measured in the steady state; the fresh-state overrun (~150–153 ms p95 on the broadest searches before the first autovacuum) is not a defect of this feature; follow-up issue #409 | same |

## Complexity Tracking

| Addition | Why needed | Simpler alternative rejected because |
| --- | --- | --- |
| Postgres extension `pg_trgm` required by `catalog` (`create extension if not exists`) | substring search over 50 000 names and SKUs within the budget (FR-015, `research.md` R14): a selective search page in 3 ms through the trigram index | it is **already** created by `product_feeds`' migration (`packages/modules/product_feeds/src/migrations/20260802T110630_product_feeds_taxonomies.ts`) wherever that module is installed — the demo and the test templates included — and it is a *trusted* extension since PostgreSQL 13, so a database owner without superuser can create it; `catalog` declares it itself because it cannot depend on `product_feeds` being installed. A prefix-only btree would not find `0123` in `SKU-0123-B` or a word inside a name |
| Generated stored columns and IMMUTABLE functions in `catalog` | the key must be stored to be sorted without evaluating it (`research.md` R14: the expression-index variant took 1 467 ms on the last page) and maintained on every write path | an application-maintained key table needs every catalogue write path (admin, import, bulk, PIM, migrations) to remember it; Postgres maintains generated columns on all of them |
| `price_list_product_lines` in `price_lists` | membership of 50 000 lines from 50 000 keys instead of 125 003 rows with duplicates (8–17 ms instead of 40–110 ms) | hashing the matrix rows directly leaves no margin on search pages |

No new npm dependency.
