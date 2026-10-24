# Contract — Conversion and removal (FR-041–FR-044, SC-006, SC-007)

Design: `research.md` R2, R4, R13. Tables: `data-model.md` §8. Owner ruling 2026-10-21: one release,
the catalogue fields are removed and **not** converted (spec Clarifications).

## 1. The `price_lists` migrations (expand, then conversion in one transaction)

Step 1 is the expand migration (foundation phase); steps 2–5 are the conversion migration (removal
phase), both in this release (`research.md` R4).

| Step | Effect | Reads | Writes |
| --- | --- | --- | --- |
| 1 | create new tables/columns; seed precedence v1 = HY | — | own |
| 2 | one base book per currency used by a Default bracket, plus the platform default currency (system-default channel's `default_currency`); default currency keeps `…d51b` | own, `sales_channels` (kernel) | own |
| 3 | Default brackets → product rows of their currency's base book | own | own |
| 4 | delete every non-system old-model list — each in its own savepoint; one another table still refers to is **retired** instead (below) — and the Default list's matrix entries | own | own |
| 5 | rename `type` value `base` → `regular`; drop old tables/columns | own | own |

The migration reads and writes only `price_lists`' own tables (and reads the kernel's
`sales_channels`); `check:module-boundary` has nothing to judge across modules.

**Retiring a list another table refers to** (owner decision 2026-10-24, `research.md` R4 — a
departure from N13). On 0.107.0 a product feed can be pinned to an old-model list through
`product_feeds_price_list_fk` (`on delete restrict`), and `price_lists` runs before `product_feeds`
(it is in `product_feeds`' manifest `dependencies`), so no `product_feeds` migration can release the
key first. Step 4 therefore deletes the lists one at a time in a PL/pgSQL exception block; on
SQLSTATE 23503 (`foreign_key_violation`) the list is kept with its id and becomes an empty book:
its matrix entries, audience members, channel bindings (`sales_channel_price_lists`, this module's
own bridge table) and product lines (when that table exists) are deleted, and its header is set to
`status = 'expired'`, `audience_kind = 'everyone'`, no dates, no rule, name suffixed
" (removed by the 0.108.0 upgrade)" (cut to 200 characters). Step 5 then renames its type
`regular`, and every new CHECK admits it. No foreign table is named or read. `product_feeds`' own
migration of this release, `20261023T234605_product_feeds_price_list_fk_dropped`, runs after the
conversion and drops the key, so the retired book can be deleted later; a feed pinned to it warns
`not_active` (then `not_found` once the book is deleted), and its next run withdraws its published
file (FR-029). `IT/price_lists/conversion.test.ts` holds both paths.

## 2. Other owners' migrations in P1

- `carts`: `cart_items.price_source` (nullable).
- `orders`: `order_items.price_source` (nullable).
- `catalog`: drop `product_variants.price_override`; strip the `defaultPrice` and `price` keys from
  `products.attribute_values`. Nothing is converted; it runs before the `price_lists` migration (module
  order), which does not need it.

## 3. Catalogue code removed with the fields

The `priceOverride` entity property and DTO fields, the admin variant price field, the Product
editor's *Default unit price* field, the `defaultPrice`/`price` virtual-key whitelist
(`CAT/backend/services/catalog-admin.service.ts:114-125`) and the import mapping. FR-043: create,
update and import refuse `defaultPrice`, `price` and `priceOverride` with `400 PRICE_SET_IN_PRICE_BOOKS`.

## 4. Demo (N12, FR-044)

`demo-composition` order: catalogue demo (products, *Screws*, `color` flagged `isPriceRule` with
`red`, *Screws 0200*), customer accounts demo (*VIP*), organizations demo (*Acme B2B (demo)* in VIP),
then the `price_lists` demo step through its published install surface: base books for every demo
product (from the price the catalogue demo generated, carried in the demo step's own data, not in
`attribute_values`), and the books of `worked-examples.md` §10.2–§10.4 bound to the demo channel.
`demo reset` clears and re-runs the step. E3's books are active after a reset, E1's and E2's are
drafts (spec Clarifications). A demo test resets and prices E3.1–E3.6, then activates only E1's books
and prices E1.1–E1.4, then only E2's and prices E2.1–E2.4 (SC-007).

## 5. Verification

- `backend/test/integration/price_lists/conversion.test.ts`: a database prepared with old-model data
  (Default brackets in two currencies, a product with only `defaultPrice`, a variant override, a
  rule-based list with matrix entries) → after migration: base rows equal the Default brackets; the
  `defaultPrice`-only product and the variant have **no** price; `price_override` and the
  `defaultPrice` keys are gone; no non-system list but the retired ones (an old list another table
  refers to: empty, expired, no channel, renamed, §1); old tables absent; precedence v1 = HY (SC-006).
- `db:fresh` + `module:install --all` on an empty database: green, base books for the default currency
  exist, precedence seeded.
