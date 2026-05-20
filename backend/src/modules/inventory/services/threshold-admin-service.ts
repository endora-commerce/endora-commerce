import type { EntityManager } from '@mikro-orm/postgresql';
import { HttpError } from '../../../http/error-envelope.js';
import { InventoryThreshold } from '../entities/inventory-threshold.entity.js';
import { Category } from '../../catalog/entities/category.entity.js';
import { Product } from '../../catalog/entities/product.entity.js';
import type { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
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
    private readonly auditLog?: AuditLogService,
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

    const perCategoryRows = await em.find(Category, {
      $or: [
        { inventoryThresholdHigh: { $ne: null } },
        { inventoryThresholdMedium: { $ne: null } },
        { inventoryThresholdLow: { $ne: null } },
      ],
    });
    const perCategory = perCategoryRows.map((c) => ({
      categoryId: c.id,
      high: c.inventoryThresholdHigh ?? null,
      medium: c.inventoryThresholdMedium ?? null,
      low: c.inventoryThresholdLow ?? null,
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

    if (input.global) {
      await this.applyGlobal(em, input.global);
    }
    if (input.perCategory) {
      for (const c of input.perCategory) {
        await this.applyCategory(em, c);
      }
    }
    if (input.perProduct) {
      for (const p of input.perProduct) {
        await this.applyProduct(em, p);
      }
    }
    await em.flush();
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

  private async applyCategory(
    em: EntityManager,
    patch: { categoryId: string } & ThresholdTriplePartial,
  ): Promise<void> {
    const cat = await em.findOne(Category, { id: patch.categoryId });
    if (!cat) {
      throw new HttpError(404, 'NOT_FOUND', `Category ${patch.categoryId} not found`);
    }
    if (patch.high !== undefined) cat.inventoryThresholdHigh = patch.high;
    if (patch.medium !== undefined) cat.inventoryThresholdMedium = patch.medium;
    if (patch.low !== undefined) cat.inventoryThresholdLow = patch.low;
  }

  private async applyProduct(
    em: EntityManager,
    patch: { productId: string } & ThresholdTriplePartial,
  ): Promise<void> {
    const product = await em.findOne(Product, { id: patch.productId });
    if (!product) {
      throw new HttpError(404, 'PRODUCT_NOT_FOUND', `Product ${patch.productId} not found`);
    }
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
