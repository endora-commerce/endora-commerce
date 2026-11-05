import type { ProductStatus, ProductType } from '@endora-commerce/contracts';

/**
 * One row of the product browser — a projection of the admin product list's row
 * (`GET /api/v1/admin/catalog/products`), with no price and no stock.
 *
 * The status and type unions are the contracts' own (`productStatusSchema`,
 * `productTypeSchema`), so a value the catalogue adds reaches this type without
 * an edit here.
 */
export type ProductBrowserStatus = ProductStatus;
export type ProductBrowserType = ProductType;

export interface ProductBrowserItem {
  id: string;
  sku: string;
  slug: string;
  /**
   * Feature 174 (FR-031, `contracts/readers.md` §1) — the product's Global name, one string:
   * the admin list has no channel, so it answers no per-language map.
   */
  name: string;
  status: ProductBrowserStatus;
  type: ProductBrowserType;
  /**
   * When the product was archived, `null` when it is not.
   * Archived state is independent of `status`. Optional so a host building an item
   * from a source without it (a line it already holds) need not invent one; absent
   * reads as not archived.
   */
  archivedAt?: string | null | undefined;
}
