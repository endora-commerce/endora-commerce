import type { EntityManager } from '@mikro-orm/postgresql';

/**
 * Keeping `price_list_product_lines` equal to the books' rows — feature 161,
 * G15 redesign (`specs/161-price-book-editor/research.md` R14).
 *
 * A product line exists exactly while a book holds a product or variant row
 * of the product. Every write of this module that adds or removes such rows
 * calls {@link syncProductLines} with the products it touched, on the
 * transaction it wrote in, so the line set commits with the rows. Two
 * statements whatever the batch: an insert of the lines that gained a row and
 * a delete of the lines that lost their last one.
 */
export async function syncProductLines(
  em: EntityManager,
  bookIds: readonly string[],
  productIds: readonly string[] | 'all',
): Promise<void> {
  if (bookIds.length === 0 || (productIds !== 'all' && productIds.length === 0)) return;
  const conn = em.getConnection();
  const ctx = em.getTransactionContext();
  const books = `{${[...new Set(bookIds)].join(',')}}`;
  const products = productIds === 'all' ? null : `{${[...new Set(productIds)].join(',')}}`;
  const narrow = (alias: string) => (products ? `and ${alias}."product_id" = any(?::uuid[])` : '');
  await conn.execute(
    `insert into "price_list_product_lines" ("price_list_id", "product_id")
     select distinct e."price_list_id", e."product_id" from "price_list_matrix_entries" e
      where e."price_list_id" = any(?::uuid[]) and e."product_id" is not null ${narrow('e')}
     on conflict do nothing`,
    products ? [books, products] : [books],
    'run',
    ctx,
  );
  await conn.execute(
    `delete from "price_list_product_lines" l
      where l."price_list_id" = any(?::uuid[]) ${narrow('l')}
        and not exists (select 1 from "price_list_matrix_entries" e
                         where e."price_list_id" = l."price_list_id" and e."product_id" = l."product_id")`,
    products ? [books, products] : [books],
    'run',
    ctx,
  );
}

/**
 * The lines of `productId` in every book that no row holds any more — a
 * variant the catalogue deleted took its rows with it (their foreign key
 * cascades) and left the product line behind. Run from the catalogue's
 * `product.updated.v1`.
 */
export async function reconcileProductLines(em: EntityManager, productId: string): Promise<void> {
  await em.getConnection().execute(
    `delete from "price_list_product_lines" l
      where l."product_id" = ?
        and not exists (select 1 from "price_list_matrix_entries" e
                         where e."price_list_id" = l."price_list_id" and e."product_id" = l."product_id")`,
    [productId],
    'run',
    em.getTransactionContext(),
  );
}
