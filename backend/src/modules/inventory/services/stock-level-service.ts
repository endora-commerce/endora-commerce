import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '../../../http/error-envelope.js';
import { randomUUID } from 'crypto';
import type { EventBus } from '../../../events/bus.js';

export interface InventoryAdjustedEvent {
  eventId: string;
  occurredAt: string;
  productId: string;
  warehouseId: string;
  variantId: string | null;
  before: number;
  after: number;
}
import { StockLevel } from '../entities/stock-level.entity.js';
import { Warehouse, DEFAULT_WAREHOUSE_ID } from '../entities/warehouse.entity.js';
import { InventoryThreshold } from '../entities/inventory-threshold.entity.js';
import { Product } from '../../catalog/entities/product.entity.js';
import { Category } from '../../catalog/entities/category.entity.js';
import {
  resolveThresholds,
  type ResolveThresholdsInput,
  type ThresholdLevel,
} from './threshold-resolver.js';
import {
  resolveDisplayBand,
  type DisplayBand,
} from './display-band-resolver.js';

export interface PerWarehouseStockRow {
  warehouseId: string;
  warehouseCode: string;
  onHand: number;
  reserved: number;
}

export interface StockLevelRow {
  productId: string;
  productSku: string;
  productName: string;
  manageStock: boolean;
  backorderEnabled: boolean;
  lowStockThreshold: number | null;
  perWarehouse: PerWarehouseStockRow[];
  cumulativeOnHand: number;
  displayBand: DisplayBand;
  isLowStock: boolean;
  isOutOfStock: boolean;
}

export interface InventoryLandingKpis {
  totalProductsTracked: number;
  totalOnHand: number;
  outOfStockCount: number;
  lowStockCount: number;
  perWarehouseTotals: Array<{
    warehouseId: string;
    warehouseCode: string;
    onHand: number;
  }>;
}

export interface SetOnHandInput {
  productId: string;
  warehouseId: string;
  variantId?: string | null;
  onHand: number;
}

export interface SetOnHandResult {
  before: number;
  after: number;
  productId: string;
  warehouseId: string;
  variantId: string | null;
}

/**
 * StockLevelService (US2) — read + mutate per-(product, warehouse) on-hand.
 *
 * The setter is the single point that emits `inventory.adjusted.v1` so the
 * crossing detector (US4) and the restock fan-out (US6) can react. Reserved
 * counters stay driven by the order service.
 */
export class StockLevelService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly eventBus?: EventBus,
  ) {}

  async listLandingKpis(): Promise<InventoryLandingKpis> {
    const em = this.emFactory();
    const knex = em.getKnex();

    const [productsTracked, totalOnHandRow, perWarehouse] = await Promise.all([
      knex('stock_levels').countDistinct<{ count: string }[]>('product_id as count'),
      knex('stock_levels').sum<{ sum: string | null }[]>('on_hand as sum'),
      knex('warehouses')
        .leftJoin('stock_levels', 'stock_levels.warehouse_id', 'warehouses.id')
        .select<Array<{ id: string; code: string; on_hand: string | null }>>(
          'warehouses.id',
          'warehouses.code',
          knex.raw('coalesce(sum(stock_levels.on_hand), 0) as on_hand'),
        )
        .groupBy('warehouses.id', 'warehouses.code')
        .orderBy('warehouses.code'),
    ]);

    const productsByOnHand = (await knex('stock_levels')
      .select('product_id')
      .sum({ on_hand: 'on_hand' })
      .groupBy('product_id')) as Array<{ product_id: string; on_hand: string | null }>;

    const products = await em.find(
      Product,
      { id: { $in: productsByOnHand.map((r) => r.product_id) } },
      { fields: ['id', 'manageStock', 'lowStockThreshold'] },
    );
    const productById = new Map(products.map((p) => [p.id, p]));
    let outOfStock = 0;
    let lowStock = 0;
    for (const row of productsByOnHand) {
      const p = productById.get(row.product_id);
      if (!p) continue;
      if (!p.manageStock) continue;
      const onHand = Number(row.on_hand ?? 0);
      if (onHand <= 0) outOfStock += 1;
      else if (p.lowStockThreshold !== null && p.lowStockThreshold !== undefined && onHand <= p.lowStockThreshold) {
        lowStock += 1;
      }
    }

    return {
      totalProductsTracked: Number(productsTracked[0]?.count ?? 0),
      totalOnHand: Number(totalOnHandRow[0]?.sum ?? 0),
      outOfStockCount: outOfStock,
      lowStockCount: lowStock,
      perWarehouseTotals: perWarehouse.map((r) => ({
        warehouseId: r.id,
        warehouseCode: r.code,
        onHand: Number(r.on_hand ?? 0),
      })),
    };
  }

  async listRoster(filter: {
    productId?: string;
    warehouseId?: string;
    page?: number;
    pageSize?: number;
  } = {}): Promise<{ items: StockLevelRow[]; page: number; pageSize: number; total: number }> {
    const em = this.emFactory();
    const page = Math.max(0, filter.page ?? 0);
    const pageSize = Math.min(Math.max(1, filter.pageSize ?? 50), 500);

    const where: Record<string, unknown> = {};
    if (filter.productId) where['productId'] = filter.productId;
    if (filter.warehouseId) where['warehouseId'] = filter.warehouseId;

    const [stockRows, total] = await em.findAndCount(StockLevel, where, {
      orderBy: { updatedAt: 'desc' },
      offset: page * pageSize,
      limit: pageSize,
    });

    const productIds = Array.from(new Set(stockRows.map((r) => r.productId)));
    if (productIds.length === 0) {
      return { items: [], page, pageSize, total };
    }

    // Pull cumulative across ALL warehouses for the candidate products so the
    // band/threshold logic uses the right total even if the filter narrowed
    // the row set.
    const knex = em.getKnex();
    const cumulativeRows = await knex('stock_levels')
      .whereIn('product_id', productIds)
      .select<Array<{ product_id: string; warehouse_id: string; on_hand: string; reserved: string }>>(
        'product_id',
        'warehouse_id',
        'on_hand',
        'reserved',
      );

    const products = await em.find(Product, { id: { $in: productIds } });
    const productById = new Map(products.map((p) => [p.id, p]));

    const warehouses = await em.find(Warehouse, {});
    const warehouseById = new Map(warehouses.map((w) => [w.id, w]));

    const productCategoryRows = await knex('product_categories')
      .whereIn('product_id', productIds)
      .select<Array<{ product_id: string; category_id: string }>>('product_id', 'category_id');
    const categoryIdsByProduct = new Map<string, string[]>();
    for (const row of productCategoryRows) {
      const list = categoryIdsByProduct.get(row.product_id) ?? [];
      list.push(row.category_id);
      categoryIdsByProduct.set(row.product_id, list);
    }
    const categoryIds = Array.from(new Set(productCategoryRows.map((r) => r.category_id)));
    const categories = categoryIds.length
      ? await em.find(Category, { id: { $in: categoryIds } })
      : [];
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    const globalThresholds = await this.loadGlobalThresholds(em);

    const items: StockLevelRow[] = [];
    for (const productId of productIds) {
      const product = productById.get(productId);
      if (!product) continue;
      const productCumulative = cumulativeRows.filter((r) => r.product_id === productId);
      const cumulativeOnHand = productCumulative.reduce(
        (sum, r) => sum + Number(r.on_hand ?? 0),
        0,
      );

      const productCategoryIds = categoryIdsByProduct.get(product.id) ?? [];
      const categoryThresholds = productCategoryIds
        .map((cid) => categoryById.get(cid))
        .filter((c): c is Category => Boolean(c))
        .map((c) => ({
          high: c.inventoryThresholdHigh ?? null,
          medium: c.inventoryThresholdMedium ?? null,
          low: c.inventoryThresholdLow ?? null,
        }));

      const productThresholds = (await this.loadProductThresholds(em, product.id)) ?? null;

      const thresholds = resolveThresholds({
        productThresholds,
        categoryThresholds,
        globalThresholds,
      } satisfies ResolveThresholdsInput);

      const displayBand = resolveDisplayBand({
        manageStock: product.manageStock ?? true,
        cumulativeOnHand,
        thresholds,
      });

      const productName =
        (typeof product.name === 'object' && product.name !== null
          ? Object.values(product.name)[0]
          : product.sku) ?? product.sku;

      items.push({
        productId,
        productSku: product.sku,
        productName: String(productName),
        manageStock: product.manageStock ?? true,
        backorderEnabled: product.backorderEnabled ?? false,
        lowStockThreshold: product.lowStockThreshold ?? null,
        perWarehouse: productCumulative.map((r) => ({
          warehouseId: r.warehouse_id,
          warehouseCode: warehouseById.get(r.warehouse_id)?.code ?? '',
          onHand: Number(r.on_hand ?? 0),
          reserved: Number(r.reserved ?? 0),
        })),
        cumulativeOnHand,
        displayBand,
        isLowStock:
          (product.manageStock ?? true) &&
          product.lowStockThreshold !== null &&
          product.lowStockThreshold !== undefined &&
          cumulativeOnHand > 0 &&
          cumulativeOnHand <= product.lowStockThreshold,
        isOutOfStock: (product.manageStock ?? true) && cumulativeOnHand <= 0,
      });
    }

    return { items, page, pageSize, total };
  }

  async setOnHand(input: SetOnHandInput): Promise<SetOnHandResult> {
    const em = this.emFactory();
    const product = await em.findOne(Product, { id: input.productId });
    if (!product) throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found');

    const warehouse = await em.findOne(Warehouse, { id: input.warehouseId });
    if (!warehouse) throw new HttpError(404, 'WAREHOUSE_NOT_FOUND', 'Warehouse not found');

    const variantId = input.variantId ?? null;
    let row = await em.findOne(StockLevel, {
      productId: input.productId,
      warehouseId: input.warehouseId,
      variantId,
    });
    const before = row?.onHand ?? 0;
    if (row) {
      row.onHand = input.onHand;
    } else {
      row = em.create(StockLevel, {
        productId: input.productId,
        warehouseId: input.warehouseId,
        ...(variantId ? { variantId } : {}),
        onHand: input.onHand,
      });
    }
    await em.persistAndFlush(row);

    if (this.eventBus && before !== input.onHand) {
      this.eventBus.emit('inventory.adjusted.v1', {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        productId: input.productId,
        warehouseId: input.warehouseId,
        variantId,
        before,
        after: input.onHand,
      } as never);
    }

    return {
      before,
      after: input.onHand,
      productId: input.productId,
      warehouseId: input.warehouseId,
      variantId,
    };
  }

  private async loadGlobalThresholds(em: EntityManager): Promise<ThresholdLevel> {
    const row = await em.findOne(InventoryThreshold, { scopeKind: 'global', scopeId: null });
    return {
      high: row?.thresholdHigh ?? 100,
      medium: row?.thresholdMedium ?? 20,
      low: row?.thresholdLow ?? 1,
    };
  }

  private async loadProductThresholds(
    em: EntityManager,
    productId: string,
  ): Promise<{ high: number | null; medium: number | null; low: number | null } | undefined> {
    const row = await em.findOne(InventoryThreshold, { scopeKind: 'product', scopeId: productId });
    if (!row) return undefined;
    return {
      high: row.thresholdHigh ?? null,
      medium: row.thresholdMedium ?? null,
      low: row.thresholdLow ?? null,
    };
  }
}

export { DEFAULT_WAREHOUSE_ID };
