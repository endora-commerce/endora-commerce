import type { CatalogProductReadPort } from '@b2b/contracts';
import type {
  ProductLike,
  QuickOrderCatalogLookup,
  VariantBySku,
} from './import-pipeline.js';
import type { VariantLike } from './variant-resolver.js';

/**
 * {@link QuickOrderCatalogLookup} over `catalog`'s published read port
 * (feature 075, Phase C).
 *
 * It used to run three `em.find` calls against `Product` and `ProductVariant`
 * — two tables `catalog` owns — so a switched-off `catalog` still resolved
 * SKUs out of rows deactivation leaves in place, and a CSV import went on
 * recognising products the platform had stopped serving. Each call is now the
 * port's own batched equivalent, and an absent owner refuses at the seam.
 *
 * The three mappings stay here: the pipeline owns the resolution logic and
 * wants only the four or five fields below, so what crosses is narrower than
 * the record.
 */
export class CatalogPortLookup implements QuickOrderCatalogLookup {
  constructor(private readonly catalogProducts: CatalogProductReadPort) {}

  async findProductsBySku(skus: string[]): Promise<ProductLike[]> {
    if (skus.length === 0) return [];
    const products = await this.catalogProducts.findBySkus(skus);
    return products.map((p) => ({
      id: p.id,
      sku: p.sku,
      status: p.status,
      deletedAt: p.deletedAt,
    }));
  }

  async findVariantsBySku(skus: string[]): Promise<VariantBySku[]> {
    if (skus.length === 0) return [];
    const variants = await this.catalogProducts.findVariantsBySkus(skus);
    return variants.map((v) => ({ id: v.id, sku: v.sku, parentProductId: v.parentProductId }));
  }

  async findVariantsByParent(
    productIds: string[],
  ): Promise<Array<VariantLike & { parentProductId: string }>> {
    if (productIds.length === 0) return [];
    const variants = await this.catalogProducts.listVariantsByProductIds(productIds);
    return variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      parentProductId: v.parentProductId,
      variantAttributeValues: v.variantAttributeValues,
    }));
  }
}
