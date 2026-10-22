import type { CatalogProductMembership, PriceBookSelectionKind } from '@endora-commerce/contracts';

/**
 * The products a price book holds, as a subquery the catalogue embeds —
 * feature 161, G15 redesign (`specs/161-price-book-editor/research.md` R14).
 *
 * This is the **one** piece of this module's SQL that runs inside another
 * module's statement (`catalogProductReadPort.pageProductsByAdminName`, which
 * probes it as a hashed sub-plan while walking its own name index), on the
 * precedent of `CustomFieldListFilterPort.condition`. It reads this module's
 * tables only, so neither module's code names the other's table.
 *
 * Without a kind filter it reads `price_list_product_lines` (one key per
 * line); a `product` or `variant` filter reads the rows, which alone know
 * whether a line holds product rows or variant rows.
 */
export function priceBookMembership(bookId: string, kinds: ReadonlySet<PriceBookSelectionKind> = new Set()): CatalogProductMembership {
  const product = kinds.size === 0 || kinds.has('product');
  const variant = kinds.size === 0 || kinds.has('variant');
  if (product && variant) {
    return { sql: `select l."product_id" from "price_list_product_lines" l where l."price_list_id" = ?`, params: [bookId] };
  }
  return {
    sql: `select e."product_id" from "price_list_matrix_entries" e
           where e."price_list_id" = ? and e."product_id" is not null and e."variant_id" is ${variant ? 'not ' : ''}null`,
    params: [bookId],
  };
}
