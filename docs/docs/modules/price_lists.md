---
title: price_lists
---

# `price_lists`

Pricing engine — feature 011 reshape on top of the original feature 014
foundation. Owns:

- **CustomerGroup** — addressable bucket of Organizations sharing pricing.
- **PriceList** — a named pricing artefact with a lifecycle status
  (`draft`, `scheduled`, `active`, `expired`), a `type` (`base` or
  `sale`), an optional active window (`startsAt` / `endsAt`), and an
  `applicationRule` AST that decides which customer / org / channel
  the list applies to.
- **PriceListProduct** — composite-PK assignment of a Product to a
  PriceList.
- **PriceListPriceBracket** — composite-PK row keyed
  `(priceListId, productId, currencyCode, minQuantity)` carrying the
  per-currency unit price for a quantity bracket. Bracket gaps are
  allowed; the resolver falls through to the next-priority list.
- **PriceDisplayModeOverride** — composite-PK row keyed
  `(scope, targetId)` overriding the resolver's display-mode chain at
  Organization / Category / Product scope. The chain root is two
  Settings keys (`pricing.default_display_mode`,
  `pricing.unauthenticated_display_mode`).

The legacy `PriceListItem` and `PriceListAssignment` tables (and the
`code` / `currency` / `priority` / `isDefault` columns on `price_lists`)
are kept by migration 031 only as a transitional shim during the
expand → migrate → contract rollout. Newly written code MUST consume
the engine schema via `@endora-commerce/contracts`.

## Lifecycle

```text
draft ──activate──▶ scheduled ──auto on startsAt──▶ active ──auto on endsAt──▶ expired
  ▲                     │                              │                        │
  └──── draftify ───────┴────── draftify ──────────────┴────── activate (resets) ┘
```

- `activate` flips a `draft` (or `expired`) list to `scheduled` if a
  future `startsAt` is set, otherwise straight to `active`.
- `draftify` returns any non-system list to `draft`.
- `PriceListStatusWorker.sweep()` runs the two clock-driven transitions
  (`scheduled → active` at `startsAt`, `active → expired` at `endsAt`).
  In production it's invoked by a 5-min BullMQ repeatable job; in tests
  the same `sweep()` is exposed via `POST /api/v1/admin/price-lists-engine/internal/sweep`.

The seeded `Default` list (`isSystem = true`) refuses every state
change, every delete, and every non-empty `applicationRule` (FR-005,
FR-006). Migration 031 also seeds bracket rows on it from each
product's legacy `attributeValues.defaultPrice`, so the platform always
has a usable terminal-fallback price.

## Application Rule (AST)

The `applicationRule` JSONB column stores a discriminated union:

```ts
type ApplicationRule =
  | { kind: 'all' }
  | {
      kind: 'criterion';
      type: 'salesChannel' | 'customerGroup' | 'organization' | 'category' | 'currency';
      values: string[];                  // UUIDs (or ISO 4217 for currency)
    }
  | {
      kind: 'group';
      op: 'AND' | 'OR';
      children: ApplicationRule[];        // 1..20
    };
```

Constraints (enforced both client-side in the rule builder and by the
service-layer normaliser):

- Depth ≤ 5 nested groups.
- Per-criterion value lists are deduplicated; currency codes uppercased.
- Empty groups are dropped; if the root group ends up empty, it is
  replaced with `{ kind: 'all' }` — but `{ kind: 'all' }` is only valid
  on the `Default` system list. Any other list with an empty rule is
  refused at activation time (`400 empty_rule_on_non_default`).
- Unknown target IDs (channel / customer-group / organization /
  category) are refused with `400 unknown_target { type, values }`.

## Resolver

`PricingService.resolveEngine({ product, variantId?, context })`
returns:

```ts
{
  base:  { listId, bracket, listName },        // never null — Default is the floor
  sale:  { listId, bracket, listName } | null, // optional second tier
  displayMode: 'gross_only' | 'net_only' | 'both' | 'none',
  currencyCode: string
}
```

Algorithm (also in `data-model.md` § 5):

1. Load every `status='active'` price list.
2. Evaluate each list's `applicationRule` against the resolution
   context; keep matchers, partition by `type`.
3. For each partition, walk the **priority chain** (FR-026 + FR-027):
   - Level 1: explicit organization match.
   - Level 2: explicit customer-group match.
   - Level 3: explicit category match.
   - Level 4: explicit sales-channel match.
   - Level 5: any other matching list.
4. Pick the winner per level via `tieBreak()` — most recent
   `modifiedAt` first, lexicographic `name` ASC second.
5. Look up the bracket for `(productId, currencyCode, quantity)`. If
   no bracket matches (gap), fall through to the next-priority list in
   the same partition; the Default list is always at level 5 of the
   Base partition and serves as the terminal floor.
6. Resolve the display mode independently via
   `displayModeResolver(product, organization, customerKind)` along
   the chain Settings → Organization → Category → Product.

Determinism: same inputs → same outputs (no clock, no randomness, total
tie-break order). The resolver is consumed by the storefront
(`GET /api/v1/storefront/products/:id/resolved-price`) and by the cart
+ order-placement code paths.

## Display modes

Four values: `gross_only`, `net_only`, `both`, `none`. The first three
control the column layout on every storefront price-bearing surface;
`none` hides every price element and replaces Add-to-cart with the
existing Quote Request CTA from feature 008. The cart-line and
order-placement endpoints additionally refuse the line with
`400 product_quote_only` when the resolved mode is `none` for the
`(product, organization, channel)` tuple — defence in depth.

## Public surface

### Engine endpoints (admin)

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/price-lists-engine?status=&type=&search=` | List engine-shape lists with optional filters |
| `POST /api/v1/admin/price-lists-engine` | Create a draft list |
| `GET /api/v1/admin/price-lists-engine/:id` | Read one list |
| `PATCH /api/v1/admin/price-lists-engine/:id` | Update name / type / dates / applicationRule |
| `POST /api/v1/admin/price-lists-engine/:id/activate` | Lifecycle → scheduled or active |
| `POST /api/v1/admin/price-lists-engine/:id/draftify` | Lifecycle → draft |
| `POST /api/v1/admin/price-lists-engine/:id/duplicate` | Clone (resets dates and status) |
| `GET /api/v1/admin/price-lists-engine/:id/products` | List roster + per-currency brackets |
| `PUT /api/v1/admin/price-lists-engine/:id/products` | Replace roster (delta) |
| `POST /api/v1/admin/price-lists-engine/:id/products` | Append one product |
| `DELETE /api/v1/admin/price-lists-engine/:id/products/:productId` | Remove (cascade brackets) |
| `GET /api/v1/admin/price-lists-engine/:id/products/:productId/brackets` | Read brackets for one product |
| `PUT /api/v1/admin/price-lists-engine/:id/products/:productId/brackets` | Replace brackets (`{ bracketsByCurrency }`) |
| `POST /api/v1/admin/price-lists-engine/:id/products/:productId/brackets/copy` | Identity copy of one currency to N others |
| `POST /api/v1/admin/price-lists-engine/internal/sweep` | Test-only worker tick |

### Rule-builder pickers (admin)

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/pricing/rule-targets/sales-channels` | Channel options for the rule builder |
| `GET /api/v1/admin/pricing/rule-targets/customer-groups` | Customer-group options |
| `GET /api/v1/admin/pricing/rule-targets/organizations?search=&limit=` | Paginated org options |
| `GET /api/v1/admin/pricing/rule-targets/categories` | Full category tree |
| `GET /api/v1/admin/pricing/rule-targets/currencies` | Currencies exposed by any sales channel |

### Display-mode admin

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/pricing/display-mode-overrides?scope=` | List overrides |
| `GET /api/v1/admin/pricing/display-mode-overrides/:scope/:targetId` | Read one |
| `PUT /api/v1/admin/pricing/display-mode-overrides/:scope/:targetId` | Upsert (`{ mode }` or `{ mode: 'inherit' }` to delete) |

### Linked price-lists panel (admin)

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/admin/products/:productId/price-lists` | Lists every price list a product is part of, with per-currency bracket summary and a deep-link path |

### Storefront (public)

| Verb + Path | Purpose |
| --- | --- |
| `GET /api/v1/storefront/products/:id/resolved-price?quantity=&currency=&variantId=` | Per-customer Base + Sale + display mode |
| `GET /api/v1/storefront/pricing/display-mode/:productId` | Display mode only (used by the cart, and by batch surfaces that resolve the price separately) |

Both storefront reads are resolved **for the viewer**: they take the buyer's
session when one is there and answer as the public when it is not. They also
derive that viewer through one function, so the display mode carried inside a
resolved price and the one this endpoint returns cannot disagree for the same
caller — before issue #271 they could, and a signed-in buyer read net on the
product page and gross in the cart wherever `pricing.default_display_mode` and
`pricing.unauthenticated_display_mode` were set differently. A response resolved
for an Organization carries `Cache-Control: private, no-store`; the anonymous
one is unstamped and stays the representation a crawler and the storefront's
shared window hold.

### Legacy (feature 014 — still served until every reader migrates)

| Verb + Path | Purpose |
| --- | --- |
| `GET / PUT / DELETE /api/v1/admin/price-lists{,/:code,/:id}` | Legacy CRUD over the old shape |
| `GET / POST / DELETE /api/v1/admin/price-lists/:id/items{,/:itemId}` | Legacy items CRUD |
| `GET / POST / DELETE /api/v1/admin/price-lists/:id/assignments{,/:assignmentId}` | Legacy assignments CRUD |
| `GET /api/v1/admin/price-lists/preview?productSku=&quantity=&organizationId=&salesChannelCode=` | Legacy preview |

## Migration notes (031)

`031_price_lists_engine.ts` runs an 8-step transactional reshape:

1. Acquire an advisory lock so concurrent migrations bail out cleanly.
2. Add the new columns on `price_lists` (`type`, `status`, `startsAt`,
   `endsAt`, `modifiedAt`, `isSystem`, `applicationRule` JSONB).
3. Create the three new tables (`price_list_products`,
   `price_list_price_brackets`, `price_display_mode_overrides`).
4. Seed the `Default` list with a deterministic UUID.
5. Walk every `Product` whose `attributeValues` carries `defaultPrice`
   (or `price` as fallback) and upsert one bracket row per currency
   exposed by any sales channel. Identity copy across currencies is
   flagged in the migration report.
6. Strip the legacy `attributeValues.defaultPrice` and
   `attributeValues.price` keys (per FR-047).
7. Emit the report to `backend/var/migration-reports/011_price_lists_seed.json`.
8. Release the advisory lock.

The migration is **additive** to the legacy schema — the
`price_list_items` and `price_list_assignments` tables and the
`code`/`currency`/`priority`/`isDefault` columns on `price_lists`
remain in place until the readers in `cart-service`, `comparison-service`,
`catalog-query`, `search-query`, and `product-link.service` swap to the
resolver. A follow-up migration drops the legacy columns once that
audit (T103) lands.

The migration helper (`default-price-list-migration.ts`) is idempotent
and can be re-run as a repair command.

## Storefront integration

- `GET /api/v1/storefront/products/:id/resolved-price` is consumed by
  `storefront/lib/api/pricing.ts` (`getResolvedPrice` /
  `getResolvedPricesBulk`); the bulk wrapper fans out to the singular
  endpoint with bounded concurrency until a backend POST batch lands.
- `BaseSalePriceBlock`, `PriceTag`, and `ProductCard` consume the
  `resolvedPrice` envelope; `displayMode === 'none'` hides every price
  element and surfaces the `QuoteRequestCta` (which routes through
  `AddToRfqForm` from feature 008).
- The PDP fetches the resolver in parallel with stock and swaps the
  Add-to-cart row for the QuoteRequest CTA when the mode is `none`.

## Admin integration

- `/price-lists` (engine list) and `/price-lists/:id` (editor with
  Details / Products & brackets / Application rule tabs).
- `/price-lists/display-modes` — overrides browser plus the two
  `pricing.*` settings keys.
- `DisplayModeOverrideRow` is embedded in the Organization editor,
  the Categories tree EditForm, and the LinkedPriceListsPanel that
  replaces the old `PricingPlaceholder` on the catalog Product editor.

## Extension points

- **In-memory LRU cache** around the resolver per
  `contracts/pricing-resolution.contract.md` § Caching behaviour
  (deferred — the storefront's 60-s revalidate window is sufficient
  for the MVP). Bookkeeping: every write path on `PriceListService`
  should emit `pricing.invalidate.v1`.
- **Cart-service / order-placement swap** — the foundation cart and
  order-placement code paths still read `attributeValues.defaultPrice`.
  The next iteration introduces `PricingService.resolveLinePrice()`
  and swaps the cart-service constructor to depend on it; the
  defence-in-depth check for `displayMode === 'none'` lands in the
  same change.
- **Status worker BullMQ wiring** — `PriceListStatusWorker.sweep()` is
  ready but the BullMQ repeatable-job registration (mirroring the
  feature 008 RFQ expiry worker) is queued for a follow-up.
