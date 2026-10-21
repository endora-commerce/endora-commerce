# Research — Pricing model v2 (feature 160, P1 of D-287)

Phase 0 of `/speckit.plan`. The pricing *semantics* are not researched here: they are D-287
(`specs/pricing/decision-record.md`, ratified 2026-10-21) and the vectors of
`specs/pricing/worked-examples.md` §10, and this file cites them rather than re-deciding them. What is
decided here is **how** P1 builds that model in this repository: what it keeps from P0, how the
migration order and module boundaries constrain the conversion, how the price surface is shaped and
measured, how the API is versioned, and how P1 and P2 ship together.

Every item is *Decision → Rationale → Alternatives rejected*. Verified against `origin/master` at
`c9570491c` (P0 merged), 2026-10-21.

---

## R1. What P1 keeps, re-points and replaces from P0

P0 (`fix/pricing-read-path-hardening`, merged in #394) hardened the read paths of the **current**
model. P1 changes the model behind the same seams.

| P0 artefact | P1 | How |
| --- | --- | --- |
| `PricingGeneration` (`PL/backend/services/pricing-generation.ts`, channel `b2b:price_lists:pricing-generation`, after-commit bump, every process subscribes on boot) | **Keep** | Every P1 write (book, row, channel set, audience member, base book, precedence) bumps through it exactly as P0's audited writes do. P1 adds bumps for the events P0 left open: catalogue product/category/attribute changes and a channel's currency change (R9). The surface refresh worker bumps when it publishes a refreshed profile (R7). |
| Sweeper invalidation (`price-list-status-worker.ts`, `pricingCache` = `PricingGeneration`) | **Keep, demote** | FR-047 makes dates authoritative at read time (`startsAt ≤ now < endsAt` in the applicable-book query), so the sweeper no longer decides what is charged; it still flips `status` for the admin and bumps, so the LRU never serves a book past its end for longer than one sweep. |
| `PricingCache` (in-process LRU, 60 s) | **Keep, re-key** | The key's `organizationId`/`customerGroupId` pair becomes the **pricing profile id** (R6): buyers whose applicable books are identical share entries. P0 measured 5.3 % hit rate at 50 organisations because the key carried the organisation. |
| `resolveListingPrices`, `resolveListingPriceDetails`, `resolveLinePrices` (`pricing-service.interface.ts`) | **Keep as the only sanctioned entry points; replace the body** | Same names, same batching contract (statements independent of the number of products/lines). Their inputs gain `variantId` per line/product where missing; their results gain the price source, compare-at and variant range (contracts/pricing-resolution-v2.md). The bodies call the new three-tier resolver. |
| `resolveEngine`, `resolveLinePrice` (single) | **Keep as thin wrappers over the batch** | They stay on `PricingServiceContract` because overlays decorate them (`specs/conventions/pricing.md`, *An overlay that decorates…*). Their results change shape (R11). |
| `effectiveCustomerGroupId` (`customer-group-rule.ts`) | **Keep verbatim** | It is D-287's "one effective group" (§5.2) already; P1 calls it from profile resolution. |
| `CartLinePricing.orderablePrices` (carts, the one chain since #168) | **Keep, re-point** | Its four steps stay (agreed price at the agreed quantity → price list → own price → unpriced). Step 3 ("the product's own price", `defaultPrice`) **is removed** (FR-018): a line no tier prices is unpriced. It passes `variantId` (already on the line) and stores the returned price source (FR-030). |
| `BuyerLinePriceService` (quote reference prices, admin probe) | **Keep, re-point** | Already on `resolveLinePrices`. The admin probe's explanation grows to FR-020's (tier, cell, book, row, reference, precedence version). |
| Identity tests `listing-prices-batch`, `line-prices-batch`, `unit-price-ordering`, `cart-read-equals-placement`, `customer-own-group-every-path` | **Keep the obligation, rewrite the fixtures** | Each asserts *batch == single* or *sort == card* or *cart read == placement*; the obligation is model-independent. Their fixtures are written against the old model (rules, brackets), so they are rebuilt on the §10 fixture. `unit-price-ordering` becomes *surface == live* (R7). |
| P0's N+1 still open: admin order preview, external order intake probe, product feed generation | **Fix in P1** | FR-028 re-points every consumer to the batch; these three are the ones P0 left, and they are rewritten anyway because their result shapes change. |

**Rationale.** P0 built exactly the seams D-287 §6 asks for (after-commit, cross-replica, batched,
one group rule, one cart chain). Re-implementing any of them would create a second copy of a rule —
the failure `current-model.md` §1.4 records twelve times.

**Rejected.** Replacing the pricing service with a new port name (`priceBookService`): every
consumer and the overlay seam would change for no semantic gain; the published names are what
consumers and overlays already depend on.

## R2. Migration order constrains the conversion — and one removal moves to the next release

**Finding.** Migrations execute *module by module in a topological order of the manifest
`dependencies` graph* (`specs/conventions/module-migrations.md` item 3). `price_lists` depends on
`catalog`, so **every pending `catalog` migration runs before every pending `price_lists`
migration** in one `migrate` run, whatever the timestamps. A `price_lists` migration may *read* a
`catalog` table (R1 of `check:module-boundary`: the dependency is declared) but may not write or
alter one (R2).

**Consequence.** The spec wants the conversion to read `product_variants.price_override` and
`products.attribute_values.defaultPrice` and *then* `catalog` to drop them (FR-042: "removed by the
catalogue module, after the conversion has read it"). In one release both migrations are pending in
the same run, and `catalog`'s would run first: the conversion would find nothing.

**Decision.** P1 does everything else of FR-042 in the release, and moves the **physical** removal of
the two catalogue fields to the **first `catalog` migration of the following release**:

- In P1, `catalog` stops being a price owner in code: the `priceOverride` entity property, the DTO
  fields, the admin variant field and the `defaultPrice` virtual key and editor field are removed;
  create, update and import refuse `defaultPrice` (FR-043) and `priceOverride`; nothing reads either.
- The `price_lists` conversion migration reads both (R1-legal) in the same run.
- A `catalog` migration in the next release (tracked as a P3 task, `plan.md` *Follow-ups*) drops
  `product_variants.price_override` and strips `defaultPrice`/`price` from `products.attribute_values`.

This is a **deviation from SC-006's wording** ("nothing of the old model listed in FR-042 remains")
for two inert storage fields for one release; every behaviour SC-006 protects holds. It is recorded
in `plan.md` *Deviations*.

**Rejected.**
- *A cycle* (`catalog` depending on `price_lists`) to invert the order: a cycle is a diagnostic, not
  an ordering tool, and it would make `catalog` — non-deactivatable — depend on a switchable module.
- *`catalog` writes the converted rows into `price_lists`' tables*: R2 forbids a migration owned by
  one module writing another's table.
- *A `catalog`-owned holding table* read by `price_lists` and dropped later: the drop has the same
  ordering problem, and the table is a third temporary home for a price.
- *Converting at boot* (`installHook`): the column would already be gone in the same run.
- *Skipping the variant conversion*: FR-041 requires it; it is cheap where the column is still there.

## R3. Storage — evolve `price_lists`' tables, add three, drop four

**Decision.** As `data-model.md`. In brief: `price_lists` gains `currency_code` (from the legacy
`currency`), `audience_kind`, and uses the legacy `priority`; loses `application_rule`, `code`,
`is_default` and `modified_at`'s tie-break role. `price_list_matrix_entries` keeps its name, gains
`variant_id`, `percent` (signed) and `amount` adjustments, loses `organization_id`/`currency_code`.
New: `sales_channel_price_lists` (a registered channel bridge, below), `price_list_audience_members`,
`price_list_precedence`, plus the surface pair `price_profiles` / `price_profile_prices`. Dropped: `price_list_products`,
`price_list_price_brackets`, `price_list_items`, `price_list_assignments`.

**Rationale.** D-287 §5.1 keeps the matrix table ("table kept, name kept"); every drop is the
module's own table, ordered within the module by timestamp (§R2 does not bite).

**Audience members: two nullable FK columns, not one polymorphic id.** `organization_id` → 
`organizations`, `customer_group_id` → `customer_groups`, a CHECK that exactly one is set, and a
service rule that all members of a book are of the book's kind. Both owners are already in the
manifest `dependencies` (`PL/manifest.ts:81-88`), so `fk-dependency-drift` is unaffected, and
`on delete cascade` gives the spec's edge case (a permanently deleted member leaves the set) for
free. D-287 §5.1 sketched one polymorphic column "checked in the service"; real FKs are strictly
better and change no semantics.

**Channel set: a registered Principle XII bridge, not a private join table.** D-287 §5.1 sketched
`price_list_sales_channels`. Principle XII requires channel memberships to be read and written only
through the kernel's `SalesChannelMembershipService`, over bridges their owning module registers in
`salesChannelBridgeRegistry` (`packages/platform/src/kernel/sales-channels/channel-bridge-registry.ts`).
So the table is `sales_channel_price_lists`, entity type `price-list` is added to
`ChannelMemberEntityTypeSchema`, and `price_lists` calls the membership service — which also gives the
kernel's channel-delete cleanup for free. The hot path asks `listEntityIdsForChannel('price-list',
channelId)` once per (channel, generation) and filters its own tables by those ids. A private table
queried directly was rejected: it is the fail-open, bypassed-accessor pattern XII was written against.

**Rejected.** Renaming `price_list_matrix_entries` to `price_book_rows`: churn in every query,
audit reference and test for a name.

## R4. One-shot conversion and removal (FR-041, FR-042, N13)

**Decision.** One `price_lists` migration, scaffolded with `pnpm --filter backend run
migration:new`, in this order inside one transaction:

1. create the new tables and columns;
2. create one system base book per currency that has a Default-list bracket or is the platform
   default currency (the default channel's `default_currency`); the platform default currency's book
   keeps the id `00000000-0000-4000-8000-00000000d51b`;
3. copy every Default-list bracket into a product row of its currency's base book;
4. for every product with no Default bracket and a numeric `attribute_values.defaultPrice`
   (`price` as fallback), insert a base row in the default currency;
5. for every variant with a non-null `price_override`, insert a fixed variant row in the default
   currency's base book;
6. delete every non-system price list (cascades rows, roster, brackets) and the Default list's own
   matrix entries (N13: only brackets and the two catalogue fields are converted);
7. drop the old tables and columns of `price_lists`.

A dry-run report is **not** built (decision-record §8.1). The step is one-way for data: `down()`
recreates the old tables' shape empty and drops the new ones, so a rollback leaves a reseedable
database rather than a half-converted one.

**Rationale.** No production deployment (§8); the demo is reseeded (R13). Steps 3–5 are the only
data a developer would miss.

**Rejected.** Converting Application rules into books: §8.1 rejects it (N13).

## R5. Resolver — three tiers over a rank table, batched

**Decision.** A pure function `resolvePrices(candidates, buyerProfile, precedence)` over rows already
loaded for the page (one statement for the applicable books, one for their rows filtered by the
page's products/variants/categories/attributes, the catalogue facts through the existing catalogue
ports), implementing decision-record §5.2 verbatim, with the **rank table** built once per
`(precedence version)` from `price_list_precedence` (§5.6). Base, catalogue, buyer and sale tiers
are four passes over the same candidate array, so the batch stays at a constant number of
statements (the P0 budget). Percentages and adjustments use integer arithmetic in ten-thousandths
(the existing `matrix-decimal.ts`).

**Rationale.** It replaces three mechanisms (rule evaluator, `pickPriorityChain`, in-list matrix
ranking) with one comparator whose first component is configurable — the property §5.6's tests rely
on (one populated cell with the smallest rank wins).

**Rejected.** Keeping `pickPriorityChain` for list choice and a matrix ranking inside the list: that
is the two-layer model D-287 removes.

## R6. Pricing profile — the shared key of cache and surface

**Decision.** For a request `(channel, currency, organization chain, effective group)` the
**applicable buyer books** are the active regular and sale books on that channel and currency whose
audience set contains a chain member or the group. The **profile** is the sorted tuple of
`(book id, audience kind, chain depth)` plus `(channel, currency, precedence version)`; its id is a
stable hash. Guests and buyers with no applicable buyer book share the **everyone profile** of the
channel and currency. Profile resolution costs one indexed statement
(`price_list_audience_members (organization_id | customer_group_id)` ⋈ header, filtered by the
channel's book ids from the membership service), cached
per `(organization, group, channel, currency)` under the pricing generation.

**Rationale.** Two buyers with the same profile get the same price for every product by
construction (resolution reads nothing else about the buyer), so the LRU and the surface can key on
it. This is OroCommerce's Combined Price List sharing (`specs/pricing/peer-platforms.md` §2.4).

## R7. Price surface for sort and range (FR-026, FR-027, SC-005)

**Decision.**

- **Tables**: `price_profiles (id, channel_id, currency_code, precedence_version, key_hash,
  book_vector jsonb, built_at, state)` and `price_profile_prices (profile_id, product_id, amount,
  max_amount, compare_at, source_tier)`, PK `(profile_id, product_id)`, covering index
  `(profile_id, amount, product_id)`.
- **Density**: the everyone profile of each (channel, currency) holds every product it prices; a
  buyer profile holds **only** the products whose quantity-1 answer differs from the everyone
  profile's (sparse).
- **Sort/range**: a buyer page is a **two-stream merge** — the buyer profile's rows, then the
  everyone profile's rows excluding products the first stream holds — built with
  `unit-price-ordering.ts`' existing shapes (scalar `limit 1` exclusion, leading-stream watermark,
  keyset on `(amount, product_id)`), which measured 0.69 ms per exclusion probe and 2.88 ms for a
  shadowed stream (`unit-price-ordering.ts:13-41`). The candidate-vector machinery
  (`price-list-candidate-vector.ts`, 2^k category enumeration, matrix streams) is deleted.
- **Maintenance**: a BullMQ queue `price_lists.surface` with a worker attached through `ctx.worker`
  (Principle X; the `crm` value-recalculation worker is the pattern). Jobs are coalesced per
  `(profile)` or `(product set)`: a book/row/membership/channel-set write enqueues the affected
  profiles; a base-price write enqueues the everyone profiles of its currency; catalogue events
  (R9) enqueue the affected products in every profile; a precedence version enqueues a full rebuild
  (P3 uses it). Each refresh writes in one transaction and bumps `PricingGeneration`.
- **Profile miss**: a buyer whose profile has not been built (a new organization, a membership just
  changed) gets the profile built **synchronously for the requested restriction** (the category or
  search id set the catalogue passes, as today's `restrictToProductIds`) and the full build enqueued.
  The answer is still exact; only the first page after a change pays the build.
- **Live paths never read the surface** (FR-027): cart, checkout, PDP, quotes, order intake resolve
  live; cards on a listing page resolve live through `resolveListingPrices`, which is why an identity
  test (surface == live, product by product, per preset) is the guard.

**How SC-005 is reached.** The sort cost no longer depends on the number of books (today one stream
per candidate list, plus a computed relation per matrix list — 41 ms at 2 000 products for one
category percentage, `matrix-resolver.bench.ts:37-45`); it is two index-ordered streams whatever the
buyer. The dominant term is the exclusion probe count, bounded by the watermark.

**How SC-005 is measured.** A new bench `backend/test/perf/price_lists/price-surface.bench.ts`
(`PERF_RUN=true`), fixture: 50 000 products in 200 categories, 2 colour values, 1 000 organizations
in 20 customer groups, 500 organizations with a book (300 product-row books of 200 products, 150
category-percentage books, 50 all-products percentage books), 20 group books, one everyone book on
the channel. Timed p95 over 50 iterations, cache off: first page of 50 ascending and descending,
for a guest, a group-only buyer, and one buyer of each organization-book kind; plus a price-range
page; plus storage (rows, index size) of `price_profile_prices`. Budget **150 ms p95** (SC-005),
asserted. A second scenario times a full surface rebuild and a single-book refresh, to state the
60-second freshness bound of SC-005 against measured numbers. The bench records its results in its
header, as `resolver.bench.ts` does.

**Storage risk and its gate.** An all-products percentage book materialises a row per product for
its profile (50 books × 50 000 = 2.5 M rows in the fixture). If the bench's storage or rebuild time
exceeds what it records as acceptable, the decided mitigation is D-287 §6 point 4's *profile factor*:
a profile whose only difference from its parent is one all-products percentage stores the factor and
no rows, and its stream is the parent's scaled. It is designed now (`data-model.md`, nullable
`price_profiles.uniform_percent`) and implemented only if the bench requires it — a task with a
measured trigger, not a speculative branch.

**Rejected.**
- *Keep the per-list stream merge on the new tables*: still one stream per book and a computed
  relation per percentage book; the 41 ms at 2 000 products is the curve SC-005 exists to break.
- *Meilisearch price fields per profile*: Oro does this; here it would multiply the index by the
  number of profiles, and the search module routes price sorts to Postgres already
  (`CAT/backend/routes.public.ts:256-275`). The everyone-price field stays an optional P3 item.
- *Dense per-profile rows*: 1 000 × 50 000 = 50 M rows for no gain over the sparse rule.

## R8. Variants (FR-012, FR-016, FR-017, FR-024, FR-031)

**Decision.** Rows gain `variant_id` (FK `product_variants`, `on delete cascade`; `product_id` set to
the parent for the page prefetch). Effective attributes are the product's values overlaid by the
variant's `variantAttributeValues`, read through `catalog`'s product read port, which already exposes
variants (`catalog-product-read.service.ts`). A listing resolves every variant of the page's variant
products in the same pass and returns min/max; the surface stores both. Cart and order lines already
carry `variant_id`; the cache key already carries it.

**Rejected.** Variant price modifiers stored in `catalog` (#377's wording): D-287 §5.8 V-e.

## R9. Catalogue facts and their invalidation

**Decision.** `price_lists` subscribes (`ctx.subscribe`) to `product.created.v1`,
`product.updated.v1`, `product.archived.v1`, `product.deleted.v1`, `category.updated.v1` and
`attribute.updated.v1` (the catalogue's published events), and on each: bumps `PricingGeneration`
(closing P0's open item "catalog writes do not invalidate") and enqueues a surface refresh for the
products concerned. Whether a category *assignment* change emits `product.updated.v1` or only a
command is **verified as the first task of the surface story**; if no event carries it, `catalog`
emits one (an additive event in `catalog`'s contract) — not a periodic reconcile, which would make
SC-005's freshness bound a timer. A channel's currency set change is a kernel write; P1 bumps from
the sales-channel write path through the platform's existing lifecycle pub/sub if it carries channel
updates, else adds an event (task 1 of the channel story verifies which).

## R10. Precedence configuration (FR-021–FR-023)

**Decision.** `price_list_precedence` (one row per version) seeded by the conversion migration with
version 1 = HY, `category_before_attribute = true`, `depth_mode = within_cell`. A pure
`validatePrecedence` (D-287 §5.6 I1–I5) and the four preset constants ship in P1 because the
resolver and its exhaustive tests need them; the write path is **absent** (FR-023: a change is
refused) until P3. The resolver reads the active version through a per-generation memo.

**Rejected.** A manifest setting: §5.6 rejects it (`hidden` does not stop a generic write).

## R11. Contracts and API versioning (FR-037, Principle II)

**Decision.**
- **Admin HTTP**: a new resource `/api/v1/admin/price-books/…` (contracts/admin-price-books-api.md).
  The old `/api/v1/admin/price-lists-engine/…`, `/api/v1/admin/pricing/rule-targets/…` and
  `/api/v1/admin/products/:id/resolved-price` are **removed in the same release**. Their only client
  is this repository's admin, which P2 rewrites; no other module or app calls them (grep of
  `packages`, `admin`, `storefront`, `backend/src`, 2026-10-21). The display-mode routes
  (`/api/v1/admin/pricing/display-mode-overrides…`) are unchanged.
- **Storefront HTTP**: `GET /api/v1/storefront/products/:id/resolved-price` keeps its path; its
  response gains `variantId` input and `compareAt`/`source` fields — additive.
- **Packages**: `@endora-commerce/contracts` drops the Application-rule schemas,
  `evaluateApplicationRule`, the bracket and matrix-entry v1 shapes, and changes
  `PricingEngineResult`/`ListingPrice`/`LinePriceResult` — **`minor` changesets** (the breaking level
  in 0.x, D-225, `specs/conventions/release-intent.md`) on `@endora-commerce/contracts`,
  `@endora-commerce/mod-price-lists`, `mod-catalog`, `mod-carts`, `mod-orders`, `mod-organizations`,
  `mod-product-feeds`, `mod-search`, `mod-comparisons`, `mod-quote-requests`, each body naming the
  old call and the new one.

**Rejected.** `/api/v2/admin/price-lists`: the platform has no `v2` prefix anywhere, and a new
resource name states the new concept (a book is not the old list).

## R12. Release coupling with P2 (Q-A = C)

**Decision.** `feat/160-pricing-model-v2` is the **release branch** for P1 and P2. P1's stories
merge into it; P2 (`/speckit.specify` 161 or as numbered then) branches from it and merges back; the
docs phase (FR-048) runs last on it; **one** pull request goes to `master` when P2's acceptance
passes. `master` never holds the new API without the new editor or the old editor without its API.
The branch is rebased on `origin/master` at each story boundary to keep the drift small.

P1 deletes the old admin screens' code (they cannot work against the removed API) and leaves for P2
the complete admin API, the contracts, the i18n namespace, the permission codes and the palette
action stubs listed in `plan.md` *What P1 leaves ready for P2*.

**Rejected.** Merging P1 to `master` behind a flag: a flag would have to keep the old API and
screens alive, which is the compatibility phase D-287 §8 removes.

## R13. Demo reseed (FR-044, N12)

**Decision.** The demo composition stops calling `DefaultPriceListMigrator`
(`packages/demo-composition/src/composition.ts:976-986`) and the catalogue demo stops writing
`defaultPrice` (`CAT/backend/demo/seed.ts:184`, `rows.ts:194`). Base prices are written by a
`price_lists` demo step through `price_lists`' published install surface (the owner seeds its own
rows, `module-migrations.md` item 4a). E1–E3 need: the existing *Screws* category
(`CAT/backend/demo/rows.ts:61`), a `color` attribute flagged `isPriceRule` with a red value (the
catalogue demo already generates colour values, `rows.ts:169`; the flag is set by `catalog`'s demo
step), a *VIP* customer group with *Acme B2B (demo)* in it (each by its owner's demo step), a product
*Screws 0200* priced 100 PLN and the books of `worked-examples.md` §10.2–§10.4. A demo test prices
the E vectors after a reset (SC-007).

## R14. Documentation rebuild (FR-048, SC-010)

**Decision.** The last phase of the release branch, after P2: rewrite
`packages/modules/price_lists/docs/price_lists.md` (user + developer sections), regenerate the
module reference (`composer:generate` renders `docs/docs/module-reference/price-lists.md` from the
manifest), and rewrite the pricing passages of the pages that describe how a price is obtained
(`plan.md` *Phase 9*), in English and Polish through the manual translation workflow
(`docs/docs/contributing/documentation-i18n.md`), gated by `check:docs-translations` and a grep that
returns only history notes for *Application rule*, *default price* and *price override* (SC-010).

## R15. No new dependency

Postgres, Redis pub/sub (`PricingGeneration`), BullMQ, MikroORM, Zod: all in the stack. The
exhaustive precedence tests enumerate the configuration space (924 × 2 × 2) without a
property-testing library.
