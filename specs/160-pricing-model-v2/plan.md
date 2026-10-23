# Implementation Plan: Pricing model v2 — price books, three-tier resolution, variant prices

**Branch**: `feat/160-pricing-model-v2` (the release branch for P1 and P2, `research.md` R12) | **Date**: 2026-10-21 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/160-pricing-model-v2/spec.md` (P1 of D-287)

## Summary

Replace the Application rule, the per-product roster and brackets and the in-list matrix ranking with
**price books** — a header fixing one currency, a channel set (a registered Principle XII bridge) and
an audience set of one kind; rows pricing a variant, product, category ∩ attribute value, category,
attribute value or the whole catalogue as a fixed amount, a signed percentage or a signed amount
adjustment. Every price resolves through **one batched three-tier resolver** (base → catalogue →
buyer, then sale when lower) whose buyer-tier order is a **rank table** read from a versioned
precedence configuration seeded with **HY**. Variants are priced in the same books. Price sort and
range move to a **materialised price surface** keyed by pricing profile (buyers sharing the same
applicable books share it), read as a two-stream merge. A one-shot migration converts base prices and
drops the old model; every consumer is re-pointed to the batched entry points P0 established; the
admin API moves to `/api/v1/admin/price-books/…` with the old endpoints removed. The work ships in one
release with P2 (the price-book editor) and ends with the documentation rebuild.

Semantics are not restated: `specs/pricing/decision-record.md` (D-287) §5–§8 and
`specs/pricing/worked-examples.md` §10. Design decisions with rejected alternatives: `research.md`.

## Technical Context

**Language/Version**: TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM
**Primary Dependencies**: Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ (backend); React 19 +
Vite through `@endora-commerce/admin-kit` (admin, only deletions in P1); Next.js 15 App Router
(storefront) — **no new runtime dependency**
**Storage**: PostgreSQL — `price_lists` evolved; `price_list_matrix_entries` evolved; new
`sales_channel_price_lists`, `price_list_audience_members`, `price_list_precedence`, `price_profiles`,
`price_profile_prices` (all `price_lists`); `cart_items.price_source` (`carts`),
`order_items.price_source` (`orders`); four tables dropped. Redis: the existing
`b2b:price_lists:pricing-generation` channel; one BullMQ queue `price_lists.surface`.
**Testing**: Vitest — module-co-located unit tests (`packages/modules/price_lists/src/**/*.test.ts`),
backend integration and contract suites, perf benches (`PERF_RUN=true`)
**Target Platform**: Linux server (API + worker processes), browser admin, SSR storefront
**Project Type**: modular monolith web application (backend, admin, storefront, packages)
**Performance Goals**: SC-004 — listing and PDP no slower than the baselines of
`specs/pricing/read-paths-and-performance.md` §7; SC-005 — price-sorted first page ≤ 150 ms p95 at
50 000 products × 1 000 organizations, a price change visible in sort ≤ 60 s (a catalogue-wide
change ≤ 300 s at 200 profiles, owner ruling 2026-10-24)
**Constraints**: batched entry points only (`specs/conventions/pricing.md`); live resolution for cart,
checkout, PDP, quotes and order intake; constant statements per batch; channel-bridge access only
through `SalesChannelMembershipService`
**Scale/Scope**: about twelve owners touched (price_lists, contracts, catalog, carts, orders, search,
comparisons, quote_requests, product_feeds, organizations, demo-composition, storefront, the example
overlay); FR-001–FR-048; 8 user stories

## Constitution Check

*GATE: passed before Phase 0; re-checked after Phase 1 (below, "Post-design").*

| Principle | Verdict | How |
| --- | --- | --- |
| **I. Modular (NN)** | pass | `price_lists` owns books, rows, sets, precedence and the surface. `catalog` keeps products, variants, categories and attributes and is read only through its ports (`catalogProductReadPort`, `catalogCategoryReadPort`, `catalogAttributeReadPort`) and its published events. `carts` and `orders` own their new `price_source` columns. The conversion migration reads and writes only `price_lists`' own tables. `catalog` removes `price_override` and the `defaultPrice`/`price` keys — code **and** storage — in its own migration in this release; nothing converts them, so the migration order (every `catalog` migration before every `price_lists` one) poses no problem (`research.md` R2, owner ruling 2026-10-21). `organizations` loses its copy of the rule evaluator and asks `PriceListReadPort`. |
| **II. API-first** | pass | Zod schemas in `packages/contracts/src/price-books.ts` (new) and `price-lists.ts` before routes; the admin API is a **new versioned resource** `/api/v1/admin/price-books/…` and the old `/api/v1/admin/price-lists-engine/…`, `/api/v1/admin/pricing/rule-targets/…` and `/api/v1/admin/products/:id/resolved-price` are **removed in the same release** (FR-037); **`minor` changesets** (the breaking level in 0.x, D-225) on `@endora-commerce/contracts`, `mod-price-lists`, `mod-catalog`, `mod-carts`, `mod-orders`, `mod-organizations`, `mod-product-feeds`, `mod-search`, `mod-comparisons`, `mod-quote-requests`, each naming the old call and the new one (`research.md` R11). |
| **III. TDD (NN)** | pass | Failing-first: the `worked-examples.md` §10 vectors as one integration suite (SC-001), the exhaustive precedence tests (924 × 2 × 2 configurations), the four kept identity tests on rebuilt fixtures, the new surface-identity and surfaces-agree tests, the conversion test; each FR maps to a test in `tasks.md` (next command). |
| **IV. YAGNI, no new dependency** | pass | No new runtime, dev or workspace dependency. The *profile factor* mitigation is designed but built only on a measured trigger (`research.md` R7). P3's precedence write path is not built (FR-023). |
| **V. TypeScript** | pass | strict everywhere. |
| **VI. Naming (NN)** | pass | tables snake_case plural, the bridge named like its peers (`sales_channel_<entity>s`); routes kebab-case; action codes `price_list.*`; `check:naming` run. |
| **VII. SEO/performance** | pass | Storefront pages stay SSR; the PDP gets one resolution of the selected variant; SC-004/SC-005 benches. |
| **VIII. English (NN)** | pass | `check:language` run; pl + en for every new string (FR-040). |
| **IX. UI reuse** | n/a in P1 | P1 deletes the old admin screens; P2 builds the editor from admin-kit primitives and the 145 product picker. |
| **X. Queue consumers** | pass | `price_lists.surface` on BullMQ, atomic claim, idempotent jobs (a refresh recomputes from source), separable worker attached with `ctx.worker`. The request path only **enqueues**: it never builds a surface (owner decision 2026-10-22) — a stale profile serves its previous surface until the worker swaps the rebuilt one in, a never-built profile is ordered live for a bounded restriction, from the everyone surface otherwise, or in the default order when none exists (`contracts/price-surface.md` §3). Co-location: low-volume, co-located with the API by default and separable as every `ctx.worker` is. The status sweeper is unchanged (not a queue consumer, and it no longer decides prices, FR-047). |
| **XI. Tenancy (NN)** | pass | Books stay `@RuleScoped()`; every storefront and consumer read filters audience membership to `{everyone, effective group, the buyer's own organization chain}` in the `where` clause (`data-model.md` §10); no pricing path takes a book id from a client. Admin: sales-representative scope hides any organization-set book with an out-of-scope member (FR-034, SC-008), tested by status code and body equality with an unknown id. |
| **XII. Channel scoping (NN)** | pass | The channel set is a **registered bridge** `sales_channel_price_lists` (entity type `price-list`), read and written only through `SalesChannelMembershipService`; the resolved request channel is mandatory; a channel not offering the currency fails closed (K3.2); cross-channel tests (K1–K3). Base books are channel-independent by D-287 — the floor, as the Default list is today. |
| **XIII. Command Bus (NN)** | pass | Every write — book, rows (a batch is one command), channel set, members, duplicate, base prices, activation — runs through `CommandBus.run` with one audit entry and before/after state; `PricingGeneration.bump()` after commit (P0's seam). The surface worker writes derived rows only (not a domain write, no audit — the footing of a search reindex). The pre-existing un-audited display-mode settings write (`price-list-service.ts:1001-1030`) is out of scope and recorded in *Follow-ups*. |
| **XIV. Extensibility** | pass | No bespoke columns on host tables beyond the two line `price_source` columns (a pricing fact, not a custom field). |
| **XV. Overlay** | pass | `pricingService` stays the decoration seam; `backend/src/apps/example/modules/example_overlay` is re-typed to the new result shapes. |
| **XVI. Palette** | pass | Palette actions *Price books*, *New price book* and *Price explainer* declared in the manifest; their routes land in P2, and both ship in one release. |
| **XVII. Toggleable (NN)** | pass | Off-state unchanged: ports gate, the worker and subscribers stop with the module (`ctx.worker`, `ctx.subscribe`), the bridge rows survive. Off-state tests extended to the new routes and the worker. |

**Post-design re-check (after Phase 1)**: unchanged — pass. Two places differ from D-287's sketch as
improvements within its intent, not violations: audience members as two real FK columns and the
channel set as a Principle XII bridge (`research.md` R3); the owner approved both (2026-10-21).

## Project Structure

### Documentation (this feature)

```text
specs/160-pricing-model-v2/
├── spec.md
├── plan.md              # this file
├── research.md          # R1–R15
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── admin-price-books-api.md
│   ├── pricing-resolution-v2.md
│   ├── price-surface.md
│   └── conversion-and-removal.md
├── checklists/requirements.md
└── tasks.md             # next: /speckit.tasks
```

### Source code (what changes, by owner)

```text
packages/contracts/src/
├── price-books.ts                      # NEW: book, row, sets, explanation, precedence schemas
├── price-lists.ts                      # rule AST, evaluator, bracket/matrix v1 removed; ListingPrice,
│                                       #   LinePriceResult, PricingEngineResult reshaped
├── sales-channels.ts                   # ChannelMemberEntityTypeSchema += 'price-list'
└── catalog.ts                          # priceOverride, defaultPrice removed from DTOs

packages/modules/price_lists/
├── src/manifest.ts                     # palette actions, error codes; dependencies unchanged
├── src/migrations/                     # the conversion migration (one), via migration:new
├── src/backend/
│   ├── entities/                       # PriceList, PriceListMatrixEntry (evolved);
│   │                                   #   PriceListAudienceMember, PriceListPrecedence,
│   │                                   #   PriceProfile, PriceProfilePrice (new);
│   │                                   #   PriceListProduct, PriceListPriceBracket deleted
│   ├── services/
│   │   ├── book-resolver.ts            # new: pure three-tier resolver over the rank table
│   │   ├── precedence.ts               # new: presets, validatePrecedence, rank table
│   │   ├── pricing-profile.ts          # new: profile resolution
│   │   ├── pricing-service.ts          # entry points kept, bodies replaced
│   │   ├── price-book-service.ts       # new: write service through the Command Bus
│   │   ├── unit-price-ordering.ts      # rewritten: two-stream merge over the surface
│   │   ├── pricing-generation.ts       # kept (P0)
│   │   ├── customer-group-rule.ts      # kept (P0)
│   │   ├── pricing-cache.ts            # kept, re-keyed by profile
│   │   ├── buyer-line-price-service.ts # kept, explanation widened
│   │   └── application-rule-evaluator.ts, price-list-resolver.ts,
│   │       price-list-candidate-vector.ts, price-bracket-resolver.ts,
│   │       default-price-list-migration.ts, rule-org-targets.ts   # deleted
│   ├── workers/price-surface-worker.ts # new
│   ├── routes.ts                       # /api/v1/admin/price-books/…; old routes deleted
│   └── routes.storefront.ts            # resolved-price: variantId in, source/compareAt out
├── src/admin/                          # old pages, components and zones deleted (P2 rebuilds)
└── docs/price_lists.md                 # Phase 9

packages/modules/catalog/       # DTO/entity/admin/import removals; price sort on the surface;
                                #   variants passed to listing pricing; demo: isPriceRule on color
packages/modules/carts/         # orderablePrices: own-price step removed, variantId, price_source
packages/modules/orders/        # price_source copy; preview and intake on resolveLinePrices
packages/modules/search/, comparisons/, quote_requests/, product_feeds/   # re-pointed
packages/modules/organizations/ # effective price books via PriceListReadPort.listForOrganization
packages/demo-composition/      # base prices and E1–E3 books via price_lists' demo step
storefront/                     # PDP variant price; listing "from" and compare-at
backend/src/apps/example/modules/example_overlay/   # re-typed decoration
backend/test/integration/price_lists/  # worked-examples, conversion and identity suites
backend/test/perf/price_lists/price-surface.bench.ts   # SC-005
```

**Structure Decision**: the existing monorepo layout; no new module and no new package — every piece
has an owner that already exists.

## Phases

Each phase maps to user stories and is independently testable; `tasks.md` will order them
failing-test-first. All phases land on the release branch.

| Phase | Stories | Content |
| --- | --- | --- |
| **1. Contracts and schema** | all | `price-books.ts`; reshaped result types; `'price-list'` bridge type; the `price_lists` expand migration (`research.md` R4) incl. precedence v1 = HY; `carts`/`orders` `price_source` migrations; `composer:generate`, `manifests:generate` and the lockfile in the same commit |
| **2. Resolver and precedence** | US1–US4 | `book-resolver.ts`, `precedence.ts` (presets, `validatePrecedence`, rank table), `pricing-profile.ts`; the batched entry points re-implemented on them; the cache re-keyed; exhaustive precedence tests; the §10 vector suite for E, F, S, T, quantity, C∩, C, H, A, K, U |
| **3. Variants** | US5 | variant rows, effective attributes, listing min/max, `listTierStarts`; V1–V9 |
| **4. Admin API and audit** | US7 | `/api/v1/admin/price-books/…` (contract), `price-book-service.ts` through the Command Bus, representative scope, duplicate, explanation, targets; bridge writes through the membership service; old routes deleted |
| **5. Consumers** | US6 | every row of `contracts/pricing-resolution-v2.md` §5; `CartLinePricing.orderablePrices` without the own-price step and with `price_source`; the three N+1 paths P0 left open; catalogue removals (FR-043); identity tests on rebuilt fixtures; `pricing-surfaces-agree.test.ts` |
| **6. Price surface** | US6 | tables, profile registry, worker, subscriptions (`research.md` R9), two-stream ordering, the non-blocking profile-miss and stale paths, `price-surface-identity.test.ts` under AF, SF, HY and AF-N, the SC-005 bench |
| **7. Conversion, removal, demo** | US1, US8 | the `price_lists` conversion migration and the `catalog` migration dropping `product_variants.price_override` and stripping the `defaultPrice`/`price` keys; conversion test (SC-006, incl. the two catalogue fields gone and not converted); old entities, services and admin code deleted; demo reseed (R13); the module-removal residue ledger and every `backend/test/**` reference to a deleted file re-derived in the same commit (`AGENTS.md`, *The traps*) |
| **8. P2 (separate spec)** | — | the price-book editor on this API; the release gate |
| **9. Documentation (FR-048, SC-010)** | — | after P2: the rebuild below |

### What P1 keeps, re-points or replaces from P0

Full table: `research.md` R1. In short: **keeps** `PricingGeneration` (after-commit, cross-replica,
`b2b:price_lists:pricing-generation`), the sweeper bump, `effectiveCustomerGroupId`, the three batched
entry points `resolveListingPrices`, `resolveLinePrices`, `resolveListingPriceDetails` (bodies
replaced), and the identity tests `listing-prices-batch`, `line-prices-batch`,
`cart-read-equals-placement` (fixtures rebuilt); **re-points** `CartLinePricing.orderablePrices` (the
#168 chain: own-price step removed, `variantId`, `price_source`), `BuyerLinePriceService` and every
consumer P0 batched; **replaces** the cache key (profile instead of organization), the price-sort
machinery (`unit-price-ordering` becomes `price-surface-identity` over the surface) and the three N+1
paths P0 left open (admin order preview, external order intake, feed generation).

### What P1 leaves ready for P2 (the release is gated on P2)

1. The complete admin API of `contracts/admin-price-books-api.md`: the batch row upsert the grid saves
   through, the base-price endpoints for the product-editor zone, the explanation endpoint with ranked
   candidates, the target pickers, and the read-only precedence endpoint.
2. Zod schemas and TypeScript types exported from `@endora-commerce/contracts`, so the editor is typed
   against the same shapes.
3. The `price_lists` i18n namespace with the error and validation messages (pl + en); P2 adds screen
   strings.
4. Permission codes unchanged (`price_lists:read`, `price_lists:write`); palette actions declared.
5. The old admin pages, components and zones of `price_lists` deleted with their admin tests
   (`admin/test/modules/price_lists/*`), and the catalogue product editor's *Default unit price* field
   deleted, so P2 starts from an empty admin surface instead of editing screens built on the removed API.
6. `quickstart.md` and the demo books, so P2's acceptance runs on E1–E3 data.

**Verified against tests (T134, 2026-10-23)** — each item, and the test that holds it:

| Item | Status | Test |
| --- | --- | --- |
| 1. Admin API | ✅ ready | `backend/test/contract/price_lists/price-books-api.test.ts` (books), `price-book-rows-api.test.ts` (batch upsert), `base-prices-api.test.ts` (base prices), `price-books-resolve.test.ts` (explanation with ranked candidates), `price-book-targets.test.ts` (pickers), `precedence-api.test.ts` (read-only precedence), `removed-routes.test.ts`; `backend/test/integration/price_lists/price-book-duplicate.test.ts`, `price-book-tenant-scope.test.ts`, `price-book-audit.test.ts`, `currency-reference.test.ts` (T089–T099) |
| 2. Exported schemas and types | ✅ ready | `packages/contracts/test/price-books.unit.test.ts` — the T005 shape tests, and T135's barrel assertions per editor concern (runtime schemas and inferred types) |
| 3. `price_lists` i18n namespace | ✅ ready | the error codes in `price-book-rows-api.test.ts` and `precedence-api.test.ts`; EN and PL sentences by `check:error-translations` and `backend/test/unit/_i18n/registered-bundles-shape.test.ts` |
| 4. Permissions unchanged, palette actions declared | ✅ ready | `packages/modules/price_lists/src/backend/manifest-permissions.test.ts`, `backend/test/contract/price_lists/permission-gates.test.ts`, `backend/test/unit/price_lists/palette-actions.test.ts` (the actions were added by 161 with their screens, T105) |
| 5. Old admin surface and *Default unit price* deleted | ✅ ready (P2 has since built the new surface on it) | `admin/test/modules/price_lists/price-lists-zones.test.tsx`, `admin/test/modules/catalog/ProductEditor.channels-tab.test.tsx` (no linked-lists panel), and — missing until T134 — `admin/test/modules/catalog/ProductEditor.no-own-price.test.tsx` (no *Default unit price* field, no own-price strings in catalog's EN and PL bundles) |
| 6. Quickstart and demo books | ✅ ready | `backend/test/integration/price_lists/demo-scenarios.test.ts` (T107); `quickstart.md` run end to end on a fresh database (T136) |

**Release gate**: one pull request from `feat/160-pricing-model-v2` to `master`, opened only when P2's
acceptance scenarios and Phase 9 pass. **P2 is feature 161, `specs/161-price-book-editor/`, branch
`feat/161-price-book-editor`** (T137); its tip `e1758312e` is fast-forwarded into this release
branch. Until then `master` keeps the old model and the old editor
(`research.md` R12). The branch is rebased on `origin/master` at each phase boundary, and each rebase
re-runs the generators.

**P2 status (2026-10-23, `specs/161-price-book-editor/`, branch `feat/161-price-book-editor`)**:
complete through its Phase 13 hand-off. The backend gaps G11–G19 are built
(`specs/161-price-book-editor/contracts/backend-gaps.md`; G18 scoped batch validation and the
uncapped base books, G19 the list price on search), plus the per-rule `reason` on refused rows
(Checkpoint 11 ruling). The admin surfaces this feature 160 Phase 13 documentation rebuild must
cover — nothing in `docs/` was written by 161:

| Surface | Where | Permission |
| --- | --- | --- |
| Price-book list (filters in the URL) | `/price-lists` — sidebar *Price books*, palette `open-price-lists` | `price_lists:read` |
| Create flow (type → currency → channels → audience → schedule) | `/price-lists/new` — palette `new-price-book` | `price_lists:write` |
| A book: *Settings* and *Prices* (the grid, cell detail, bulk change, CSV export and import with preview) | `/price-lists/:id`, `?tab=prices&search=` | `price_lists:read` (edit: `price_lists:write` and the book's `writable`) |
| Duplicate, delete, activate, move to draft, history | the book's header | `price_lists:write` |
| Price explainer | `/price-lists/explain` (`productId`, `variantId`, `organizationId`, `bookId`) — palette `open-price-explainer` | `price_lists:read` |
| *Pricing settings*: display modes, *Show list price beside the buyer's price*, the precedence in force | `/price-lists/display-modes` (`#precedence`) — palette `open-pricing-settings`, the list header's link | `price_lists:read` (changes: `price_lists:write`) |
| Base prices and the books pricing a product | `product.editor.pricing.after` zone in the product editor's *Pricing* tab | `price_lists:read` (edit: `price_lists:write`; variants need `catalog:read`) |
| Explain a price for this organization | `organization.detail.after` zone | `price_lists:read` |
| Storefront "list price / your price" | product page, listing cards, search, typeahead (vectors D1–D6) | setting `pricing.show_list_price` |

Phase 13 (FR-048 / SC-010) now runs: the documentation rebuild covers these screens in English and
Polish.

### Performance — how SC-005 is reached and measured

- **Reached**: sort cost stops depending on the number of books. Today it is one index stream per
  candidate list plus a computed relation per matrix list (41 ms at only 2 000 products for one
  category percentage, `backend/test/perf/price_lists/matrix-resolver.bench.ts`). P1 reads **two**
  index-ordered streams per page — the buyer's profile rows (sparse: only products whose price
  differs from everyone's) and the everyone profile's rows behind a scalar `limit 1` exclusion and the
  leading-stream watermark — the shapes `unit-price-ordering.ts` already proved (0.69 ms per exclusion
  probe, 2.88 ms for a fully shadowed stream). Profile sharing bounds the number of profiles by
  distinct book vectors, not by buyers. Listing cards stay live and batched (constant statements), so
  SC-004 is the existing budgets re-run.
- **Measured**: `backend/test/perf/price_lists/price-surface.bench.ts` — 50 000 products, 200
  categories, 1 000 organizations in 20 groups, 500 with books (300 product-row, 150
  category-percentage, 50 all-products percentage), 20 group books, one everyone book; p95 over 50
  iterations of the first page ascending and descending and of a range page for a guest, a group buyer
  and each organization-book kind, asserted ≤ 150 ms; a single-book refresh to visibility asserted
  ≤ 60 s; full rebuild time and `price_profile_prices` size recorded. More than 10 M surface rows
  triggers the profile-factor task (`research.md` R7). The measured numbers go into the bench's header
  and into `specs/pricing/read-paths-and-performance.md` §7 when the phase lands.

### Phase 9 — documentation rebuild (FR-048, SC-010)

Runs last on the release branch, after P2, in English and Polish through the manual workflow
(`docs/docs/contributing/documentation-i18n.md`); gated by `check:docs-translations`,
`check:module-docs` and the SC-010 search (no page in either locale describes the Application rule,
the product *default price* or the variant price override as current behaviour).

| Page | User content | Developer content |
| --- | --- | --- |
| `packages/modules/price_lists/docs/price_lists.md` (rewrite) | base price; catalogue, buyer and sale books; channels, currency and audience on the header; how the winning price is chosen (tiers, the precedence and its HY default, priority, quantity tiers, percentages off the catalogue price, sale only when lower); duplication; the resolved-price check; E1–E3 | data model; the resolver and its rank table; the batched entry points as the only read path; cache, `PricingGeneration` and the surface; the versioned admin API; how a consumer reads a price; how the conversion ran |
| `docs/docs/module-reference/price-lists.md` | — | regenerated by `composer:generate` from the manifest — never hand-edited |
| `packages/modules/catalog/docs/catalog/attributes.md` and the catalogue page | the *Price list rules* flag; no *Default unit price*; variant prices in price books | listing pricing through the batch; price sort through the surface |
| `packages/modules/carts/docs/carts.md` | what a basket line is charged; no own-price fallback | `orderablePrices`, `price_source` |
| `packages/modules/organizations/docs/organizations.md`, `organization-hierarchy.md` | the effective price books of an organization; inheritance by chain depth | `PriceListReadPort.listForOrganization` |
| `packages/modules/quote_requests/docs/quote_requests.md` | reference prices | `BuyerLinePricePort` |
| `packages/modules/search/docs/search.md` | prices in search results | why the index carries no buyer price |
| `packages/modules/product_feeds/docs/product_feeds.md` | a feed pinned to a price book | `namedListPrices` semantics |
| the orders and quick-order pages, `docs/docs/integrations/api-access.md`, `docs/docs/architecture/tenant-scoping.md` (passages naming price lists) | rewritten where they describe a removed mechanism | — |
| `docs/docs/module-reference/*` of the other touched modules | — | regenerated |

`specs/pricing/current-model.md` is rewritten to describe the shipped model, and
`read-paths-and-performance.md` gets the new measurements, in the same merge request (the working rule
of `specs/conventions/pricing.md`).

## Test disposition

| Kept (fixture rebuilt) | Rewritten under a new name | Deleted with the code they test |
| --- | --- | --- |
| `listing-prices-batch`, `line-prices-batch`, `cart-read-equals-placement`, `customer-own-group-every-path`, `pricing-invalidation-after-commit`, `status-lifecycle`, `status-sweeper-gating`, `absent-owner-refuses`, `display-mode-chain`, `viewer-scoped-display-mode`, the carts and orders pricing suites | `unit-price-ordering` → `price-surface-identity`; `matrix-statement-budget` → `book-statement-budget`; `price-matrix-tenant-scope` → `price-book-tenant-scope`; `sale-special-price` → S vectors of `worked-examples`; `inherited-price-list` → H and A vectors; `matrix-resolver.bench` → `book-resolver.bench` | `rule-builder-normalisation`, `resolver-priority-and-tiebreak`, `price-matrix-resolution`, `price-matrix-lifecycle`, `price-matrix-surfaces`, `bracket-pricing-end-to-end`, `default-seed-and-migration`, `system-price-list-singleton` (replaced by the base-book uniqueness test), `listing-price-per-organization` (A vectors), `admin/test/modules/price_lists/*` |

Every deletion is checked against `backend/test/**` references and the module-removal residue ledger
in the same commit.

## Deviations from D-287 and the spec

Both approved by the owner (2026-10-21). The catalogue fields are removed in this release without
conversion (owner ruling, spec Clarifications), which is not a deviation but the spec's FR-041/FR-042.

| Where | Deviation | Why | Effect |
| --- | --- | --- | --- |
| D-287 §5.1 | the channel set is `sales_channel_price_lists`, a registered bridge, not `price_list_sales_channels` | Principle XII's sanctioned accessor | none on semantics |
| D-287 §5.1 | audience members are two FK columns, not one polymorphic id | real FKs, cascade on permanent deletion | none on semantics |

## Demo configuration of E1–E3 (FR-044, SC-007)

The three scenarios conflict on the one demo organization and product (E2 and E3 give *Acme B2B
(demo)* different terms for *Screws 0200*; E1 raises its catalogue price). The owner answered **(A)**
(spec Clarifications, Session 2026-10-21): the examples are alternatives. The demo step seeds every
scenario's books, E3's active and E1's and E2's as drafts; the demo test prices E3 after a reset,
then activates E1's books alone and E2's books alone in turn and prices each.

## Follow-ups (outside P1, recorded)

- P3: the precedence change flow; the optional Meilisearch everyone price; the profile factor if the
  bench has not already required it.
- P4: the promotions exclusion on `price_source`.
- The display-mode settings write moved onto the settings module's audited path (pre-existing,
  `price-list-service.ts:1001-1030`).
- Still open from P0 and untouched by P1: Next.js `pricing:*` tags never revalidated; short
  price-sorted and search pages (#235); #167 and the quote-line half of #303.

## Complexity Tracking

No Constitution Check violation and no new dependency: nothing to justify.
