import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CatalogCategoryReadPort,
  CatalogCategoryWritePort,
  CatalogProductReadPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { InventoryThreshold } from '../entities/inventory-threshold.entity.js';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { InventoryAuditContext } from '../plugin.js';

export interface ThresholdTriple {
  high: number | null;
  medium: number | null;
  low: number | null;
}

export type ThresholdTriplePartial = {
  high?: number | null | undefined;
  medium?: number | null | undefined;
  low?: number | null | undefined;
};

export interface ThresholdsView {
  global: ThresholdTriple;
  perCategory: Array<ThresholdTriple & { categoryId: string }>;
  perProduct: Array<ThresholdTriple & { productId: string }>;
}

export interface ThresholdsPatch {
  global?: ThresholdTriplePartial;
  perCategory?: Array<{ categoryId: string } & ThresholdTriplePartial>;
  perProduct?: Array<{ productId: string } & ThresholdTriplePartial>;
}

/**
 * ThresholdAdminService (US5 / FR-017).
 *
 * Reads + writes the inventory display-band thresholds. Storage:
 *   - global → singleton row in `inventory_thresholds` (scopeKind='global')
 *   - perCategory → `categories.inventory_threshold_*` columns
 *   - perProduct → `inventory_thresholds` rows with scopeKind='product'
 *
 * The split exists for read-path performance: category thresholds inline
 * with the category row keep the storefront resolver one query light.
 */
export class ThresholdAdminService {
  constructor(
    private readonly emFactory: () => EntityManager,
    /** `catalogCategoryReadPort`, owned by `catalog` (feature 075, Phase C). */
    private readonly catalogCategories: CatalogCategoryReadPort,
    /**
     * `catalogCategoryWritePort`, owned by `catalog`. The per-category half of
     * these thresholds lives in three columns on `catalog`'s `categories` row,
     * so the write belongs to `catalog` and this module hands it the patch.
     */
    private readonly catalogCategoryWrites: CatalogCategoryWritePort,
    /** `catalogProductReadPort`, owned by `catalog` — the per-product existence check. */
    private readonly catalogProducts: CatalogProductReadPort,
    private readonly auditLog?: AuditPort,
  ) {}

  async read(): Promise<ThresholdsView> {
    const em = this.emFactory();

    const globalRow = await em.findOne(InventoryThreshold, {
      scopeKind: 'global',
      scopeId: null,
    });
    const global: ThresholdTriple = {
      high: globalRow?.thresholdHigh ?? 100,
      medium: globalRow?.thresholdMedium ?? 20,
      low: globalRow?.thresholdLow ?? 1,
    };

    const perCategoryRows = await this.catalogCategories.listWithInventoryThresholds();
    const perCategory = perCategoryRows.map((c) => ({
      categoryId: c.id,
      high: c.inventoryThresholdHigh,
      medium: c.inventoryThresholdMedium,
      low: c.inventoryThresholdLow,
    }));

    const perProductRows = await em.find(InventoryThreshold, { scopeKind: 'product' });
    const perProduct = perProductRows.map((r) => ({
      productId: r.scopeId!,
      high: r.thresholdHigh ?? null,
      medium: r.thresholdMedium ?? null,
      low: r.thresholdLow ?? null,
    }));

    return { global, perCategory, perProduct };
  }

  async patch(
    input: ThresholdsPatch,
    auditCtx?: InventoryAuditContext,
  ): Promise<ThresholdsView> {
    const em = this.emFactory();

    // Validate every scope before applying any of it (feature 075, Phase C).
    // The category half is `catalog`'s write now, so it no longer shares this
    // module's flush: an unknown product id used to roll the whole patch back
    // because nothing had been flushed yet, and it still applies nothing —
    // because nothing has been *written* yet.
    if (input.perCategory) {
      for (const c of input.perCategory) {
        const category = await this.catalogCategories.findById(c.categoryId);
        if (!category) {
          throw new HttpError(404, 'NOT_FOUND', `Category ${c.categoryId} not found`);
        }
      }
    }
    if (input.perProduct) {
      for (const p of input.perProduct) {
        const product = await this.catalogProducts.findById(p.productId);
        if (!product) {
          throw new HttpError(404, 'PRODUCT_NOT_FOUND', `Product ${p.productId} not found`);
        }
      }
    }

    if (input.global) {
      await this.applyGlobal(em, input.global);
    }
    if (input.perProduct) {
      for (const p of input.perProduct) {
        await this.applyProduct(em, p);
      }
    }
    await em.flush();
    if (input.perCategory) {
      for (const c of input.perCategory) {
        await this.catalogCategoryWrites.setInventoryThresholds(c.categoryId, {
          ...(c.high !== undefined ? { high: c.high } : {}),
          ...(c.medium !== undefined ? { medium: c.medium } : {}),
          ...(c.low !== undefined ? { low: c.low } : {}),
        });
      }
    }
    const view = await this.read();

    // Feature 024 — audit threshold patches as a single
    // `low_stock_threshold.update` row per request. Bulk patches across
    // global / perCategory / perProduct collapse into one summary row so
    // the dashboard isn't flooded (FR-011, SC-010).
    if (this.auditLog && auditCtx) {
      const touched: Record<string, unknown> = {};
      if (input.global) touched['global'] = input.global;
      if (input.perCategory) touched['perCategoryCount'] = input.perCategory.length;
      if (input.perProduct) touched['perProductCount'] = input.perProduct.length;
      await this.auditLog.record({
        actorAdminUserId: auditCtx.actorAdminUserId,
        ...(auditCtx.impersonatedCustomerAccountId !== undefined
          ? { impersonatedCustomerAccountId: auditCtx.impersonatedCustomerAccountId }
          : {}),
        action: 'low_stock_threshold.update',
        objectType: 'low_stock_threshold',
        objectId: 'global',
        stateAfter: touched,
        ...(auditCtx.ipAddress !== undefined ? { ipAddress: auditCtx.ipAddress } : {}),
        ...(auditCtx.userAgent !== undefined ? { userAgent: auditCtx.userAgent } : {}),
        ...(auditCtx.requestId !== undefined ? { requestId: auditCtx.requestId } : {}),
      });
    }
    return view;
  }

  private async applyGlobal(em: EntityManager, patch: ThresholdTriplePartial): Promise<void> {
    let row = await em.findOne(InventoryThreshold, { scopeKind: 'global', scopeId: null });
    if (!row) {
      row = em.create(InventoryThreshold, { scopeKind: 'global', scopeId: null });
      em.persist(row);
    }
    if (patch.high !== undefined) row.thresholdHigh = patch.high;
    if (patch.medium !== undefined) row.thresholdMedium = patch.medium;
    if (patch.low !== undefined) row.thresholdLow = patch.low;
  }

  private async applyProduct(
    em: EntityManager,
    patch: { productId: string } & ThresholdTriplePartial,
  ): Promise<void> {
    let row = await em.findOne(InventoryThreshold, {
      scopeKind: 'product',
      scopeId: patch.productId,
    });
    if (!row) {
      row = em.create(InventoryThreshold, {
        scopeKind: 'product',
        scopeId: patch.productId,
      });
      em.persist(row);
    }
    if (patch.high !== undefined) row.thresholdHigh = patch.high;
    if (patch.medium !== undefined) row.thresholdMedium = patch.medium;
    if (patch.low !== undefined) row.thresholdLow = patch.low;
  }
}
