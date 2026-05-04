import type { EntityManager } from '@mikro-orm/postgresql';
import { Product } from '../../../catalog/entities/product.entity.js';
import { StockLevel } from '../../../inventory/entities/stock-level.entity.js';
import type { ImportExportAdapter, ImportRowResult } from '../adapter.js';

/**
 * Stock levels import/export. Reservations are read-only — operators only
 * edit `on_hand`. The variant column is optional; an empty value addresses
 * the simple-product baseline level.
 */
export const stockAdapter: ImportExportAdapter = {
  name: 'stock',
  exportHeader: ['product_sku', 'variant_id', 'on_hand', 'reserved'] as const,

  async exportRows(em: EntityManager): Promise<string[][]> {
    const levels = await em.find(StockLevel, {});
    if (levels.length === 0) return [];
    const productIds = Array.from(new Set(levels.map((l) => l.productId)));
    const products = await em.find(Product, { id: { $in: productIds } });
    const skuByProductId = new Map(products.map((p) => [p.id, p.sku]));
    return levels
      .map<[string, string, string, string] | null>((l) => {
        const sku = skuByProductId.get(l.productId);
        if (!sku) return null;
        return [sku, l.variantId ?? '', String(l.onHand), String(l.reserved)];
      })
      .filter((row): row is [string, string, string, string] => row !== null);
  },

  importHeader: ['product_sku', 'variant_id', 'on_hand'] as const,

  async importRow(em, row): Promise<ImportRowResult> {
    const sku = row['product_sku']?.trim();
    if (!sku) return { ok: false, reason: 'product_sku is required' };
    const product = await em.findOne(Product, { sku });
    if (!product) return { ok: false, reason: `unknown product_sku: ${sku}` };

    const onHandRaw = row['on_hand']?.trim();
    const onHand = onHandRaw ? Number.parseInt(onHandRaw, 10) : NaN;
    if (Number.isNaN(onHand) || onHand < 0) {
      return { ok: false, reason: `invalid on_hand: ${onHandRaw}` };
    }

    const variantId = row['variant_id']?.trim() || null;

    // Backward-compat path: foundation 001 importer does not carry a
    // warehouseId; default to the seeded `Default` warehouse so the
    // legacy import keeps working until US7 ships its own warehouse-
    // scoped importer.
    const DEFAULT_WAREHOUSE_ID = '00000000-0000-4000-8000-00000000d017';
    const where: Record<string, unknown> = {
      productId: product.id,
      warehouseId: DEFAULT_WAREHOUSE_ID,
    };
    if (variantId) where['variantId'] = variantId;
    else where['variantId'] = null;

    const existing = await em.findOne(StockLevel, where);
    if (existing) {
      existing.onHand = onHand;
      return { ok: true };
    }
    em.create(StockLevel, {
      productId: product.id,
      ...(variantId ? { variantId } : {}),
      warehouseId: DEFAULT_WAREHOUSE_ID,
      onHand,
    });
    return { ok: true };
  },
};
