import { Entity, PrimaryKey } from '@mikro-orm/core';
import { RuleScoped } from '@endora-commerce/platform/tenancy';

/**
 * One product line of a price book (feature 161, G15 redesign,
 * `specs/161-price-book-editor/research.md` R14): the book holds a product or a
 * variant row of the product. Derived from `price_list_matrix_entries` and kept
 * equal to its `distinct price_list_id, product_id` by this module's writes, in
 * their own transactions (`services/price-book-product-lines.ts`); both foreign
 * keys cascade. The grid counts a book's product lines here and hands the
 * catalogue their membership (`services/price-book-membership.ts`).
 *
 * **`@RuleScoped()`**, as the rows it is derived from are.
 */
@RuleScoped()
@Entity({ tableName: 'price_list_product_lines' })
export class PriceListProductLine {
  @PrimaryKey({ type: 'uuid' })
  priceListId!: string;

  @PrimaryKey({ type: 'uuid' })
  productId!: string;
}
