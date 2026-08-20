import { randomUUID } from 'crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type BulkUpdateProductsRequest } from '@b2b/contracts';
import { HttpError } from '../../../http/error-envelope.js';
import { rethrowIfModuleDisabled } from '../../../kernel/lifecycle/plugin-helpers.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import type { SalesChannelMembershipService } from '../../../kernel/sales-channels/sales-channel-membership.service.js';
import type { CatalogAdminService} from './catalog-admin.service.js';
import { type AdminAuditContext } from './catalog-admin.service.js';
import { Product } from '../entities/product.entity.js';

/**
 * Feature 022 — Products Bulk Edit.
 *
 * Composes existing module-public services to apply a sparse field-patch
 * to a selection of products and report a per-product outcome. Honours:
 *
 *  - Per-product atomicity (each product writes inside its own transaction).
 *  - No batch abort: a single failure does NOT roll back other products.
 *  - One summary `audit_logs` row per bulk operation; per-product audit
 *    rows are emitted by `CatalogAdminService.updateProduct` as before.
 */

export interface BulkUpdateOutcome {
  productId: string;
  status: 'succeeded' | 'skipped' | 'failed';
  reason?:
    | 'attribute_not_in_set'
    | 'validation_failed'
    | 'permission_denied'
    | 'concurrent_modification'
    | 'product_not_found';
  details?: { code?: string; message?: string; attribute?: string };
  changedFields?: string[];
}

export interface BulkUpdateResult {
  bulkOperationId: string;
  summary: {
    succeeded: number;
    skipped: number;
    failed: number;
    total: number;
  };
  results: BulkUpdateOutcome[];
}

const MAX_BATCH_SIZE = 200;
const RECOMMENDED_SPLIT_INTO = 100;
/** How often the async worker path is told how far the run has progressed. */
const PROGRESS_REPORT_EVERY = 25;

export interface BulkUpdateProgress {
  processed: number;
  total: number;
  succeeded: number;
  skipped: number;
  failed: number;
}

export interface BulkUpdateOptions {
  /**
   * Skip the synchronous MAX_BATCH_SIZE guard. Set by the queued worker
   * path, which is allowed to process arbitrarily large selections off
   * the request thread.
   */
  skipBatchLimit?: boolean;
  /**
   * Invoked periodically (every {@link PROGRESS_REPORT_EVERY} products and
   * once at the end) so the worker can persist live progress counters.
   */
  onProgress?: (progress: BulkUpdateProgress) => Promise<void> | void;
}

export class CatalogBulkUpdateService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly catalogAdmin: CatalogAdminService,
    private readonly salesChannelMembership?: SalesChannelMembershipService,
    private readonly auditLog?: AuditLogService,
  ) {}

  /**
   * Apply `req.fields` to every product in `req.productIds`.
   *
   * Pre-flight (rejects whole request):
   *   - productIds.length > 200            → BULK_TOO_LARGE
   *   - attributeValues key not flagged    → ATTRIBUTE_NOT_MASS_EDITABLE
   *     mass_editable=true
   *
   * Per-product outcomes:
   *   - succeeded                          → all touched fields applied
   *   - skipped, product_not_found         → product id missing in DB
   *   - skipped, attribute_not_in_set      → one of the requested
   *                                          attribute keys is not in
   *                                          the product's attribute set
   *                                          AND no other field changed
   *   - failed,  validation_failed         → any other write rejection
   */
  async bulkUpdate(
    req: BulkUpdateProductsRequest,
    auditCtx?: AdminAuditContext,
    opts?: BulkUpdateOptions,
  ): Promise<BulkUpdateResult> {
    // The synchronous request path caps the selection at MAX_BATCH_SIZE so a
    // single HTTP call never blocks on thousands of writes. The asynchronous
    // worker path (queued bulk operations) passes `skipBatchLimit` because it
    // already chunks progress reporting and runs off the request thread.
    if (!opts?.skipBatchLimit && req.productIds.length > MAX_BATCH_SIZE) {
      throw new HttpError(
        400,
        ERROR_CODES.BULK_TOO_LARGE,
        `productIds.length=${req.productIds.length} exceeds maxBatchSize=${MAX_BATCH_SIZE}`,
        { maxBatchSize: MAX_BATCH_SIZE, recommendedSplitInto: RECOMMENDED_SPLIT_INTO },
      );
    }

    // Pre-flight: every attributeValues key MUST be flagged mass_editable=true.
    // This is a client-side bug (the dialog should never offer a non-flagged
    // attribute), so the whole batch is rejected before any per-product write.
    if (req.fields.attributeValues && Object.keys(req.fields.attributeValues).length > 0) {
      await this.assertAllAttributesAreMassEditable(
        Object.keys(req.fields.attributeValues),
      );
    }

    const bulkOperationId = randomUUID();
    const results: BulkUpdateOutcome[] = [];

    const total = req.productIds.length;
    let processed = 0;
    let succeeded = 0;
    let skipped = 0;
    let failed = 0;
    for (const productId of req.productIds) {
      const outcome = await this.applyToOneProduct(productId, req, auditCtx);
      results.push(outcome);
      processed += 1;
      if (outcome.status === 'succeeded') succeeded += 1;
      else if (outcome.status === 'skipped') skipped += 1;
      else failed += 1;
      if (
        opts?.onProgress &&
        (processed % PROGRESS_REPORT_EVERY === 0 || processed === total)
      ) {
        await opts.onProgress({ processed, total, succeeded, skipped, failed });
      }
    }

    const summary = {
      succeeded: results.filter((r) => r.status === 'succeeded').length,
      skipped: results.filter((r) => r.status === 'skipped').length,
      failed: results.filter((r) => r.status === 'failed').length,
      total: results.length,
    };

    await this.recordSummaryAudit(bulkOperationId, req, results, summary, auditCtx);

    return { bulkOperationId, summary, results };
  }

  // --------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------

  private async assertAllAttributesAreMassEditable(keys: string[]): Promise<void> {
    // Feature 061 — the flag lives on the extension; the key on the definition.
    // Read through the composed view (catalog's sanctioned attribute read).
    const views = await this.catalogAdmin.listAttributes();
    const byKey = new Map(views.map((v) => [v.key, v]));
    for (const key of keys) {
      const view = byKey.get(key);
      if (!view || !view.massEditable) {
        throw new HttpError(
          400,
          ERROR_CODES.ATTRIBUTE_NOT_MASS_EDITABLE,
          `attribute_not_mass_editable`,
          { attribute: key },
        );
      }
    }
  }

  private async applyToOneProduct(
    productId: string,
    req: BulkUpdateProductsRequest,
    auditCtx?: AdminAuditContext,
  ): Promise<BulkUpdateOutcome> {
    const em = this.emFactory();
    const product = await em.findOne(Product, { id: productId });
    if (!product) {
      return { productId, status: 'skipped', reason: 'product_not_found' };
    }

    // Partition attributeValues into those allowed for the product's set
    // and those that must be skipped. Build the partial UpdateProductRequest.
    const fields = req.fields;
    const partial: Record<string, unknown> = {};
    let touchedAny = false;
    let attributeSkipReason: { attribute: string } | null = null;

    if (fields.status !== undefined) {
      partial.status = fields.status;
      touchedAny = true;
    }
    if (fields.visibility !== undefined) {
      partial.visibility = fields.visibility;
      touchedAny = true;
    }

    // Attribute Set — assign (or clear, with null) on every selected product.
    if (fields.attributeSetId !== undefined) {
      partial.attributeSetId = fields.attributeSetId;
      touchedAny = true;
    }

    // Categories — translate {mode, categoryIds} into the partial's
    // categoryIds field (which the single-product PATCH treats as the
    // canonical set when present). For `add` mode, union the target with
    // current memberships before passing through.
    if (fields.categories) {
      if (fields.categories.mode === 'replace') {
        partial.categoryIds = fields.categories.categoryIds;
      } else if (fields.categories.mode === 'remove') {
        const current = await this.readCurrentCategoryIds(em, productId);
        const toRemove = new Set(fields.categories.categoryIds);
        partial.categoryIds = current.filter((id) => !toRemove.has(id));
      } else {
        const current = await this.readCurrentCategoryIds(em, productId);
        const union = Array.from(new Set([...current, ...fields.categories.categoryIds]));
        partial.categoryIds = union;
      }
      touchedAny = true;
    }

    // Attribute values — drop keys that are not in this product's set;
    // surface a skip reason if NO other field is being touched and EVERY
    // attribute write would be dropped.
    if (fields.attributeValues && Object.keys(fields.attributeValues).length > 0) {
      const allowedKeys = await this.readAllowedAttributeKeys(em, product.attributeSetId);
      const allowed: Record<string, unknown> = {};
      const dropped: string[] = [];
      for (const [k, v] of Object.entries(fields.attributeValues)) {
        if (allowedKeys.has(k)) {
          allowed[k] = v;
        } else {
          dropped.push(k);
        }
      }
      if (Object.keys(allowed).length > 0) {
        partial.attributeValues = allowed;
        touchedAny = true;
      }
      if (
        dropped.length > 0 &&
        Object.keys(allowed).length === 0 &&
        fields.status === undefined &&
        fields.visibility === undefined &&
        fields.categories === undefined &&
        fields.salesChannels === undefined &&
        fields.attributeSetId === undefined
      ) {
        // Nothing else to do for this product and at least one attribute
        // was skipped — report skip with the first dropped key for
        // visibility in the response.
        attributeSkipReason = { attribute: dropped[0]! };
      }
    }

    // Apply updateProduct (status / visibility / categories / attributeValues).
    let changedFields: string[] = [];
    if (touchedAny) {
      try {
        await this.catalogAdmin.updateProduct(
          productId,
          partial as unknown as Parameters<CatalogAdminService['updateProduct']>[1],
          auditCtx,
        );
        // The service tracks changedFields internally; from the caller's
        // perspective we report the set of fields we *attempted* to write
        // (the audit row has the canonical changedFields).
        changedFields = Object.keys(partial);
      } catch (err) {
        return this.classifyPerProductError(productId, err);
      }
    }

    // Sales channels run AFTER updateProduct because they live on a
    // different bridge table and use a dedicated service.
    if (fields.salesChannels && this.salesChannelMembership) {
      try {
        const changed = await this.applySalesChannels(
          productId,
          fields.salesChannels.mode,
          fields.salesChannels.channelIds,
        );
        if (changed) {
          changedFields = Array.from(new Set([...changedFields, 'salesChannels']));
        }
      } catch (err) {
        return this.classifyPerProductError(productId, err);
      }
    }

    if (changedFields.length === 0 && attributeSkipReason) {
      return {
        productId,
        status: 'skipped',
        reason: 'attribute_not_in_set',
        details: attributeSkipReason,
      };
    }

    return {
      productId,
      status: 'succeeded',
      changedFields,
      // Surface the skipped attribute when other fields *did* succeed —
      // not strictly required by the contract but useful to the admin.
      ...(attributeSkipReason
        ? { details: { ...attributeSkipReason, message: 'attribute_not_in_set' } }
        : {}),
    };
  }

  private classifyPerProductError(productId: string, err: unknown): BulkUpdateOutcome {
    // The per-product tolerance is right — one product that fails validation
    // must not abandon the other 4 999 — but a presence answer is not per
    // product. `ModuleDisabledError` is an `HttpError`, so without this line it
    // classified as `validation_failed` on every row, and the report read as a
    // data problem in the catalogue rather than a module that is off. Placed
    // here rather than at the two call sites so a third one inherits it.
    rethrowIfModuleDisabled(err);
    if (err instanceof HttpError) {
      if (err.code === ERROR_CODES.PRODUCT_NOT_FOUND) {
        return { productId, status: 'skipped', reason: 'product_not_found' };
      }
      return {
        productId,
        status: 'failed',
        reason: 'validation_failed',
        details: { code: err.code, message: err.message },
      };
    }
    return {
      productId,
      status: 'failed',
      reason: 'validation_failed',
      details: { message: err instanceof Error ? err.message : String(err) },
    };
  }

  private async readCurrentCategoryIds(
    em: EntityManager,
    productId: string,
  ): Promise<string[]> {
    const rows = await em
      .getConnection()
      .execute<Array<{ category_id: string }>>(
        `select category_id from product_categories where product_id = ?`,
        [productId],
        'all',
        em.getTransactionContext(),
      );
    return rows.map((r) => r.category_id);
  }

  private async readAllowedAttributeKeys(
    em: EntityManager,
    attributeSetId: string,
  ): Promise<Set<string>> {
    // Feature 061 — set membership is definition-keyed; keys come from the
    // composed view.
    const rows = await em
      .getConnection()
      .execute<Array<{ custom_field_definition_id: string }>>(
        `select custom_field_definition_id from attribute_set_attributes ` +
          `where attribute_set_id = ?`,
        [attributeSetId],
        'all',
        em.getTransactionContext(),
      );
    const views = await this.catalogAdmin.listAttributes();
    const keyByDefinitionId = new Map(views.map((v) => [v.customFieldDefinitionId, v.key]));
    return new Set(
      rows
        .map((r) => keyByDefinitionId.get(r.custom_field_definition_id))
        .filter((k): k is string => k !== undefined),
    );
  }

  private async applySalesChannels(
    productId: string,
    mode: 'add' | 'replace',
    targetChannelIds: string[],
  ): Promise<boolean> {
    const svc = this.salesChannelMembership!;
    const current = await svc.listChannelsForEntity('product', productId);
    const currentIds = new Set(current.map((c) => c.id));
    const targetSet = new Set(targetChannelIds);
    let changed = false;
    if (mode === 'add') {
      for (const id of targetChannelIds) {
        if (!currentIds.has(id)) {
          const r = await svc.addToChannel(id, 'product', productId);
          if (r.changed) changed = true;
        }
      }
    } else {
      // replace
      for (const id of targetChannelIds) {
        if (!currentIds.has(id)) {
          const r = await svc.addToChannel(id, 'product', productId);
          if (r.changed) changed = true;
        }
      }
      for (const id of currentIds) {
        if (!targetSet.has(id)) {
          const r = await svc.removeFromChannel(id, 'product', productId, {
            fallbackToDefault: true,
          });
          if (r.changed) changed = true;
        }
      }
    }
    return changed;
  }

  private async recordSummaryAudit(
    bulkOperationId: string,
    req: BulkUpdateProductsRequest,
    results: BulkUpdateOutcome[],
    summary: BulkUpdateResult['summary'],
    auditCtx?: AdminAuditContext,
  ): Promise<void> {
    if (!this.auditLog || !auditCtx) return;
    await this.auditLog.record({
      actorAdminUserId: auditCtx.actorAdminUserId,
      ...(auditCtx.impersonatedCustomerAccountId !== undefined
        ? { impersonatedCustomerAccountId: auditCtx.impersonatedCustomerAccountId }
        : {}),
      action: 'product.bulk_update',
      objectType: 'bulk_operation',
      objectId: bulkOperationId,
      stateAfter: {
        selectionIds: req.productIds,
        touchedFields: Object.entries(req.fields)
          .filter(([, v]) => v !== undefined)
          .map(([k]) => k),
        categoryMode: req.fields.categories?.mode ?? null,
        salesChannelMode: req.fields.salesChannels?.mode ?? null,
        resultsSummary: summary,
        perProductOutcomes: results,
      },
      ...(auditCtx.ipAddress !== undefined ? { ipAddress: auditCtx.ipAddress } : {}),
      ...(auditCtx.userAgent !== undefined ? { userAgent: auditCtx.userAgent } : {}),
      ...(auditCtx.requestId !== undefined ? { requestId: auditCtx.requestId } : {}),
    });
  }
}
