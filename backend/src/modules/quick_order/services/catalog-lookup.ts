import type { EntityManager } from '@mikro-orm/postgresql';
import { Product } from '../../catalog/entities/product.entity.js';
import { ProductVariant } from '../../catalog/entities/product-variant.entity.js';
import type {
  ProductLike,
  QuickOrderCatalogLookup,
  VariantBySku,
} from './import-pipeline.js';
import type { VariantLike } from './variant-resolver.js';

/**
 * MikroORM-backed implementation of {@link QuickOrderCatalogLookup}. Each call
 * is a single batched `$in` query; the pipeline owns the resolution logic.
 */
export class MikroOrmCatalogLookup implements QuickOrderCatalogLookup {
  constructor(private readonly emFactory: () => EntityManager) {}

  async findProductsBySku(skus: string[]): Promise<ProductLike[]> {
    if (skus.length === 0) return [];
    const em = this.emFactory();
    const products = await em.find(Product, { sku: { $in: skus } });
    return products.map((p) => ({
      id: p.id,
      sku: p.sku,
      status: p.status,
      deletedAt: p.deletedAt ?? null,
    }));
  }

  async findVariantsBySku(skus: string[]): Promise<VariantBySku[]> {
    if (skus.length === 0) return [];
    const em = this.emFactory();
    const variants = await em.find(ProductVariant, { sku: { $in: skus } });
    return variants.map((v) => ({ id: v.id, sku: v.sku, parentProductId: v.parentProductId }));
  }

  async findVariantsByParent(
    productIds: string[],
  ): Promise<Array<VariantLike & { parentProductId: string }>> {
    if (productIds.length === 0) return [];
    const em = this.emFactory();
    const variants = await em.find(ProductVariant, { parentProductId: { $in: productIds } });
    return variants.map((v) => ({
      id: v.id,
      sku: v.sku,
      parentProductId: v.parentProductId,
      variantAttributeValues: v.variantAttributeValues,
    }));
  }
}
