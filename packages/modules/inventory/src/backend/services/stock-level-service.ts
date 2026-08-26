import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogCategoryReadPort,
  CatalogCategoryRecord,
  CatalogProductReadPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { randomUUID } from 'crypto';
import type { EventBus } from '@endora-commerce/platform/events';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { InventoryAuditContext } from '../plugin.js';

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
    /**
     * `catalogProductReadPort`, owned by `catalog` (feature 075, Phase C).
     * Every roster row, every KPI and every band this service computes joins a
     * product it does not own; it used to load the entity, so an operator who
     * switched `catalog` off still got a full stock roster out of it.
     */
    private readonly catalogProducts: CatalogProductReadPort,
    /** `catalogCategoryReadPort`, owned by `catalog` — the threshold chain. */
    private readonly catalogCategories: CatalogCategoryReadPort,
    private readonly eventBus?: EventBus,
    private readonly auditLog?: AuditPort,
  ) {}

  async listLandingKpis(): Promise<InventoryLandingKpis> {
    const em = this.emFactory();

    // `em.execute`, not `em.getKnex()`: a knex handle takes its own pooled
    // connection, so every KPI here would answer from outside a transaction the
    // caller holds open while the port reads below answer from inside it —
    // one screen, two views of the same rows (issue #207).
    const [productsTracked, totalOnHandRow, perWarehouse] = await Promise.all([
      em.execute(`select count(distinct product_id) as count from stock_levels`) as Promise<
        Array<{ count: string }>
      >,
      em.execute(`select sum(on_hand) as sum from stock_levels`) as Promise<
        Array<{ sum: string | null }>
      >,
      em.execute(
        `select w.id, w.code, coalesce(sum(sl.on_hand), 0) as on_hand
           from warehouses w
           left join stock_levels sl on sl.warehouse_id = w.id
          group by w.id, w.code
          order by w.code`,
      ) as Promise<Array<{ id: string; code: string; on_hand: string | null }>>,
    ]);

    const productsByOnHand = (await em.execute(
      `select product_id, sum(on_hand) as on_hand from stock_levels group by product_id`,
    )) as Array<{ product_id: string; on_hand: string | null }>;

    const products = await this.catalogProducts.findByIds(
      productsByOnHand.map((r) => r.product_id),
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
      else if (p.lowStockThreshold !== null && onHand <= p.lowStockThreshold) {
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
    // Both pages run through `em.execute(builder)`, not by awaiting the builder:
    // a knex handle takes its own pooled connection, so the roster a caller
    // inside a transaction is shown would be computed from rows that
    // transaction has not written yet (issue #207). The builder is kept rather
    // than rewritten as a statement because the filters above are assembled at
    // runtime; `execute` compiles it and runs it with the EntityManager's
    // transaction context, so the SQL is byte-for-byte the one this method
    // already sent.
    const totalRows = (await em.execute(
      knex.from(baseQuery.clone().select('p.id')).as('grouped').count('* as count'),
    )) as Array<{ count: string | number }>;
    const total = Number(totalRows[0]?.count ?? 0);

    const idRows = (await em.execute(
      baseQuery
        .clone()
        .select('p.id')
        .orderByRaw('MAX("sl"."updated_at") DESC')
        .offset(page * pageSize)
        .limit(pageSize),
    )) as Array<{ id: string }>;
    const productIds = idRows.map((r) => r.id);
    if (productIds.length === 0) {
      return { items: [], page, pageSize, total };
    }

    // Pull cumulative across ALL warehouses for the candidate products so the
    // band/threshold logic uses the right total even if the filter narrowed
    // the row set.
    const idPlaceholders = productIds.map(() => '?').join(', ');
    const cumulativeRows = (await em.execute(
      `select product_id, warehouse_id, on_hand, reserved
         from stock_levels
        where product_id in (${idPlaceholders})`,
      [...productIds],
    )) as Array<{ product_id: string; warehouse_id: string; on_hand: string; reserved: string }>;

    const products = await this.catalogProducts.findByIds(productIds);
    const productById = new Map(products.map((p) => [p.id, p]));

    const warehouses = await em.find(Warehouse, {});
    const warehouseById = new Map(warehouses.map((w) => [w.id, w]));

    // Asked of `catalog` rather than joined out of its `product_categories`
    // table — see `resolveAvailabilityBands` for the whole reason (feature 075,
    // the `inventory` shard).
    const assignments = await this.catalogCategories.listAssignmentsForProducts(productIds);
    const categoryIdsByProduct = new Map<string, string[]>();
    for (const assignment of assignments) {
      const list = categoryIdsByProduct.get(assignment.productId) ?? [];
      list.push(assignment.categoryId);
      categoryIdsByProduct.set(assignment.productId, list);
    }
    const categoryIds = Array.from(new Set(assignments.map((a) => a.categoryId)));
    const categories = await this.catalogCategories.findByIds(categoryIds);
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    const globalThresholds = await this.loadGlobalThresholds(em);

    // Pull every per-(product, warehouse) low-stock threshold for the
    // candidate products in a single round-trip. `null` means there is
    // no explicit row; callers fall back to the warehouse default.
    const perWarehouseThresholdRows = (await em.execute(
      `select product_id, warehouse_id, threshold
         from product_warehouse_low_stock_thresholds
        where product_id in (${idPlaceholders})`,
      [...productIds],
    )) as Array<{
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
        .filter((c): c is CatalogCategoryRecord => Boolean(c))
        .map((c) => ({
          high: c.inventoryThresholdHigh,
          medium: c.inventoryThresholdMedium,
          low: c.inventoryThresholdLow,
        }));

      const productThresholds = (await this.loadProductThresholds(em, product.id)) ?? null;

      const thresholds = resolveThresholds({
        productThresholds,
        categoryThresholds,
        globalThresholds,
      } satisfies ResolveThresholdsInput);

      const displayBand = resolveDisplayBand({
        manageStock: product.manageStock,
        cumulativeOnHand,
        thresholds,
      });

      const productName =
        (typeof product.name === 'object' && product.name !== null
          ? Object.values(product.name)[0]
          : product.sku) ?? product.sku;

      const mode = product.lowStockThresholdMode;

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
        manageStock: product.manageStock,
        backorderEnabled: product.backorderEnabled,
        lowStockThreshold: topLevelThreshold,
        lowStockThresholdMode: mode,
        perWarehouse: perWarehouseWithThreshold,
        cumulativeOnHand,
        displayBand,
        isLowStock: product.manageStock && isLowStock,
        isOutOfStock: product.manageStock && cumulativeOnHand <= 0,
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
    const product = await this.catalogProducts.findById(input.productId);
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

  async setOnHand(
    input: SetOnHandInput,
    auditCtx?: InventoryAuditContext,
  ): Promise<SetOnHandResult> {
    const em = this.emFactory();
    const product = await this.catalogProducts.findById(input.productId);
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

    // Feature 024 — audit stock adjustments so the dashboard surfaces
    // them. Snapshot carries the SKU + warehouse code so the row stays
    // readable after either reference is renamed.
    if (this.auditLog && auditCtx && before !== input.onHand) {
      await this.auditLog.record({
        actorAdminUserId: auditCtx.actorAdminUserId,
        ...(auditCtx.impersonatedCustomerAccountId !== undefined
          ? { impersonatedCustomerAccountId: auditCtx.impersonatedCustomerAccountId }
          : {}),
        action: 'stock_level.adjust',
        objectType: 'stock_level',
        objectId: `${input.productId}:${input.warehouseId}`,
        stateBefore: { onHand: before },
        stateAfter: {
          productId: input.productId,
          productSku: product.sku,
          warehouseId: input.warehouseId,
          warehouseCode: warehouse.code,
          onHand: input.onHand,
          delta: input.onHand - before,
        },
        ...(auditCtx.ipAddress !== undefined ? { ipAddress: auditCtx.ipAddress } : {}),
        ...(auditCtx.userAgent !== undefined ? { userAgent: auditCtx.userAgent } : {}),
        ...(auditCtx.requestId !== undefined ? { requestId: auditCtx.requestId } : {}),
      });
    }

    return {
      before,
      after: input.onHand,
      productId: input.productId,
      warehouseId: input.warehouseId,
      variantId,
    };
  }

  /**
   * Feature 062 — batch availability indication for the external catalog
   * surface. Mirrors the storefront per-product stock readout: cumulative
   * on-hand (optionally restricted to the channel's candidate warehouses)
   * mapped through the product/category/global threshold chain to a display
   * band; `inStock` is the same channel-public flag the storefront derives
   * (`manageStock && onHand <= 0` ⇒ out of stock). Products with no stock
   * rows still get an entry (out_of_stock or `available` when unmanaged).
   */
  async resolveAvailabilityBands(
    productIds: string[],
    candidateWarehouseIds?: string[],
  ): Promise<Map<string, { band: DisplayBand; inStock: boolean }>> {
    const out = new Map<string, { band: DisplayBand; inStock: boolean }>();
    if (productIds.length === 0) return out;
    const em = this.emFactory();

    const products = await this.catalogProducts.findByIds(productIds);

    // `em.execute`, not `em.getKnex()`: a knex handle carries no transaction
    // context, so the band a caller inside a transaction is shown would be
    // computed from rows that transaction has not written yet (issue #207).
    const productPlaceholders = productIds.map(() => '?').join(', ');
    const warehouseFilter =
      candidateWarehouseIds && candidateWarehouseIds.length > 0
        ? ` and warehouse_id in (${candidateWarehouseIds.map(() => '?').join(', ')})`
        : '';
    const sumRows = (await em.execute(
      `select product_id, sum(on_hand) as on_hand
         from stock_levels
        where product_id in (${productPlaceholders})${warehouseFilter}
        group by product_id`,
      [...productIds, ...(warehouseFilter === '' ? [] : (candidateWarehouseIds ?? []))],
    )) as Array<{ product_id: string; on_hand: string | null }>;
    const onHandByProduct = new Map(sumRows.map((r) => [r.product_id, Number(r.on_hand ?? 0)]));

    const globalThresholds = await this.loadGlobalThresholds(em);
    const productThresholdRows = await em.find(InventoryThreshold, {
      scopeKind: 'product',
      scopeId: { $in: productIds },
    });
    const productThresholdByProduct = new Map(
      productThresholdRows.map((row) => [
        row.scopeId,
        {
          high: row.thresholdHigh ?? null,
          medium: row.thresholdMedium ?? null,
          low: row.thresholdLow ?? null,
        },
      ]),
    );

    // `product_categories` is `catalog`'s bridge table and this module used to
    // join it here in raw SQL — a boundary crossing that names no import
    // specifier, one line above the `findByIds` that already asked the owner
    // the next question (feature 075, the `inventory` shard). The port answers
    // both halves now. No `activeOnly`: a threshold set on a category an
    // operator deactivated still governs the stock band of the products in it,
    // exactly as the join this replaces did.
    const assignments = await this.catalogCategories.listAssignmentsForProducts(productIds);
    const categoryIds = Array.from(new Set(assignments.map((a) => a.categoryId)));
    const categories = await this.catalogCategories.findByIds(categoryIds);
    const categoryById = new Map(categories.map((c) => [c.id, c]));

    for (const product of products) {
      const cumulativeOnHand = onHandByProduct.get(product.id) ?? 0;
      const categoryThresholds = assignments
        .filter((a) => a.productId === product.id)
        .map((a) => categoryById.get(a.categoryId))
        .filter((c): c is CatalogCategoryRecord => Boolean(c))
        .map((c) => ({
          high: c.inventoryThresholdHigh,
          medium: c.inventoryThresholdMedium,
          low: c.inventoryThresholdLow,
        }));
      const thresholds = resolveThresholds({
        productThresholds: productThresholdByProduct.get(product.id) ?? null,
        categoryThresholds,
        globalThresholds,
      });
      const manageStock = product.manageStock;
      const band = resolveDisplayBand({ manageStock, cumulativeOnHand, thresholds });
      out.set(product.id, {
        band,
        inStock: !(manageStock && cumulativeOnHand <= 0),
      });
    }
    return out;
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
