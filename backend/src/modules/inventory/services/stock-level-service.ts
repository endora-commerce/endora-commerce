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
  /** Effective low-stock threshold resolved per-warehouse (see roster docs). */
  lowStockThreshold: number | null;
}

export interface StockLevelRow {
  productId: string;
  productSku: string;
  productName: string;
  manageStock: boolean;
  backorderEnabled: boolean;
  lowStockThreshold: number | null;
  lowStockThresholdMode: 'cumulative' | 'per_warehouse';
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
    /** Case-insensitive substring search across product SKU, name, and id. */
    q?: string;
    /** When true, return only products whose cumulative on-hand is at or
     *  below the low-stock threshold (and >0 — out-of-stock is its own filter). */
    lowOnly?: boolean;
    /** When true, return only products whose cumulative on-hand is 0
     *  (and `manageStock = true` — backorderable / unmanaged products
     *  aren't considered out). */
    outOnly?: boolean;
  } = {}): Promise<{ items: StockLevelRow[]; page: number; pageSize: number; total: number }> {
    const em = this.emFactory();
    const page = Math.max(0, filter.page ?? 0);
    const pageSize = Math.min(Math.max(1, filter.pageSize ?? 50), 500);

    // The visible roster is per-product (one row aggregates all warehouses
    // for that product), so we paginate over products — not over the raw
    // `stock_levels` rows. Building a single SQL aggregate gets us:
    //  1. A consistent `total` that matches the displayed item count.
    //  2. A place to push down the SKU/name search and low/out filters
    //     instead of post-filtering on the JS side.
    const knex = em.getKnex();
    const trimmedQ = filter.q?.trim().toLowerCase();

    const baseQuery = knex({ p: 'products' })
      .innerJoin({ sl: 'stock_levels' }, 'sl.product_id', 'p.id')
      .modify((qb) => {
        if (filter.productId) qb.where('p.id', filter.productId);
        if (filter.warehouseId) qb.where('sl.warehouse_id', filter.warehouseId);
        if (trimmedQ) {
          const needle = `%${trimmedQ}%`;
          qb.andWhere((inner) => {
            inner
              .whereRaw('LOWER("p"."sku") LIKE ?', [needle])
              .orWhereRaw('LOWER("p"."name"::text) LIKE ?', [needle])
              .orWhereRaw('LOWER("p"."id"::text) LIKE ?', [needle]);
          });
        }
      })
      .groupBy('p.id', 'p.sku', 'p.manage_stock', 'p.low_stock_threshold')
      .modify((qb) => {
        if (filter.outOnly) {
          qb.havingRaw('"p"."manage_stock" IS NOT FALSE AND COALESCE(SUM("sl"."on_hand"), 0) <= 0');
        } else if (filter.lowOnly) {
          qb.havingRaw(
            '"p"."manage_stock" IS NOT FALSE AND "p"."low_stock_threshold" IS NOT NULL AND COALESCE(SUM("sl"."on_hand"), 0) > 0 AND COALESCE(SUM("sl"."on_hand"), 0) <= "p"."low_stock_threshold"',
          );
        }
      });

    // Total count of matching products. We wrap the grouped query in a
    // subselect so `count(*)` counts groups, not rows.
    const totalRow = (await knex
      .from(baseQuery.clone().select('p.id'))
      .as('grouped')
      .count<{ count: string | number }>('* as count')
      .first()) as { count: string | number } | undefined;
    const total = Number(totalRow?.count ?? 0);

    const idRows = (await baseQuery
      .clone()
      .select<Array<{ id: string }>>('p.id')
      .orderByRaw('MAX("sl"."updated_at") DESC')
      .offset(page * pageSize)
      .limit(pageSize)) as Array<{ id: string }>;
    const productIds = idRows.map((r) => r.id);
    if (productIds.length === 0) {
      return { items: [], page, pageSize, total };
    }

    // Pull cumulative across ALL warehouses for the candidate products so the
    // band/threshold logic uses the right total even if the filter narrowed
    // the row set.
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

    // Pull every per-(product, warehouse) low-stock threshold for the
    // candidate products in a single round-trip. `null` means there is
    // no explicit row; callers fall back to the warehouse default.
    const perWarehouseThresholdRows = (await knex('product_warehouse_low_stock_thresholds')
      .whereIn('product_id', productIds)
      .select<
        Array<{ product_id: string; warehouse_id: string; threshold: number | string }>
      >('product_id', 'warehouse_id', 'threshold')) as Array<{
      product_id: string;
      warehouse_id: string;
      threshold: number | string;
    }>;
    const explicitPerWarehouseThreshold = new Map<string, number>();
    for (const row of perWarehouseThresholdRows) {
      explicitPerWarehouseThreshold.set(
        `${row.product_id}:${row.warehouse_id}`,
        Number(row.threshold),
      );
    }

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

      const mode = product.lowStockThresholdMode ?? 'cumulative';

      // Resolve the effective low-stock threshold per warehouse:
      //   1. explicit row in `product_warehouse_low_stock_thresholds`
      //   2. `warehouses.default_low_stock_threshold`
      //   3. null (no threshold for that warehouse)
      // Surfaced regardless of mode so the admin UI can show / edit it.
      const perWarehouseWithThreshold = productCumulative.map((r) => {
        const explicit = explicitPerWarehouseThreshold.get(
          `${productId}:${r.warehouse_id}`,
        );
        const wh = warehouseById.get(r.warehouse_id);
        const resolved =
          explicit !== undefined ? explicit : wh?.defaultLowStockThreshold ?? null;
        return {
          warehouseId: r.warehouse_id,
          warehouseCode: wh?.code ?? '',
          onHand: Number(r.on_hand ?? 0),
          reserved: Number(r.reserved ?? 0),
          lowStockThreshold: resolved,
        };
      });

      // Top-level `lowStockThreshold` + `isLowStock` semantics depend on mode:
      //  - cumulative: one threshold against summed on-hand. Falls back to the
      //    MAX(warehouse.defaultLowStockThreshold) across the product's
      //    warehouses (most-permissive wins) when the product has none.
      //  - per_warehouse: each warehouse evaluated independently; product is
      //    "low" if ANY warehouse has on_hand > 0 and on_hand <= its threshold.
      let topLevelThreshold: number | null;
      let isLowStock = false;
      if (mode === 'per_warehouse') {
        topLevelThreshold = product.lowStockThreshold ?? null;
        for (const pw of perWarehouseWithThreshold) {
          if (
            pw.lowStockThreshold !== null &&
            pw.onHand > 0 &&
            pw.onHand <= pw.lowStockThreshold
          ) {
            isLowStock = true;
            break;
          }
        }
      } else {
        let effective = product.lowStockThreshold ?? null;
        if (effective == null) {
          let warehouseFallback: number | null = null;
          for (const pw of perWarehouseWithThreshold) {
            const wh = warehouseById.get(pw.warehouseId);
            const wt = wh?.defaultLowStockThreshold ?? null;
            if (wt != null && (warehouseFallback == null || wt > warehouseFallback)) {
              warehouseFallback = wt;
            }
          }
          effective = warehouseFallback;
        }
        topLevelThreshold = effective;
        isLowStock =
          effective !== null &&
          cumulativeOnHand > 0 &&
          cumulativeOnHand <= effective;
      }

      items.push({
        productId,
        productSku: product.sku,
        productName: String(productName),
        manageStock: product.manageStock ?? true,
        backorderEnabled: product.backorderEnabled ?? false,
        lowStockThreshold: topLevelThreshold,
        lowStockThresholdMode: mode,
        perWarehouse: perWarehouseWithThreshold,
        cumulativeOnHand,
        displayBand,
        isLowStock: (product.manageStock ?? true) && isLowStock,
        isOutOfStock: (product.manageStock ?? true) && cumulativeOnHand <= 0,
      });
    }

    return { items, page, pageSize, total };
  }

  /**
   * Replace the per-warehouse low-stock threshold map for one product.
   * Entries with `threshold === null` are deleted; the rest are upserted.
   * Warehouse rows not mentioned in `entries` are left untouched (callers
   * that want a hard replace should explicitly include `threshold: null`
   * for every (product, warehouse) they wish to clear).
   */
  async setProductWarehouseThresholds(input: {
    productId: string;
    entries: Array<{ warehouseId: string; threshold: number | null }>;
  }): Promise<void> {
    const em = this.emFactory();
    const product = await em.findOne(Product, { id: input.productId });
    if (!product) {
      throw new HttpError(404, 'PRODUCT_NOT_FOUND', 'Product not found');
    }
    if (input.entries.length === 0) return;

    const warehouseIds = input.entries.map((e) => e.warehouseId);
    const warehouses = await em.find(Warehouse, { id: { $in: warehouseIds } });
    const knownWarehouseIds = new Set(warehouses.map((w) => w.id));
    for (const e of input.entries) {
      if (!knownWarehouseIds.has(e.warehouseId)) {
        throw new HttpError(
          404,
          'WAREHOUSE_NOT_FOUND',
          `Warehouse ${e.warehouseId} not found`,
        );
      }
    }

    const conn = em.getConnection();
    const txCtx = em.getTransactionContext();
    const deletes = input.entries.filter((e) => e.threshold === null);
    const upserts = input.entries.filter(
      (e): e is { warehouseId: string; threshold: number } => e.threshold !== null,
    );

    if (deletes.length > 0) {
      const placeholders = deletes.map(() => '?').join(',');
      await conn.execute(
        `delete from "product_warehouse_low_stock_thresholds"
           where "product_id" = ? and "warehouse_id" in (${placeholders})`,
        [input.productId, ...deletes.map((d) => d.warehouseId)],
        'run',
        txCtx,
      );
    }
    for (const u of upserts) {
      await conn.execute(
        `insert into "product_warehouse_low_stock_thresholds"
           ("product_id", "warehouse_id", "threshold", "created_at", "updated_at")
           values (?, ?, ?, now(), now())
         on conflict ("product_id", "warehouse_id") do update
           set "threshold" = excluded."threshold",
               "updated_at" = now()`,
        [input.productId, u.warehouseId, u.threshold],
        'run',
        txCtx,
      );
    }
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
