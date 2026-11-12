# Pricing — the current model, as shipped

How a product price is stored and resolved **today**: the price-book model of D-287 P1 (feature 160,
`specs/160-pricing-model-v2/`), its tables, the resolution algorithm with its precedence and
tie-breaks, how sort and range are served, and what is still open. This describes the code, not a
proposal — the ratified target is `decision-record.md`, and the test vectors are
`worked-examples.md`. When the model changes, rewrite this file in the same merge request.

**Verified against** the release branch `feat/160-pricing-model-v2` on 2026-10-22, after the
conversion and removal phase (tasks T114–T133), and re-checked at `e1758312e` on 2026-10-23 for
the documentation rebuild (feature 160, Phase 13): §1.2's caching paragraph, §1.3 and §1.4; and
at `91e8c1907` on 2026-10-23 after the owner rulings of that day (targeted surface refresh, pinned
feeds): §1.2's caching and consumers paragraphs, §1.3 and §1.4 item 7; and at `e3f456957` on
2026-10-24 for the second review of release 0.108.0: §1.2's display-mode paragraph and §1.3; and
on `perf/416-surface-rebuild` (from `2716908b3`) on 2026-10-24 for the faster whole rebuild
(issue #416): §1.4 item 7; and on `fix/four-place-unit-prices` (from `ad06079a4`) on 2026-10-25 for
the four-place unit-price ruling: §1.2's consumers paragraph; and on
`fix/491-display-mode-none-withholds-amounts` (from `92dba80a9`) on 2026-10-28 for issue #491
(display mode `none` withholds every amount): §1.2's display-mode paragraph and §1.3; and on
`fix/497-price-cursor-leak` (from `857092eab`) on 2026-10-28 for issue #497 (sealed price-walk
cursors): §1.3's paragraph on the walk; and on
`fix/492-retire-ispublic` on 2026-10-28 for issue #492 (the sales channel's `isPublic` retired into
the display-mode chain): §1.2's display-mode paragraphs. The old model — the Application rule, the per-list
product roster and brackets, the `Default` list, the product *default price* and the variant price
override — is gone from the code and, after the conversion migration, from the database. How it
worked is recorded in this file's history (`git log -- specs/pricing/current-model.md`); the
file:line citations of `decision-record.md` §1 and `read-paths-and-performance.md` that name it
point at code that no longer exists.

**Section numbers.** `§N` references follow the numbering of the original analysis, which is split
across this directory: §1 → `current-model.md`; §2 → `read-paths-and-performance.md` (its summary
table); §3–§9, §11, §12 → `decision-record.md`; §10 → `worked-examples.md`. Path abbreviations:
`PL/` = `packages/modules/price_lists/src/`, `CON/` = `packages/contracts/src/`, `CAT/` =
`packages/modules/catalog/src/`, `SF/` = `storefront/`.

---

## 1. Current state (verified in code)

### 1.1 Data model

All tables are owned by `price_lists` unless named otherwise; the normative description is
`specs/160-pricing-model-v2/data-model.md`.

| Table / column | What it is | Evidence |
| --- | --- | --- |
| `price_lists` | the **price-book header**: `name`, `type regular\|sale`, `status draft\|scheduled\|active\|expired`, `starts_at`/`ends_at`, `currency_code` (immutable), `audience_kind everyone\|customer_groups\|organizations` (immutable once `ever_activated`), `priority`, `is_system`, `version` (moves on every write; a write naming an older one is `409 PRICE_BOOK_STALE`) | `PL/backend/entities/price-list.entity.ts`; `PL/migrations/20261021T165239_price_lists_price_books_expand.ts`, `…_price_books_version.ts`, `…_price_books_conversion.ts` |
| base books | one system book per currency (`is_system`, `regular`, `everyone`, always active, no channel set); the platform default currency's keeps the id `00000000-0000-4000-8000-00000000d51b` | unique `(currency_code) where is_system`; created by the conversion migration and on first use by `PriceBookService.setBasePrices` |
| `sales_channel_price_lists` | a book's **channel set**, a registered sales-channel bridge (entity type `price-list`), read and written only through `SalesChannelMembershipService`; a binding whose channel stops offering the currency stays and is *dormant* | `PL/backend/index.ts` `salesChannelBridges`; `price-book-service.ts` `replaceChannels`, `channelSet` |
| `price_list_audience_members` | a book's **audience set**: `organization_id` or `customer_group_id` (exactly one), FK cascade | expand migration |
| `price_list_matrix_entries` | a book's **rows**: selection (`variant_id` ⇒ `product_id`; `product_id`; `category_id`; `attribute_key`/`attribute_value`; category ∩ attribute; or none = all), `min_quantity`/`max_quantity`, `price_type fixed\|percent\|amount` with `amount` (fixed price or signed adjustment) or `percent` (signed, −100…+1000) | `PL/backend/entities/price-list-matrix-entry.entity.ts`; CHECKs in the conversion migration |
| `price_list_precedence` | versioned buyer-cell order; version 1 = **HY**, active; P1 has no write path (`409 PRECEDENCE_CHANGE_UNAVAILABLE`) | `PL/backend/services/precedence.ts` |
| `price_profiles`, `price_profile_prices` | the **price surface** for sort and range (§1.3) | `PL/backend/services/price-surface.ts` |
| `price_display_mode_overrides` | gross / net / both / none per organization, category, product | `PL/backend/services/price-list-service.ts` (display modes only) |
| `cart_items.price_source` (carts), `order_items.price_source` (orders) | which tier priced a line: `agreed\|base\|catalogue\|buyer\|sale` | each owner's migration |
| customer group | `organizations.customer_group_id`; a customer account may override it | `effectiveCustomerGroupId`, `PL/backend/services/customer-group-rule.ts` |

**A product has no price of its own.** `catalog`'s migration
`20261022T111811_catalog_price_fields_removed` dropped `product_variants.price_override` and
stripped `defaultPrice`/`price` from `products.attribute_values`, unconverted (owner ruling); product
and variant writes and the products import refuse those fields with `400 PRICE_SET_IN_PRICE_BOOKS`
(FR-043). A product's base price is its rows in the base book of each currency; a variant's is its
variant row there (fixed, or a percent/amount adjustment of the product's base), else the product's.

**Row rules** (`PL/backend/services/price-book-rules.ts`, `price-book-batch.ts`): no two rows of
one book with the same selection and overlapping quantity windows (`PRICE_BOOK_ROW_OVERLAP`); a
fixed price needs a selection other than *all*; an attribute row only for an attribute flagged
*Price list rules* (`isPriceRule`) of a choice or boolean type, not language- or channel-scoped —
eligibility is re-read at resolution, so a row on an attribute that stops qualifying stays and does
not price; a base book holds only product rows (fixed) and variant rows; at most 5 000 rows per
book and per batch (`PRICE_BOOK_MAX_ROWS`). A book is **applicable** when it is `active` or
`scheduled`, `starts_at ≤ now < ends_at` (read at resolution time, FR-047 — the 5-minute status
sweep only moves the admin's `status`), of the request currency, bound to the request channel by a
non-dormant binding (base books excepted; they price when the channel offers the currency) and, for
a non-everyone book, with the buyer's organization chain or effective group in its audience.
Activation refuses a book that would apply nowhere or to no one (`PRICE_BOOK_NOT_APPLICABLE`).

### 1.2 Resolution algorithm, exactly as shipped

Inputs: product (`id`, `attributeValues`), optional variant, quantity, organization (`id`,
`customerGroupId`), optional `customerGroupId`, optional `customerAccountId`, sales channel (`id`,
`defaultCurrency`), optional currency (`PL/backend/services/pricing-service.interface.ts`). The
group is one rule on every path (`effectiveCustomerGroupId`): the caller's resolved group, else the
account's own group (when the account belongs to the organization), else the organization's.

Every entry point is the batched one or a wrapper over a batch of one
(`PL/backend/services/pricing-service.ts`): `resolveListingPrices` / `resolveListingPriceDetails`
(quantity 1, variant products ranged over their variants — the card shows the lowest, *from*),
`resolveLinePrices` (each line at its own quantity), `resolveEngine` / `resolveLinePrice` (one
line). They run `BookPricing` (`book-pricing.ts`) over the **pricing profile**
(`pricing-profile.ts`): the sorted vector of the buyer books that apply `(book, audience kind,
chain depth)` plus channel, currency and precedence version — guests and buyers with no buyer book
share the *everyone* profile. One statement loads the applicable books, one the rows of those books
for the batch's products and variants, and the category memberships, attribute values and variants
come through `catalog`'s ports once per batch; the pure resolver (`book-resolver.ts`) then prices
each line:

```
1. BASE       the base book's variant row covering q, else the product's row     → b
2. CATALOGUE  the best row of the channel's regular *everyone* books, ranked by
              selection kind (variant > product > category ∩ attribute >
              category > attribute > all); percentages off b                    → C, else b
3. BUYER      the best row of the regular organization-set and group-set books,
              ranked by the active precedence's rank table (12 cells
              audience × selection; HY = contract first, blanket last);
              percentages off C                                                → R, else C
4. SALE       the best row of the sale books — buyer cells by the rank table,
              then everyone rows by selection kind; percentages off C          → S
5. CHARGE     S when S < R (R is the compare-at), else R; nothing → unpriced
```

Inside a tier the order is total: cell rank → chain depth (organization cells; nearest first, or
ahead of the cell under the AF-N preset) → book priority (desc) → starting quantity (desc) →
resulting amount (asc) → book id → row id. Renaming a book or editing its rows never changes which
book wins a tie (FR-045). A row whose reference is missing or whose result would be below zero does
not price and the next candidate is tried; zero is a price. A variant line matches attribute rows on
the product's values overlaid by the variant's axis values. The answer carries the source tier, the
compare-at price of a charged sale, the book and row that priced it, and — when the setting
`pricing.show_list_price` is on and the everyone price is above the charged one — the list price.
`POST /api/v1/admin/price-books/resolve` returns the same answer with the ranked candidates and the
precedence version (FR-020).

**Caching and invalidation.** Answers are cached per process keyed by the profile
(`ProfilePricingCacheKey`), and the profile per (organization chain, group, channel, currency), both
under a 60 s TTL (`DEFAULT_PRICING_CACHE_TTL_MS`). Every audited price-book write runs through
`CommandBus.run` and bumps `PricingGeneration` **after** the commit: every process clears its layers
(Redis channel `b2b:price_lists:pricing-generation`, best effort, the TTL as the degraded bound), and
the writer hands the price surface a `SurfaceChange` describing what it moved
(`PL/backend/services/surface-change.ts`), which marks only that (§1.3). The status sweep bumps when
it flips a book; catalogue events (product, category, attribute) and the channel events
(`sales_channels.identity_changed`, `sales_channels.lifecycle_changed`) bump and mark too. The cache
is still cleared whole on every bump.

**Display mode** is resolved independently: product → category → organization → settings
(`pricing.default_display_mode`, `pricing.unauthenticated_display_mode`), batched per page: the
product and category steps for the batch (`PriceListService.resolveProductDisplayModes`), the
organization → settings tail once (`resolvePageDisplayMode`). The price-book engine caches only the
viewer-independent product and category steps with the answer (`CachedBookLine`) and memoises the
tail apart from it, per channel, guest or signed-in and (signed in) organization, under the same
generation (`ViewerModeKey`): the profile is shared by viewers whose tails differ, so a display mode
cached with the answer would be served to the wrong one. An organization override,
`setSettingsDisplayMode` and a settings write of either display-mode key (`settings.value_changed`)
bump the generation; a product or category override bumps it and marks the products it concerns on
the price surface (§1.3). A resolution of a fixed profile
(the surface worker, a feed's catalogue reference) neither reads nor writes the answer cache.

**The sales channel has no price-visibility flag** (issue #492). `sales_channels.is_public` withheld
prices from every viewer on a channel, signed-in buyers included, and every consumer skipped the
resolution on it (catalogue listing and walk, product page, product links, search, comparisons, the
price-control check). It is gone, column and all: `Migration20261028T173317CoreSalesChannelsRetireIsPublic`
wrote `pricing.unauthenticated_display_mode = none` as the channel's own value for every channel that
had it off and no value of its own, then dropped it. So "prices after sign-in" on one channel is the
settings tier of the chain, per channel, and a signed-in buyer there is priced by their own tail. The
chain's precedence is unchanged (owner ruling of 2026-10-28): a product or category override
precedes the viewer's tail, so it decides for a guest as well, and is the one way a guest is shown a
price where the guest mode is `none` (`worked-examples.md` §10.19 W5, §10.20).

**Display mode `none` withholds every amount** (issue #491, `worked-examples.md` §10.19). Where the
viewer's mode is `none`, the mapping onto the published shapes (`PL/backend/services/book-pricing.ts`:
`listingPriceFromBook`, `listingDetailFromBook`, `engineFromBook`) answers no price, no base, no
sale, no list price, no tier, no book and no source — `displayMode: 'none'` stays — so the catalogue
listing, the product page, home cards, search hits and suggestions, comparisons, product links and
the storefront resolved price send no amount, and none of them restates the rule. The mode is
applied per request after the cached resolution, so an amount cached for a priced viewer under the
shared profile is never mapped for a `none` viewer. A line (`resolveLinePrices`) keeps its amount
beside the mode: the cart, the admin order preview and order intake refuse it as quote-only by that
mode; the external catalogue API, which publishes line amounts, withholds them through
`displayModeWithholdsAmounts` (`CON/price-lists.ts`). Quote reference prices are resolved for a
signed-in owner and shown only in the admin projection; product feeds are out of scope (a feed
publishes deliberately; a pinned feed reads its book).

**Consumers.** Catalogue listing, product page, product links, home cards, search hits and
suggestions, comparisons, the cart read and placement (one chain, `CartLinePricing.orderablePrices`:
agreed price → price books → refusal; the line stores `price_source`), order placement (copies the
source), the admin order preview and external order intake (`resolveLinePrices`), quote reference
prices (request currency), the external catalogue API and product feeds (a feed pinned to a book
reads that book's rows over the channel's guest catalogue price without the book, and only while
the book applies to an anonymous buyer on the feed's channel now — `active` or `scheduled` inside
its window, bound to the channel, audience everyone; `namedListPublishability` says why not) —
every one through the batched entry
points; `backend/test/integration/price_lists/pricing-surfaces-agree.test.ts` holds them to the same
amount, currency and source.

**How a consumer carries the amount** (owner ruling of 2026-10-25, `worked-examples.md` §10.18). The
resolver answers a four-place decimal string, and a consumer that stores a unit price keeps all
four places, unrounded (`unitPriceHalfUp`, `CON/money-decimal.ts`): the cart line
(`cart_items.unit_price`, `recomputed_unit_price`, `agreed_unit_price`), the order line copied from
it (`order_items.unit_price`), the admin order preview's line, a quote line's reference, desired and
agreed price (`quote_request_items.*_unit_price`) and the invoice line (`invoice_lines.unit_net_price`)
are all `numeric(14,4)`. Placement compares the stored price with the current one at four places.
**The line value is the rounding point**: a line's net is `unit × quantity` rounded half-up to two
places once (`lineAmountHalfUp`), and VAT is per rate on the sum of the rounded line nets
(`vatByRate`, §10.17). The product feed publishes two places without rounding a unit price: one
with a third or fourth significant place goes out as the exact price of a pack of N, with N in the
format's pack fields, or not at all (`feed-pack.ts`, issue #430); a two-place amount is written by
`roundAmountHalfUp`. Every other surface shows a unit price with
its significant places, up to four, at least two (`unitPriceFractionDigits`): `0,0125 zł`,
`1,50 zł`, `1,505 zł`.

### 1.3 Price sort and price range

`orderByUnitPrice` / `pricedProductIds` read the **price surface** (`price-surface.ts`,
`specs/160-pricing-model-v2/contracts/price-surface.md`): per profile, `price_profile_prices` holds
the quantity-1 price of each product (the lowest variant price for a variant product) — except a
product whose own display-mode step (its override, else its category's) is `none`, which is
withheld from every viewer and has no row, so price sort walks it in the unpriced tail and a price
range leaves it out (issue #491; spec 086's clarification 2 had it keep its position while the API
still sent its amount). The step is read by a build only while some product or category override
is `none`. A viewer whose own tail (organization, settings) is `none` is refused price sort and
range by the catalogue (`pageDisplayMode`); `pricedProductIds` and the live ordering of a
never-built profile leave out whatever the viewer's mode withholds. Like a price change, a
display-mode override reaches the order at the worker's turnaround: until the marked product is
refreshed it keeps the position its last price gave it (and the walk may meet it again in the
tail); its card is withheld at once. The everyone
profile holds every priced product, a buyer profile only the products whose answer differs. A page
is one statement over the buyer profile and the everyone profile, each read at the generation its
profile serves. The surface is built only by the `price_lists.surface` worker (BullMQ, deduplicated,
off with the module): a write marks what it can move — (profile, product) marks in
`price_profile_stale_products`, or a whole profile `stale` when the change concerns every product
of it — and a marked profile keeps serving its rows until the worker has re-resolved the marked
products and replaced their rows of the served generation in one transaction, or built a
whole-marked profile's next generation and swapped it in (`contracts/price-surface.md` §4,
`research.md` R17); a profile never built is answered without one — live over
a bounded restriction (≤ 5 000 products), from the everyone surface for an unrestricted buyer page,
or `unordered` (the catalogue's default order, whose walk carries that listing's cursor and keeps
that order to its end) when nothing is built. A walk already on a price order that finds it gone
continues from the last price it served (`rest`: the products whose live price sorts after it,
then the unpriced, in the default order), never from page 1. A walk meets every product whose
price does not change during it exactly once; a product repriced meanwhile may be met twice or not
at all, as on any keyset walk over a live price — the order goes missing *because* pricing changed
more often than not. A page cut by its scan budget is short, possibly empty, and hands on a cursor
at its scan position, so a budget never ends a walk (review 3 of 0.108.0, A1/A2). That position can
be a product the viewer may not see, and under a price sort it holds its resolved price and id, as
the last card of a full page holds a price the viewer's display mode may withhold while the order
still ranks it; so every cursor a price walk issues — price sort and a price range under another
sort alike — is sealed (AES-256-GCM under a key derived from `SESSION_COOKIE_SECRET`, the
platform's `cursorSeal`; issue #497): it decodes to nothing and cannot be forged, and one that does
not open — altered, of the unsealed format, or sealed before the session key changed — starts the
walk again, as an unreadable cursor always has. **No request builds a
surface**: the order may lag a change by the worker's turnaround (SC-005: ≤ 60 s for a targeted
change, ≤ 150 s at 200 profiles for a catalogue-wide one), a displayed
price never — cards are always resolved live. Measured in
`backend/test/perf/price_lists/price-surface.bench.ts` and `read-paths-and-performance.md` §7.

### 1.4 What is still open

1. **Precedence is read-only.** Version 1 = HY is the only version; the change flow (stage, impact
   preview, versioned rebuild) is P3.
2. **The admin editor is P2** (`specs/161-price-book-editor/`, complete 2026-10-23, released
   together with P1): the book list, create flow, grid with CSV import and export, duplicate, the
   explainer, *Pricing settings* (display modes, the list-price switch, the precedence read-only) and
   the product's base-price panel. The sidebar's *Price books* entry opens the list
   (`/price-lists`); the display-mode page is *Pricing settings*, reached from the palette and the
   list header.
3. **Promotions stack on sale and contract prices** — the exclusion on `price_source` is P4.
4. **The external catalogue API** names the bound organization but not the API key's customer
   account, so a customer's own group is not applied there.
5. **Next.js `pricing:*` cache tags are never revalidated**, and short price-sorted and search
   pages (#235) remain, as in P0.
6. ~~**The in-process write port covers base prices only.**~~ **Resolved by issue #1028.**
   `priceListAdminPort` — through which the PIM connectors' price import wrote brackets — was
   removed with the old model and replaced by `priceBookWritePort` (FR-049, owner ruling
   2026-10-22, `specs/160-pricing-model-v2/contracts/price-book-write-port.md`): base tiers per
   currency, read, replace, and the G1 list of books pricing a product. One product's rows of a
   non-base book are written by `priceBookRowWritePort` (`replaceBookRows`, `removeBookRows`,
   `bookRows`), through the admin row batch's planning and command
   (`price_list.book_rows_set` / `book_rows_remove`); base and expired books are refused. What
   remains: no port creates a book or changes a header — an administrator owns those.
7. ~~**The price surface is rebuilt whole.**~~ **Resolved 2026-10-23** (owner ruling; research
   R17): writers describe their change and the worker refreshes the marked (profile, product) pairs
   in place; measured at 202 profiles in `read-paths-and-performance.md` §7. What remains: a change
   that concerns every product of its profiles — a row selecting by attribute alone or every
   product, a change to more than 10 000 products, a channel event, the precedence — still rebuilds
   those profiles whole. SC-005 gives that case its own bound, ≤ 150 s at 200 profiles (owner
   rulings 2026-10-24: 300 s, tightened to 150 s after issue #416). Issue #416 (research R19) made a
   whole build about three times faster. Each build reads the catalogue through a lean port
   projection at its own start, skips the display mode the surface does not store, and resolves the
   next batch while the previous one is written. A product deleted under a build costs that build a
   retry, not the pass. At 202 profiles an all-products row now takes 84.84 s to show, and a channel
   event 83.23 s; before the change they took 275.64 s and 273.47 s.
