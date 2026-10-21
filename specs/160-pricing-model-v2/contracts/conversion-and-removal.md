# Contract — Conversion and removal (FR-041–FR-044, SC-006, SC-007)

Design: `research.md` R2, R4, R13. Tables: `data-model.md` §8.

## 1. The `price_lists` conversion migration (one, one transaction)

| Step | Effect | Reads | Writes |
| --- | --- | --- | --- |
| 1 | create new tables/columns | — | own |
| 2 | one base book per currency used by a Default bracket, plus the platform default currency (system-default channel's `default_currency`); default currency keeps `…d51b` | own, `sales_channels` (kernel) | own |
| 3 | Default brackets → product rows of their currency's base book | own | own |
| 4 | products with no Default bracket and numeric `attribute_values.defaultPrice` (else `price`) → base row, default currency | `products` (catalog, declared dependency, read-only) | own |
| 5 | variants with `price_override` → fixed variant rows, default currency | `product_variants` (catalog, read-only) | own |
| 6 | delete every non-system list and the Default list's matrix entries | own | own |
| 7 | rename `type` value `base` → `regular`; drop old tables/columns; seed precedence v1 = HY | own | own |

`check:module-boundary` R1 holds (reads of a declared dependency), R2 holds (no write outside
`price_lists`).

## 2. Other owners' migrations in P1

- `carts`: `cart_items.price_source` (nullable).
- `orders`: `order_items.price_source` (nullable).

## 3. Deferred (next release, `catalog`)

`product_variants.price_override` drop and the removal of `defaultPrice`/`price` keys from
`products.attribute_values`. Until then: no code reads or writes them (removed from the entity,
DTOs, admin and import; FR-043 refuses `defaultPrice` and `priceOverride` on create, update and
import with `400 PRICE_SET_IN_PRICE_BOOKS`). A contract test pins "no reader" by grepping the
compiled packages, so the deferral cannot grow a consumer.

## 4. Demo (N12, FR-044)

`demo-composition` order: catalogue demo (products, *Screws*, `color` flagged `isPriceRule` with
`red`, *Screws 0200*), customer accounts demo (*VIP*), organizations demo (*Acme B2B (demo)* in VIP),
then the `price_lists` demo step through its published install surface: base books for every demo
product (from the price the catalogue demo generated, carried in the demo step's own data, not in
`attribute_values`), and the books of `worked-examples.md` §10.2–§10.4 bound to the demo channel.
`demo reset` clears and re-runs the step. A demo test resets and prices E1.1–E3.6 (SC-007).

## 5. Verification

- `backend/test/integration/price_lists/conversion.test.ts`: a database prepared with old-model data
  (Default brackets in two currencies, a product with only `defaultPrice`, a variant override, a
  rule-based list with matrix entries) → after migration: base rows equal, variant row present,
  no non-system list, old tables absent, precedence v1 = HY (SC-006).
- `db:fresh` + `module:install --all` on an empty database: green, base books for the default currency
  exist, precedence seeded.
