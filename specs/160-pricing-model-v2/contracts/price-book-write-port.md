# Contract — `priceBookWritePort` (FR-049; owner ruling 2026-10-22)

The in-process port through which another module writes a product's **base prices** on price
books. It replaces `priceListAdminPort`, which this release removes with the old model. Its one
known consumer is the PIM connectors' price import (`pim_ergonode`, maintained outside this
repository). Design and alternatives: `research.md` R16.

## 1. Shape (`@endora-commerce/contracts`, `price-books.ts`)

```ts
/** Container name: `priceBookWritePort`. Owner: `price_lists`. */
interface PriceBookWritePort {
  /** The product's base price per currency, each variant's base row (`null` = inherits). */
  basePrices(productId: string): Promise<ProductBasePrices>;
  /**
   * Replace the product-level base tiers in each named currency; the variants' base rows
   * are left as they are. Currencies not named are untouched.
   */
  replaceProductBaseTiers(
    productId: string,
    tiersByCurrency: Record<string, readonly BasePriceTier[]>,
  ): Promise<ProductBasePrices>;
  /** Replace product and variant base rows per currency — `PUT …/base-prices/:productId`. */
  replaceBasePrices(productId: string, write: BasePricesWrite): Promise<ProductBasePrices>;
  /** The books with a row naming the product (or the variant) directly — G1's list. */
  booksPricingProduct(productId: string, variantId?: string | null): Promise<PriceBookSummary[]>;
}
```

`BasePriceTier` is `{ minQuantity, maxQuantity, amount }` with `amount` a decimal **string** (a
`number` cannot round-trip a price). `ProductBasePrices` is the body of
`GET /api/v1/admin/price-books/base-prices?productId=` (`productBasePricesSchema`).

## 2. Semantics

- **One write path.** Both writes are `PriceBookService.setBasePrices` — one Command Bus run
  (`price_list.base_prices_set`, one audit entry), each touched base book's `version` moved,
  `PricingGeneration` bumped **after** the commit (every process's caches cleared, the price surface
  marked stale). `replaceProductBaseTiers` is the same command with the variants' rows kept: only
  the product-level rows of the named currencies are replaced.
- **Validation is the admin API's** (`planBasePriceRows`): tiers non-negative, starting at a
  positive quantity, `maxQuantity ≥ minQuantity`, windows non-overlapping; at most 50 tiers; a
  variant row must belong to the product; a percent or amount variant row needs the product's own
  base price in that currency — kept rows included, so clearing a product's tiers under a variant
  adjustment is refused. Refusals are the admin API's: `400 VALIDATION_FAILED` with `details`,
  `404 NOT_FOUND` for an unknown product.
- **Currency = the book's.** A base book is addressed by its currency, never by id, so a row cannot
  land in a book of another currency. A currency code is upper-cased; one with no base book **gets
  one, created inside the same command** — exactly what the admin base-price write does (the
  platform default currency's with the id `…d51b` while that id is free). There is no second rule.
- **The summary** is `PriceBookReads.list({ productId, variantId })` over every page, with every
  book visible (the port serves a worker, not a representative): the same `PriceBookSummary` items,
  each with its `matches[]` rows and `tierStarts`, the admin product-editor zone reads (G1).
- **Fails closed.** Registered with `ctx.di.providePort`: resolving it while `price_lists` is absent
  throws `ModuleDisabledError` (503 `MODULE_DISABLED`), so nothing half-executes. The gate is at
  resolution, so a consumer resolves the port per use (`lazyPort`), never holds an instance. `price_lists`
  declares `activation.nonDeactivatable`, so the operator axis never produces that state; the
  platform axis does.
- **No actor of its own.** The caller runs it in the scope it already holds (the PIM import runs as
  a system worker); the audit entry carries whatever actor the Command Bus resolves there, as the
  removed port's writes did.

## 3. Mapping from `priceListAdminPort` (for the PIM maintainers)

| Removed | Replacement |
| --- | --- |
| `getById(priceListId)` | none — a base book is addressed by currency; there is no list to fetch |
| `listProducts(priceListId)` → `{ productId, bracketsByCurrency }[]` | `basePrices(productId)` → `byCurrency[code].product` (and `.variants`) |
| `addProduct(priceListId, productId)` | none — price books have no roster; writing a product's tiers is enough |
| `replaceBrackets(priceListId, productId, bracketsByCurrency)` | `replaceProductBaseTiers(productId, tiersByCurrency)` (variants kept) or `replaceBasePrices(productId, { byCurrency })` |
| `summarizeBracketsForProduct(productId)` → `PriceListBracketSummary[]` | `booksPricingProduct(productId)` → `PriceBookSummary[]` (each with `matches[]`) |

## 4. Verification

`backend/test/integration/price_lists/price-book-write-port.test.ts`: a write through the port then
a resolution answers the written price, at every tier; the batched and single resolutions agree;
the generation is bumped once and after the commit; invalid tiers are refused with nothing written;
variant rows survive `replaceProductBaseTiers`; the summary equals G1's admin list. The fail-closed
case is in `backend/test/integration/price_lists/absent-owner-refuses.test.ts`.
