# Pricing — how a product price is stored, resolved and read

**Open this before changing how a price is stored, resolved, displayed, sorted, indexed or
cached** — anything in `packages/modules/price_lists/`, any consumer of the pricing service
(catalog listings, the product page, search, comparisons, carts, orders, quote requests, product
feeds, promotions, the storefront), or a spec that touches price books. One of the bodies
`AGENTS.md` routes to; it is the single home for these working rules, so never restate them in
`AGENTS.md` or in a tool-specific pointer file.

Pricing is the subject that keeps coming back: one deep analysis (2026-10-21, issue #378 widened
by the product owner) mapped the model, every read path, seven peer platforms and the target
scenarios, and its result — ratified as **D-287** — is what the code now implements: price books,
three-tier resolution, a configurable precedence, variant prices and a precomputed price surface
(feature 160, `specs/160-pricing-model-v2/`, and its editor, feature 161,
`specs/161-price-book-editor/`). The standing set under `specs/pricing/` carries the analysis and
the current state. Start there instead of re-deriving the model from code.

## The standing pricing set

| Document | Answers |
| --- | --- |
| `specs/pricing/current-model.md` | What the code does now: the price-book tables, the resolution algorithm with its tiers, precedence and tie-breaks, the price surface, caching, the consumers, and what is still open |
| `specs/pricing/read-paths-and-performance.md` | Every place a price is read, its entry point and query shape, caching, the measured cost and budgets, and the pre-160 audit the model was measured against |
| `specs/pricing/peer-platforms.md` | How Medusa.js, Shopware, commercetools, Magento B2B, OroCommerce, SAP Commerce and BigCommerce model price lists, with source URLs |
| `specs/pricing/decision-record.md` | The model ratified as D-287 — data model, algorithm, precedence presets and invariants, performance plan, migration and phasing — and the product owner's rulings on it |
| `specs/pricing/worked-examples.md` | The scenarios and precedence cases as inputs → expected price → winning row: the test vectors the integration suites run |

**Which document judges what.** `current-model.md` describes the shipped code, and a fix to it is
judged against that file and the vectors of `worked-examples.md`. `decision-record.md` stays the
**target contract** for what D-287 has not shipped yet — the precedence change flow (P3), the
promotions exclusion on `price_source` (P4) and the optional search-index price — and a spec or
plan of that work is judged against it. The operator- and developer-facing description is the
`price_lists` module's own documentation (`packages/modules/price_lists/docs/`), in English and
Polish.

## Working rules while touching pricing

- **A price has one home: a row of a price book.** A product's base price is its row in the base
  book of a currency, a variant's is its variant row there (fixed, or a percentage or amount of the
  product's base), and every other price is a row of a catalogue, buyer or sale book. Do not give a
  price another home: `catalog` holds no price (`defaultPrice`, `price` and `priceOverride` are
  refused with `PRICE_SET_IN_PRICE_BOOKS`), and a consumer keeps no fallback price of its own — a
  line no tier prices is unpriced and follows the quote-only path (FR-018).
- **Do not bring back what feature 160 removed.** No rule evaluated per request to decide which
  books apply (the audience and channel set are on the header and filtered in the `where` clause),
  no per-list product roster, no consumer-side resolution chain. A book id never comes from a
  client on a pricing path.
- **A change to resolution semantics updates the set in the same merge request**:
  `current-model.md` when behaviour changes, a vector in `worked-examples.md` for the case the
  change decides (and its test under `backend/test/integration/price_lists/worked-examples/`), and
  the `price_lists` module's documentation in both locales. Refresh the *Verified against* line of
  every file you re-checked.
- **A consumer prices in batches**, through the pricing service's batched entry points
  (`packages/modules/price_lists/src/backend/services/pricing-service.interface.ts`):
  `resolveListingPrices` (quantity 1, a listing; variant products are ranged over their variants),
  `resolveListingPriceDetails` (the same plus the base / sale / tier split, the display mode and the
  list price, for a surface that renders them) and `resolveLinePrices` (many lines, each at its own
  quantity and **variant**). Never call `resolveEngine` / `resolveLinePrice` once per product or
  line. Pass the line's `variantId` wherever a variant is known. The per-product paths that remain
  are listed in `read-paths-and-performance.md` as defects, not as precedent.
- **A buyer is named, not resolved by the caller**: pass the organization and, for a signed-in
  customer, `customerAccountId`; the engine applies the one effective-customer-group rule
  (`current-model.md` §1.2). Do not compute a group in a consumer.
- **Read a price only through `price_lists`' ports**, resolved per use with `lazyPort`
  (`pricingService` slices, `buyerLinePricePort`, `priceListReadPort`, `productDisplayModePort`).
  Never query `price_lists`' tables from another module. **Write** a price from another module only
  through `priceBookWritePort` (base prices; it replaced `priceListAdminPort`); rows of other books
  are written through the admin API.
- **Every write is one Command Bus run through `PriceBookService`**, with one audit entry and the
  book's `version` moved; an admin write names the version it was made against (`expectedVersion`
  or `If-Match`). A book's channel set is read and written only through
  `SalesChannelMembershipService` (the `price-list` bridge, Principle XII).
- **A resolver amount is a decimal string, and it is rounded as one.** Ports and admin API shapes
  carry the four-place string `price_lists` answers with; a consumer rounds it to two places with
  `roundAmountHalfUp` and computes a gross with `grossAmountHalfUp` (`@endora-commerce/contracts`,
  `price-book-decimal.ts`), never with `Number(…).toFixed(2)`, `Math.round` or `net * (1 + rate)`:
  9.0450 is the double 9.04499…, and 29.50 × 1.23 the double 36.28499… (worked examples §10.16).
  The published money fields that stay numbers — `ProductSummary.price`, the cart's `Money`, the
  external tier ladder — hold a `numeric(14,4)` amount losslessly (at most 14 significant digits),
  so a consumer of one rounds it with the same helpers, which read a number as its shortest decimal.
  An amount **computed** from a price — a line's net or gross, a tax, a total, a correction, a
  refund, a discount, an available credit — uses `money-decimal.ts` beside it (exact sums,
  products, quotients, rounded half-up once where the rule says). **VAT has one method,
  `vatByRate`** — per rate, on the sum of the net amounts, rounded once (owner ruling of
  2026-10-24) — and every document computes it there rather than per line; a line's gross is
  informational and is the line's own rounding. A refund and a correction are cumulative over an
  order's returns and an invoice's corrections, and what an order charged is read from what it
  stored, never recomputed. `worked-examples.md` §10.17 says which document computes what. A money amount a person or an integration types takes
  `twoDecimalAmount` from `money-input.ts`: more than two places is `400 AMOUNT_PRECISION_EXCEEDED`,
  never rounded.
- **The precedence is data, read from the active version.** Consumers never encode a cell order;
  the resolver reads `price_list_precedence` through `PrecedenceStore`. A change to presets or
  invariants goes through `validatePrecedence` and keeps `precedence.test.ts` exhaustive. The write
  path is P3's: until then every write under `…/precedence` stays `409`.
- **Keep the identity tests green and meaningful**: the listing batch equals the single resolution
  (`backend/test/integration/price_lists/listing-prices-batch.test.ts`), the line batch equals one
  `resolveLinePrice` per key (`…/line-prices-batch.test.ts`), the price-sorted order equals the
  live card prices for every buyer under every preset (`…/price-surface-identity.test.ts`), every
  surface returns the same amount, currency and source (`…/pricing-surfaces-agree.test.ts`), and the
  cart read equals placement (`backend/test/integration/carts/cart-read-equals-placement.test.ts`).
  A new resolution path owes the same kind of identity test.
- **An overlay that decorates `resolveLinePrice` decorates `resolveLinePrices` too** (and the
  listing pair): the cart, the placement check, quote reference prices and the external catalogue
  API price through the batch, so wrapping the single call alone leaves them on core
  (`backend/src/apps/example/modules/example_overlay/backend.ts` is the reference).
- **The pricing cache is per process, keyed by pricing profile, invalidated after commit and
  announced to every process.** Every audited price-book write, every display-mode override and
  `pricing.*` display-mode setting (`settings.value_changed`: the engine memoises the viewer's
  display-mode tail under the generation), every status sweep that flips a book, and the catalogue
  and channel events `price_lists` subscribes to (`product.*.v1`, `category.updated.v1`,
  `attribute.updated.v1`, `sales_channels.identity_changed`, `sales_channels.lifecycle_changed`)
  bump `PricingGeneration`: the writer's layers are cleared once
  the write has committed, a bump is published on the Redis channel
  `b2b:price_lists:pricing-generation`, every process clears its own on receipt, and the writer's
  bump hands the price surface a `SurfaceChange` saying what moved, which marks only that.
  Publishing is best effort: when it is lost, the 60 s TTL bounds another
  replica's staleness, so a test or a design may rely on the bump for promptness but not for
  correctness. **A new fact that decides a price must bump the generation** — subscribe its event —
  or cached answers and the price surface will disagree with it — and should describe what it
  moved (`packages/modules/price_lists/src/backend/services/surface-change.ts`): a bump that
  describes nothing marks every profile whole, which is correct but a full rebuild per write
  (84.0 s at 202 profiles since issue #416, research R19), and `{ kind: 'none' }` is only for a fact the surface does not store
  (a display mode, a name).
- **The price surface is written only by its worker.** Price sort and price range read
  `price_profiles` / `price_profile_prices` through `ListingPriceOrderPort`; no request and no admin
  write builds a surface (owner decision 2026-10-22): a write marks what it can move — (profile,
  product) pairs, or whole profiles — and the `price_lists.surface` queue refreshes the marked
  products in place or rebuilds a whole-marked profile (owner ruling 2026-10-23,
  `specs/160-pricing-model-v2/research.md` R17). Live paths — the cart, checkout, the product page,
  quote requests, order intake — never read the surface. Every surface row is computed by the same
  batched resolver the cards use; a change to the resolver is a change to the surface.
- **Applicability is evaluated at request time.** A book applies while `active` or `scheduled`
  within `starts_at ≤ now < ends_at`; the five-minute status sweep only moves the admin's status.
  Do not make a price wait for the sweep.
- **Removed mechanisms stay removed from the documentation.**
  `backend/test/unit/docs/pricing-removed-mechanisms.test.ts` (SC-010) fails when a page in either
  locale describes the Application rule, the product default price or the variant price override
  outside a history or migration section.
