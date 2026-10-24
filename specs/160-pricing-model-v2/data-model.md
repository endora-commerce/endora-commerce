# Data model — Pricing model v2 (feature 160)

Normative for P1. Semantics: `specs/pricing/decision-record.md` §5.1–§5.8 (D-287). Owner of every
table below: **`price_lists`**, except the two line columns (owned by `carts` and `orders`) and the
removal of the two catalogue fields (owned by `catalog`, same release — `research.md` R2). All tables are
`@RuleScoped()` (as `price_lists` is today): the audience is a price coordinate, not a tenant column,
and storefront reads filter by the buyer's own chain and group (Principle XI, *Tenancy* below).
Migrations are timestamped and scaffolded with `pnpm --filter backend run migration:new`; no number
is assigned here.

## 1. `price_lists` — the price-book header (evolved)

| Column | Type | Null | Rule |
| --- | --- | --- | --- |
| `id` | uuid | no | PK |
| `name` | varchar(200) | no | |
| `type` | varchar(8) | no | `regular \| sale`; CHECK. The DB value `base` is renamed `regular` by the conversion |
| `status` | varchar(16) | no | `draft \| scheduled \| active \| expired`, as today; the sweeper still flips it for the admin |
| `starts_at`, `ends_at` | timestamptz | yes | applicability is evaluated against these **at read time** (FR-047) |
| `currency_code` | char(3) | no | renamed from the legacy `currency`; FK-free, validated against `currencies`; **immutable** |
| `audience_kind` | varchar(16) | no | `everyone \| customer_groups \| organizations`; CHECK; immutable once the book has been active |
| `priority` | integer | no | default 0; the legacy column, now read (same-cell tie-break, §5.4) |
| `is_system` | boolean | no | true only for base books |
| `version` | integer | no | default 1; moves on every write to the book (header, channel set, members, rows, activation); a write naming an older one is refused `409 PRICE_BOOK_STALE` (gap G5 of `specs/161-price-book-editor/`) |
| `ever_activated` | boolean | no | default false; set by the first activation and never cleared: the audience kind is immutable from then on (FR-004). Backfilled true for every non-draft and every system row |
| `created_at`, `updated_at` | timestamptz | no | `modified_at` is dropped: it no longer decides anything (FR-045) |

Indexes: `(currency_code, status)`; unique `(currency_code) where is_system`.
Dropped: `application_rule`, `code`, `is_default`, `modified_at`.

**Base book**: `is_system = true`, `type = regular`, `audience_kind = everyone`, no channel rows,
status `active`, no dates. One per currency. The platform default currency's base book keeps id
`00000000-0000-4000-8000-00000000d51b`.

## 2. `sales_channel_price_lists` — the channel set (new, a Principle XII bridge)

| Column | Type | Rule |
| --- | --- | --- |
| `sales_channel_id` | uuid | FK `sales_channels` (kernel) on delete cascade |
| `price_list_id` | uuid | FK `price_lists` on delete cascade |

PK `(sales_channel_id, price_list_id)`; index `(price_list_id)`. Created by `price_lists`' migration
and **registered** in the kernel's `salesChannelBridgeRegistry` as entity type `price-list` (added to
`ChannelMemberEntityTypeSchema` in `@endora-commerce/contracts`), so it is read and written **only**
through `SalesChannelMembershipService` (`replaceChannelsForEntity`, `listEntityIdsForChannel`,
`listChannelIdsForEntity`) — Principle XII's sanctioned accessor — and a deleted channel's rows are
cleared by the kernel's channel-delete path like every other bridge. The registration uses the
default convention (a row-less book is in **no** channel).
**Validation** (service, in the Command Bus run, after locking the header): every channel offers the
book's currency (`sales_channels.currencies`), on create, edit and activate (FR-003). A row whose
channel later stops offering the currency stays and is **dormant**: excluded at read time (FR-011).
A system (base) book has no rows and is channel-independent by D-287 (§5.1) — the one exception, as
the Default list's `{kind:'all'}` is today; a non-system book needs at least one row to be activated.

## 3. `price_list_audience_members` — the audience set (new)

| Column | Type | Rule |
| --- | --- | --- |
| `price_list_id` | uuid | FK `price_lists` on delete cascade |
| `organization_id` | uuid null | FK `organizations` on delete cascade |
| `customer_group_id` | uuid null | FK `customer_groups` on delete cascade |

CHECK exactly one of the two is set. Unique `(price_list_id, organization_id)` and
`(price_list_id, customer_group_id)`. Indexes `(organization_id, price_list_id)`,
`(customer_group_id, price_list_id)`. **Validation**: every member matches the header's
`audience_kind`; `everyone` has no member; a non-system book of the other two kinds needs at least one
member to be activated (FR-002, A4).

## 4. `price_list_matrix_entries` — rows (evolved, name kept)

| Column | Type | Null | Change / rule |
| --- | --- | --- | --- |
| `id` | uuid | no | |
| `price_list_id` | uuid | no | FK, cascade |
| `variant_id` | uuid | yes | **new**, FK `product_variants` on delete cascade |
| `product_id` | uuid | yes | set with `variant_id` to the variant's parent |
| `category_id` | uuid | yes | |
| `attribute_key`, `attribute_value` | varchar(64), varchar(255) | yes | pair CHECK as today |
| `min_quantity`, `max_quantity` | integer | no / yes | as today |
| `price_type` | varchar(16) | no | `fixed \| percent \| amount` (was `fixed \| discount_percent`) |
| `amount` | numeric(14,4) | yes | `fixed`: ≥ 0; `amount`: signed Δ |
| `percent` | numeric(7,2) | yes | renamed from `discount_percent`, **signed**: price = ref × (1 + percent/100); −100 ≤ percent ≤ 1000; conversion stores −p |
| ~~`organization_id`~~, ~~`currency_code`~~ | | | dropped |

**Selection kind** (derived, never stored): variant > product > category ∩ attribute > category >
attribute > all. **CHECKs**: `variant_id` ⇒ `product_id` set and no category/attribute; `product_id`
without `variant_id` ⇒ no category/attribute; a fixed price needs a selection other than *all*;
exactly one of `amount`/`percent` per `price_type`. **Service rules**: no two rows of one book with
the same selection and overlapping quantity windows (FR-006); an attribute row only for an
`isPriceRule` attribute of an eligible value type (FR-007, eligibility re-read at resolution, never
an error); a base book holds only product and variant rows, and its product rows are `fixed`
(FR-009). Indexes: `(price_list_id, product_id)`, `(price_list_id, variant_id)`,
`(price_list_id, category_id)`, `(price_list_id, attribute_key, attribute_value)`, and the partial
covering `(price_list_id, amount, product_id) where min_quantity = 1 and variant_id is null and
product_id is not null and price_type = 'fixed'` (replaces the 086 bracket index).

## 5. `price_list_precedence` — configurable precedence (new)

| Column | Type | Rule |
| --- | --- | --- |
| `version` | integer | PK |
| `cells` | jsonb | ordered array of the 12 buyer-cell codes (`org.variant` … `group.all`) |
| `category_before_attribute` | boolean | |
| `depth_mode` | varchar(32) | `within_cell \| nearest_organization_first` |
| `state` | varchar(16) | `staged \| active \| superseded`; partial unique on `state = 'active'` and on `state = 'staged'` |
| `impact` | jsonb null | P3's preview report |
| `created_by`, `created_at`, `activated_at` | | |

Seeded: version 1 = **HY**, `category_before_attribute = true`, `depth_mode = within_cell`,
`state = active`. P1 has no write path (FR-023). `validatePrecedence` enforces I1–I5 (§5.6).

## 6. Price surface (new) — `price_profiles`, `price_profile_prices`

`price_profiles`

| Column | Type | Rule |
| --- | --- | --- |
| `id` | uuid | PK |
| `sales_channel_id` | uuid | FK kernel, cascade |
| `currency_code` | char(3) | |
| `precedence_version` | integer | FK `price_list_precedence` |
| `key_hash` | char(64) | sha-256 of the canonical book vector; unique `(sales_channel_id, currency_code, precedence_version, key_hash)` |
| `book_vector` | jsonb | sorted `[{bookId, audienceKind, depth}]`; `[]` = the everyone profile |
| `uniform_percent` | numeric(7,2) null | reserved for the *profile factor* mitigation (`research.md` R7); unused unless the bench requires it |
| `state` | varchar(16) | `building \| ready` — `building` only until the first build: a built profile stays `ready` |
| `built_at` | timestamptz | |
| `serving_generation` | integer | the generation of `price_profile_prices` readers are served; a build writes the next one and swaps it in (`contracts/price-surface.md` §3) |
| `stale` | boolean | a pricing write since the served build; the profile is still served |
| `marked_at` | timestamptz null | the last mark; a build clears `stale` only if nothing marked it after the build began |

`price_profile_prices` — PK `(profile_id, generation, product_id)`; covering index
`(profile_id, generation, amount, product_id)`.

| Column | Type | Rule |
| --- | --- | --- |
| `profile_id` | uuid | FK cascade |
| `generation` | integer | the build the row belongs to |
| `product_id` | uuid | FK `products` cascade |
| `amount` | numeric(14,4) | the quantity-1 price the card shows (lowest variant price for variant products) |
| `max_amount` | numeric(14,4) | highest variant price; = `amount` otherwise |
| `compare_at` | numeric(14,4) null | the buyer price when a sale is charged |
| `source_tier` | varchar(16) | `base \| catalogue \| buyer \| sale` |

Density: the everyone profile holds every product it prices; another profile holds only the products
whose answer differs from the everyone profile's (`research.md` R7). Rows are written only by the
surface worker, never by a request or an admin write.

## 7. Line price source (new columns, other owners)

| Table | Column | Owner | Rule |
| --- | --- | --- | --- |
| `cart_items` | `price_source` varchar(16) null | `carts` | `agreed \| base \| catalogue \| buyer \| sale`; written with `unit_price` |
| `order_items` | `price_source` varchar(16) null | `orders` | copied from the cart line at placement |

Each in its owner's migration; no FK; null for lines priced before the feature.

## 8. Removed in P1

| Object | Owner | How |
| --- | --- | --- |
| `price_list_products`, `price_list_price_brackets` (+ the 086 partial index) | price_lists | dropped by the conversion migration after step 3 (R4) |
| `price_list_items`, `price_list_assignments` | price_lists | dropped |
| `price_lists.application_rule`, `code`, `is_default`, `modified_at` | price_lists | dropped |
| `price_list_matrix_entries.organization_id`, `currency_code` | price_lists | dropped after the non-system lists are deleted (or retired empty, when another table refers to one — `research.md` R4) (only base rows remain, and they carry neither) |
| `PriceListProduct`, `PriceListPriceBracket` entities; Application-rule evaluator; candidate vector | price_lists | code removed |

**Removed by `catalog` in the same release, not converted** (`research.md` R2, owner ruling
2026-10-21): `product_variants.price_override` (column dropped) and the `defaultPrice`/`price` keys of
`products.attribute_values` (stripped), by `catalog`'s own migration; and the entity property, DTO
fields, admin field and import mapping of both.

## 9. State transitions

- **Book**: `draft → (activate) → scheduled | active → (end) → expired`; `* → (draftify) → draft`.
  Activation requires: a non-empty channel set with at least one non-dormant binding (non-system), a
  member set matching the kind (non-everyone), the currency offered by every bound channel.
  Applicability at read time = `status ∈ {scheduled, active}` ∧ `starts_at ≤ now < ends_at`.
  (`scheduled` is included so a book whose start passed before the sweep is still applied.)
- **Precedence version**: `staged → active` (P3), the previous `active → superseded`.
- **Profile**: `building → ready`; a new precedence version creates new profiles beside the old.

## 10. Tenancy and scope

- Storefront and every consumer read only books whose audience is *everyone*, a member of the
  buyer's organization chain, or the buyer's effective group — the applicable-book query's `where`
  clause; no path takes a book id from the client.
- Admin scope (FR-034): a sales representative's list query filters organization-set books to those
  with **no** member outside the scope; a direct read or write of any other book answers as missing.
- Audit references: `price_list.*` actions keep `objectType: 'price_list'`; members and channel rows
  are audited on their book.
