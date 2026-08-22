import type { FastifyInstance, FastifyRequest } from 'fastify';
import {
  assignAttributesRequestSchema,
  batchByIdProductsRequestSchema,
  bulkUpdateProductsRequestSchema,
  resolveProductIdsRequestSchema,
  createAttributeRequestSchema,
  createAttributeSetRequestSchema,
  createCategoryRequestSchema,
  createAttachmentRequestSchema,
  createPackagingUnitRequestSchema,
  updatePackagingUnitRequestSchema,
  reorderPackagingUnitsRequestSchema,
  createAttachmentTypeRequestSchema,
  createGalleryItemRequestSchema,
  createProductRequestSchema,
  createVariantRequestSchema,
  reorderGalleryRequestSchema,
  bulkCreateLinksRequestSchema,
  reorderLinksRequestSchema,
  productLinkKindSchema,
  createGroupedItemRequestSchema,
  updateGroupedItemRequestSchema,
  createBundleSlotRequestSchema,
  updateBundleSlotRequestSchema,
  createBundleSlotOptionRequestSchema,
  updateAttachmentRequestSchema,
  updateAttachmentTypeRequestSchema,
  updateAttributeRequestSchema,
  updateAttributeSetRequestSchema,
  updateCategoryRequestSchema,
  updateGalleryItemRequestSchema,
  updateProductRequestSchema,
  updateVariantRequestSchema,
  ERROR_CODES,
} from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { CatalogAdminService } from './services/catalog-admin.service.js';
import type { CatalogBulkUpdateService } from './services/catalog-bulk-update.service.js';
import type { BulkOperationService } from './services/bulk-operation.service.js';
import type { BulkOperationStatus } from './entities/bulk-operation.entity.js';
import { dbToApiAttributeType } from './services/catalog-admin.service.js';
import type { CategoryAdminService } from './services/category-admin.service.js';
import type { AttributeSetService } from './services/attribute-set.service.js';
import type { GalleryService } from './services/gallery.service.js';
import type { AttachmentService } from './services/attachment.service.js';
import type { PackagingUnitService } from './services/packaging-unit.service.js';
import type { ProductLinkService } from './services/product-link.service.js';
import type { GroupedService } from './services/grouped.service.js';
import type { BundleService } from './services/bundle.service.js';
import type { ProductScopeContextService } from './services/product-scope-context.service.js';
import type { ProductEditorPreferencesService } from './services/product-editor-preferences.service.js';
import type { ProductValueResolverService } from './services/product-value-resolver.service.js';
import type { ProductOverridesService } from './services/product-overrides.service.js';
import { productValueOverridesPatchRequestSchema } from '@b2b/contracts';
import type { AuditPort } from '../../kernel/ports/audit.js';
import type { ProductVariant } from './entities/product-variant.entity.js';
import type { Product } from './entities/product.entity.js';
import type { CatalogAttributeView } from './services/catalog-attribute-read.service.js';
import type { AttributeOptionResult } from './commands/attribute-commands.js';
import type { Category } from './entities/category.entity.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Admin write surface for the catalog. Every route is gated by an admin session
 * with the `catalog:write` permission — wiring for permission enforcement is
 * finalised in US4 (T188). Until then the plugin accepts any authenticated admin.
 */

/**
 * Selections larger than this are delegated to a background bulk
 * operation rather than applied inline (when the queue is wired). Kept
 * comfortably below the synchronous MAX_BATCH_SIZE so the inline path is
 * always fast.
 */
const BULK_ASYNC_THRESHOLD = 50;

const BULK_OPERATION_STATUSES: readonly BulkOperationStatus[] = [
  'pending',
  'running',
  'completed',
  'failed',
];

function isBulkOperationStatus(value: string): value is BulkOperationStatus {
  return (BULK_OPERATION_STATUSES as readonly string[]).includes(value);
}

export interface CatalogAdminDeps {
  adminService: CatalogAdminService;
  /** Optional — wired by the catalog plugin once instantiated. */
  categoryAdminService?: CategoryAdminService;
  /**
   * Feature 002 — AttributeSet admin CRUD. Optional so dev/test composition
   * roots can wire it up progressively without breaking foundation-era
   * setups. When omitted, the attribute-set endpoints are NOT registered.
   */
  attributeSetService?: AttributeSetService;
  /**
   * Feature 002 — Gallery admin CRUD (US3). Optional for the same
   * progressive-rollout reason as `attributeSetService`.
   */
  galleryService?: GalleryService;
  /** Feature 002 — Attachments admin CRUD (US3). */
  attachmentService?: AttachmentService;
  /** Feature 043 — Packaging units admin CRUD. */
  packagingUnitService?: PackagingUnitService;
  /** Feature 002 — Product Links admin CRUD (US4). */
  productLinkService?: ProductLinkService;
  /** Feature 002 — Grouped product children admin CRUD (US5). */
  groupedService?: GroupedService;
  /** Feature 002 — Bundle slots + options admin CRUD (US5). */
  bundleService?: BundleService;
  /**
   * Feature 023 — per-Sales-Channel + per-Language product scope
   * context endpoint backing the product edit page switchers. When
   * omitted, the scope-context route is NOT registered (back-compat).
   */
  productScopeContextService?: ProductScopeContextService;
  /**
   * Feature 023 — editor preference upsert backing the remembered
   * switcher state. Optional same reason as above.
   */
  productEditorPreferencesService?: ProductEditorPreferencesService;
  /**
   * Feature 023 — resolver wrapper used by the modified
   * `GET /admin/products/:id` to attach a `resolved` preview block
   * when `channelId` / `languageCode` are passed.
   */
  productValueResolverService?: ProductValueResolverService;
  /**
   * Feature 023 — channel-aware override CRUD. Powers the
   * `PATCH /admin/products/:id/value-overrides` endpoint. Optional so
   * the read-only path (GET value-overrides) can ship without the
   * write surface in dev/test setups that haven't wired it yet.
   */
  productOverridesService?: ProductOverridesService;
  /**
   * Feature 022 (products bulk edit) — POST /products/bulk-update. Optional
   * so tests / dev composition roots that don't yet wire the service stay
   * green; the route is only registered when this dep is present.
   */
  bulkUpdateService?: CatalogBulkUpdateService;
  /**
   * Queued bulk-edit. When present, selections above
   * {@link BULK_ASYNC_THRESHOLD} are enqueued as background operations
   * instead of being applied inline, and the bulk-operations
   * list/detail endpoints are registered. Optional so dev/test
   * composition roots can omit the queue infrastructure.
   */
  bulkOperationService?: BulkOperationService;
  /**
   * PreHandler gate — supplied by the composition root. Set to the real
   * `requireAdmin('catalog:write')` factory at server boot. Optional so tests
   * and dev-mode servers can wire this up progressively.
   */
  requireAdmin: RequireAdminFactory;
  /**
   * Resolves an admin actor (admin user id, optional impersonated customer)
   * for audit-log entries — passed through to the catalog admin service.
   */
  resolveAdminAuditContext?: (req: FastifyRequest) => {
    actorAdminUserId: string;
    impersonatedCustomerAccountId?: string | null;
  };
  /**
   * Audit-log writer used by the route layer to emit FR-084 entries for
   * every catalog mutation introduced in feature 002 (AttributeSet,
   * Gallery, Attachment, ProductLink, GroupedItem, BundleSlot CRUD).
   * Optional so tests that don't wire it up stay green.
   */
  auditLogService?: AuditPort;
}

export async function registerCatalogAdminRoutes(
  app: FastifyInstance,
  deps: CatalogAdminDeps,
): Promise<void> {
  const { adminService, requireAdmin } = deps;

  /**
   * Feature 002 T155 — fire-and-forget audit log helper used by the
   * sub-resource handlers (AttributeSet, Gallery, Attachment,
   * ProductLink, GroupedItem, BundleSlot CRUD). The product CRUD path
   * (T060/T065-era) does its own audit emission inside `CatalogAdminService`;
   * this helper covers everything else without a service-layer rewrite.
   *
   * Silently no-ops when either `auditLogService` or
   * `resolveAdminAuditContext` is missing (dev/test setups), so the
   * call site is safe to drop in everywhere.
   */
  const auditEmit = async (
    request: FastifyRequest,
    opts: {
      action: string;
      objectType: string;
      objectId: string;
      stateAfter?: Record<string, unknown> | null;
    },
  ): Promise<void> => {
    if (!deps.auditLogService) return;
    const ctx = deps.resolveAdminAuditContext?.(request);
    await deps.auditLogService.record({
      action: opts.action,
      objectType: opts.objectType,
      objectId: opts.objectId,
      ...(ctx?.actorAdminUserId !== undefined
        ? { actorAdminUserId: ctx.actorAdminUserId }
        : {}),
      ...(ctx?.impersonatedCustomerAccountId !== undefined
        ? { impersonatedCustomerAccountId: ctx.impersonatedCustomerAccountId }
        : {}),
      ...(opts.stateAfter !== undefined ? { stateAfter: opts.stateAfter } : {}),
      ...(request.ip !== undefined ? { ipAddress: request.ip } : {}),
      ...(typeof request.headers['user-agent'] === 'string'
        ? { userAgent: request.headers['user-agent'] }
        : {}),
      requestId: request.id,
    });
  };

  app.post(
    '/api/v1/admin/catalog/products',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: createProductRequestSchema },
    },
    async (request, reply) => {
      const body = createProductRequestSchema.parse(request.body);
      const auditCtx = deps.resolveAdminAuditContext?.(request);
      const product = await adminService.createProduct(
        body,
        auditCtx
          ? {
              actorAdminUserId: auditCtx.actorAdminUserId,
              impersonatedCustomerAccountId: auditCtx.impersonatedCustomerAccountId ?? null,
              ipAddress: request.ip ?? null,
              userAgent:
                typeof request.headers['user-agent'] === 'string'
                  ? request.headers['user-agent']
                  : null,
              requestId: request.id,
            }
          : undefined,
      );
      reply.status(201);
      return { data: serializeAdminProduct(product) };
    },
  );

  app.patch<{ Params: { id: string } }>(
    '/api/v1/admin/catalog/products/:id',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: updateProductRequestSchema },
    },
    async (request) => {
      const body = updateProductRequestSchema.parse(request.body);
      // Feature 054 — audited co-transactionally via the Command Bus; the actor
      // is derived from the ambient TenantContext (not from the request body).
      const product = await adminService.updateProductAudited(request.params.id, body);
      return { data: serializeAdminProduct(product) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/catalog/products/:id',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      const auditCtx = deps.resolveAdminAuditContext?.(request);
      await adminService.deleteProduct(
        request.params.id,
        auditCtx
          ? {
              actorAdminUserId: auditCtx.actorAdminUserId,
              impersonatedCustomerAccountId: auditCtx.impersonatedCustomerAccountId ?? null,
              ipAddress: request.ip ?? null,
              userAgent:
                typeof request.headers['user-agent'] === 'string'
                  ? request.headers['user-agent']
                  : null,
              requestId: request.id,
            }
          : undefined,
      );
      return reply.status(204).send();
    },
  );

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/catalog/products/:id/duplicate',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      const dup = await adminService.duplicateProduct(request.params.id);
      await auditEmit(request, {
        action: 'product.duplicate',
        objectType: 'product',
        objectId: dup.id,
        stateAfter: { sourceProductId: request.params.id, sku: dup.sku },
      });
      reply.status(201);
      return { data: serializeAdminProduct(dup) };
    },
  );

  // Feature 022 — Products Bulk Edit. Applies a sparse field-patch to a
  // selection of products in one call; returns a per-product outcome.
  //
  // Above BULK_ASYNC_THRESHOLD products the request is delegated to a
  // background bulk operation (when the queue service is wired): the
  // handler returns a 202 ack immediately and the work is finished
  // off-thread, with the requester notified by bell + email on
  // completion. The synchronous path keeps the inline per-product result.
  if (deps.bulkUpdateService) {
    const bulkUpdateService = deps.bulkUpdateService;
    const bulkOperationService = deps.bulkOperationService;
    app.post(
      '/api/v1/admin/catalog/products/bulk-update',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: bulkUpdateProductsRequestSchema },
      },
      async (request, reply) => {
        const body = bulkUpdateProductsRequestSchema.parse(request.body);
        const auditCtx = deps.resolveAdminAuditContext?.(request);

        if (bulkOperationService && body.productIds.length > BULK_ASYNC_THRESHOLD) {
          const op = await bulkOperationService.create({
            requestedByAdminUserId:
              auditCtx?.actorAdminUserId ?? '00000000-0000-0000-0000-000000000000',
            payload: { productIds: body.productIds, fields: body.fields },
          });
          reply.status(202);
          return { data: { queued: true as const, bulkOperationId: op.id, total: op.total } };
        }

        const ctx = auditCtx
          ? {
              actorAdminUserId: auditCtx.actorAdminUserId,
              impersonatedCustomerAccountId: auditCtx.impersonatedCustomerAccountId ?? null,
              ipAddress: request.ip ?? null,
              userAgent:
                typeof request.headers['user-agent'] === 'string'
                  ? request.headers['user-agent']
                  : null,
              requestId: request.id,
            }
          : undefined;
        const result = await bulkUpdateService.bulkUpdate(body, ctx);
        return { data: result };
      },
    );
  }

  // Bulk operations history — list + detail backing the "Bulk actions"
  // admin page (completed / running / pending operations + summaries).
  if (deps.bulkOperationService) {
    const bulkOperationService = deps.bulkOperationService;
    app.get(
      '/api/v1/admin/catalog/bulk-operations',
      { preHandler: requireAdmin('catalog:read') },
      async (request) => {
        const q = request.query as {
          status?: string | string[];
          limit?: string;
          offset?: string;
        };
        const rawStatuses = q.status
          ? Array.isArray(q.status)
            ? q.status
            : [q.status]
          : [];
        const status = rawStatuses.filter(isBulkOperationStatus);
        const limit = q.limit ? Number.parseInt(q.limit, 10) : 25;
        const offset = q.offset ? Number.parseInt(q.offset, 10) : 0;
        const res = await bulkOperationService.list({
          ...(status.length ? { status } : {}),
          limit: Number.isFinite(limit) ? limit : 25,
          offset: Number.isFinite(offset) ? offset : 0,
        });
        return {
          data: res.items,
          pagination: {
            total: res.total,
            limit: Number.isFinite(limit) ? limit : 25,
            offset: Number.isFinite(offset) ? offset : 0,
          },
        };
      },
    );

    app.get(
      '/api/v1/admin/catalog/bulk-operations/:id',
      { preHandler: requireAdmin('catalog:read') },
      async (request) => {
        const { id } = request.params as { id: string };
        const op = await bulkOperationService.get(id);
        if (!op) {
          throw new HttpError(404, ERROR_CODES.NOT_FOUND, `bulk operation ${id} not found`);
        }
        return { data: op };
      },
    );

    // Feature 054 (US2) — undo a reversible bulk edit. Restores every affected
    // product whose current state still matches the operation, reports the rest
    // as conflicts (never clobbered), and audits the undo. 404 when unknown,
    // 409 when not reversible / already reverted.
    app.post(
      '/api/v1/admin/catalog/bulk-operations/:id/undo',
      { preHandler: requireAdmin('catalog:write') },
      async (request) => {
        const { id } = request.params as { id: string };
        const outcome = await bulkOperationService.undo(id);
        if (!outcome.ok) {
          if (outcome.code === 'NOT_FOUND') {
            throw new HttpError(404, ERROR_CODES.NOT_FOUND, `bulk operation ${id} not found`);
          }
          throw new HttpError(
            409,
            ERROR_CODES.VERSION_CONFLICT,
            outcome.code === 'ALREADY_REVERTED'
              ? 'This bulk operation has already been undone.'
              : 'This bulk operation cannot be undone.',
          );
        }
        return {
          data: {
            undoStatus: outcome.undoStatus,
            reverted: outcome.reverted.length,
            conflicts: outcome.conflicts,
          },
        };
      },
    );
  }

  app.post(
    '/api/v1/admin/catalog/attributes',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: createAttributeRequestSchema },
    },
    async (request, reply) => {
      const body = createAttributeRequestSchema.parse(request.body);
      const attr = await adminService.createAttribute(body);
      reply.status(201);
      const optionValues = await adminService.getAttributeOptionValues(attr.id);
      return { data: serializeAdminAttribute(attr, optionValues) };
    },
  );

  app.patch<{ Params: { idOrKey: string } }>(
    '/api/v1/admin/catalog/attributes/:idOrKey',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: updateAttributeRequestSchema },
    },
    async (request) => {
      const body = updateAttributeRequestSchema.parse(request.body);
      const auditCtx = deps.resolveAdminAuditContext?.(request);
      // Accept either UUID (id) or snake_case key — admin UI consumes
      // the API by key, but contract tests round-trip through the id
      // returned on create.
      const attr = await adminService.updateAttributeByIdOrKey(
        request.params.idOrKey,
        body,
        auditCtx,
      );
      const optionValues = await adminService.getAttributeOptionValues(attr.id);
      return { data: serializeAdminAttribute(attr, optionValues) };
    },
  );

  // --- Read endpoints feeding the admin UI ---------------------------------

  app.get(
    '/api/v1/admin/catalog/products',
    { preHandler: requireAdmin('catalog:read') },
    async (request) => {
      const q = (request.query ?? {}) as Record<string, string | undefined>;
      const includeArchived = q['includeArchived'] === '1' || q['includeArchived'] === 'true';
      const statusRaw = q['status'];
      const status =
        statusRaw === 'active' || statusRaw === 'draft' || statusRaw === 'inactive'
          ? statusRaw
          : statusRaw === 'archived'
            ? 'inactive'
            : undefined;
      const typeRaw = q['type'];
      const type =
        typeRaw === 'simple' ||
        typeRaw === 'configurable' ||
        typeRaw === 'grouped' ||
        typeRaw === 'bundle' ||
        typeRaw === 'virtual'
          ? typeRaw
          : undefined;
      const search = q['q']?.trim();
      const categorySlug = q['categorySlug']?.trim();
      const result = await adminService.listProducts({
        includeArchived,
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
        ...(search ? { q: search } : {}),
        ...(categorySlug ? { categorySlug } : {}),
        ...(q['page'] ? { page: Number.parseInt(q['page'], 10) } : {}),
        ...(q['pageSize'] ? { pageSize: Number.parseInt(q['pageSize'], 10) } : {}),
      });
      return {
        data: result.items.map(serializeAdminProduct),
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          // Legacy fields kept for any back-compat consumer that read them.
          cursor: null,
          hasMore: (result.page + 1) * result.pageSize < result.total,
          limit: result.items.length,
        },
        counts: result.counts,
      };
    },
  );

  app.post(
    '/api/v1/admin/catalog/products/resolve-ids',
    {
      preHandler: requireAdmin('catalog:read'),
      schema: { body: resolveProductIdsRequestSchema },
    },
    async (request) => {
      const body = resolveProductIdsRequestSchema.parse(request.body);
      const includeArchived = body.includeArchived ?? true;
      const result = await adminService.resolveProductIds({
        includeArchived,
        ...(body.status ? { status: body.status } : {}),
        ...(body.type ? { type: body.type } : {}),
        ...(body.q ? { q: body.q } : {}),
      });
      return { data: result };
    },
  );

  app.get<{
    Params: { id: string };
    Querystring: {
      channelId?: string;
      languageCode?: string;
      includeOverridesMap?: string | boolean;
    };
  }>(
    '/api/v1/admin/catalog/products/:id',
    { preHandler: requireAdmin('catalog:read') },
    async (request) => {
      const product = await adminService.getProductById(request.params.id);
      const categoryIds = await adminService.getProductCategoryIds(request.params.id);
      const base = { ...serializeAdminProduct(product), categoryIds };
      const channelIdRaw = request.query.channelId;
      const languageCodeRaw = request.query.languageCode;
      const includeOverridesMap =
        request.query.includeOverridesMap === true ||
        request.query.includeOverridesMap === 'true';

      // Feature 022 — attach resolved + overrides blocks when the caller
      // asked for a specific (channel, language) context, or for the
      // full override map. Both pieces are gated on the resolver service
      // being wired (test/dev setups may omit it).
      if (
        deps.productValueResolverService &&
        (channelIdRaw !== undefined || languageCodeRaw !== undefined || includeOverridesMap)
      ) {
        const resolverSvc = deps.productValueResolverService;
        const channelId = channelIdRaw ?? null;
        const languageCode = languageCodeRaw ?? null;
        const ctx = await resolverSvc.makeContext(channelId, languageCode);
        const overrides = await resolverSvc.loadOverrides(product.id);
        const resolved = await resolverSvc.resolveForProduct(product, ctx);
        const decorated: Record<string, unknown> = { ...base };
        if (includeOverridesMap) {
          decorated['overrides'] = overrides.map((o) => ({
            attributeKey: o.attributeKey,
            channelId: o.channelId,
            languageCode: o.languageCode,
            value: o.value,
          }));
        }
        if (channelIdRaw !== undefined || languageCodeRaw !== undefined) {
          decorated['resolved'] = {
            context: { channelId, languageCode },
            name: resolved.values['name'] ?? null,
            description: resolved.values['description'] ?? null,
            attributeValues: Object.fromEntries(
              Object.entries(resolved.values).filter(
                ([k]) => k !== 'name' && k !== 'description',
              ),
            ),
            sources: resolved.sources,
          };
        }
        return { data: decorated };
      }

      return { data: base };
    },
  );

  // -------------------------------------------------------------------------
  // Feature 022 — Product Scope Editor: per Sales Channel + per Language.
  // -------------------------------------------------------------------------

  if (deps.productScopeContextService) {
    const scopeContextSvc = deps.productScopeContextService;
    app.get<{ Params: { id: string } }>(
      '/api/v1/admin/catalog/products/:id/scope-context',
      { preHandler: requireAdmin('catalog:read') },
      async (request) => {
        const ctx = deps.resolveAdminAuditContext?.(request);
        // Editor identity is required for the per-(user, product) prefs;
        // when the composition root cannot resolve an admin actor (e.g.,
        // dev mode without auth), fall back to a fixed UUID — the
        // returned preference block is just `null` in that path.
        const adminUserId =
          ctx?.actorAdminUserId ?? '00000000-0000-0000-0000-000000000000';
        const data = await scopeContextSvc.getContext(request.params.id, adminUserId);
        return { data };
      },
    );
  }

  if (deps.productValueResolverService) {
    const resolverSvc = deps.productValueResolverService;
    app.get<{ Params: { id: string } }>(
      '/api/v1/admin/catalog/products/:id/value-overrides',
      { preHandler: requireAdmin('catalog:read') },
      async (request) => {
        // For a missing product the resolver service does not 404 on
        // its own (it just returns an empty list). Run the lookup
        // through adminService.getProductById so the 404 path stays
        // consistent with every other product-scoped endpoint.
        const product = await adminService.getProductById(request.params.id);
        const overrides = await resolverSvc.loadOverrides(product.id);
        return {
          data: {
            productId: product.id,
            overrides: overrides.map((o) => ({
              attributeKey: o.attributeKey,
              channelId: o.channelId,
              languageCode: o.languageCode,
              value: o.value,
            })),
          },
        };
      },
    );
  }

  if (deps.productOverridesService) {
    const overridesSvc = deps.productOverridesService;
    app.patch<{
      Params: { id: string };
    }>(
      '/api/v1/admin/catalog/products/:id/value-overrides',
      { preHandler: requireAdmin('catalog:write') },
      async (request) => {
        const body = productValueOverridesPatchRequestSchema.parse(request.body);
        const result = await overridesSvc.applyBulk(request.params.id, {
          upserts: body.upserts,
          deletes: body.deletes,
        });
        return {
          data: {
            productId: result.productId,
            applied: result.applied,
            overrides: result.overrides.map((o) => ({
              id: o.id,
              attributeKey: o.attributeKey,
              channelId: o.channelId,
              languageCode: o.languageCode ?? null,
              value: o.value,
              updatedAt: o.updatedAt.toISOString(),
            })),
          },
        };
      },
    );
  }

  if (deps.productEditorPreferencesService && deps.productScopeContextService) {
    const prefSvc = deps.productEditorPreferencesService;
    const scopeContextSvc = deps.productScopeContextService;
    app.put<{
      Params: { id: string };
      Body: { lastChannelId: string | null; lastLanguageCode: string | null };
    }>(
      '/api/v1/admin/catalog/products/:id/editor-preference',
      { preHandler: requireAdmin('catalog:read') },
      async (request) => {
        // Validate the product exists + channel (if any) is assigned to it.
        await adminService.getProductById(request.params.id);
        const ctx = deps.resolveAdminAuditContext?.(request);
        const adminUserId =
          ctx?.actorAdminUserId ?? '00000000-0000-0000-0000-000000000000';
        const body = request.body;
        if (body.lastChannelId) {
          await scopeContextSvc.assertChannelAssignedToProduct(
            request.params.id,
            body.lastChannelId,
          );
        }
        const row = await prefSvc.upsert(adminUserId, request.params.id, {
          lastChannelId: body.lastChannelId,
          lastLanguageCode: body.lastLanguageCode,
        });
        return {
          data: {
            productId: row.productId,
            adminUserId: row.adminUserId,
            lastChannelId: row.lastChannelId ?? null,
            lastLanguageCode: row.lastLanguageCode ?? null,
            updatedAt: row.updatedAt.toISOString(),
          },
        };
      },
    );
  }

  app.post(
    '/api/v1/admin/catalog/products/batch-by-id',
    {
      preHandler: requireAdmin('catalog:read'),
      schema: { body: batchByIdProductsRequestSchema },
    },
    async (request) => {
      const body = batchByIdProductsRequestSchema.parse(request.body);
      const result = await adminService.listProductsByIds({
        ids: body.ids,
        ...(body.page !== undefined ? { page: body.page } : {}),
        ...(body.pageSize !== undefined ? { pageSize: body.pageSize } : {}),
      });
      return {
        data: result.items.map(serializeAdminProduct),
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          hasMore: (result.page + 1) * result.pageSize < result.total,
        },
      };
    },
  );

  app.get(
    '/api/v1/admin/catalog/attributes',
    { preHandler: requireAdmin('catalog:read') },
    async () => {
      const rows = await adminService.listAttributes();
      const optionsByAttr = await adminService.getAttributeOptionValuesByIds(
        rows.map((r) => r.id),
      );
      return {
        data: rows.map((r) => serializeAdminAttribute(r, optionsByAttr.get(r.id) ?? null)),
      };
    },
  );

  // Feature 012 — read by flag for picker consumers (Promotion Rule editor,
  // Compare-page column picker, etc.). Single boolean filter.
  app.get<{ Querystring: { flag?: string } }>(
    '/api/v1/admin/catalog/attributes/by-flag',
    { preHandler: requireAdmin('catalog:read') },
    async (request, reply) => {
      const flag = request.query.flag;
      const allowed = [
        'isSearchable',
        'isFilterable',
        'isComparable',
        'isVariantAxis',
        'isPromoRule',
        'isVisibleOnProductPage',
        'isRequired',
        'isMassEditable',
      ] as const;
      if (!flag || !(allowed as readonly string[]).includes(flag)) {
        reply.status(400);
        return {
          error: {
            code: 'VALIDATION_FAILED',
            message: `flag must be one of ${allowed.join(', ')}`,
          },
        };
      }
      const rows = await adminService.listAttributesByFlag(
        flag as (typeof allowed)[number],
      );
      return {
        data: {
          items: rows.map((r) => ({
            id: r.id,
            key: r.key,
            label: r.label,
            labelDefault: r.labelDefault,
            valueType: r.valueType,
          })),
        },
      };
    },
  );

  // Feature 012 — single attribute read by id or key.
  app.get<{ Params: { idOrKey: string } }>(
    '/api/v1/admin/catalog/attributes/:idOrKey',
    { preHandler: requireAdmin('catalog:read') },
    async (request) => {
      const attr = await adminService.getAttributeByIdOrKey(request.params.idOrKey);
      const optionValues = await adminService.getAttributeOptionValues(attr.id);
      return { data: serializeAdminAttribute(attr, optionValues) };
    },
  );

  // Feature 012 — delete an attribute. Refused while any Attribute Set or
  // product still references it (FR-006).
  app.delete<{ Params: { idOrKey: string } }>(
    '/api/v1/admin/catalog/attributes/:idOrKey',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      await adminService.deleteAttribute(request.params.idOrKey);
      return reply.status(204).send();
    },
  );

  // Feature 012 / US2 — preview a Set swap on a Product. Pure read.
  app.post<{
    Params: { id: string };
    Body: { targetSetId: string | null };
  }>(
    '/api/v1/admin/catalog/products/:id/attribute-set-preview',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const body = (request.body ?? { targetSetId: null }) as { targetSetId: string | null };
      const preview = await adminService.previewAttributeSetSwap(
        request.params.id,
        body.targetSetId ?? null,
      );
      return { data: preview };
    },
  );

  // Feature 012 / US4 — option-list CRUD per contracts/attribute-options.contract.md.
  // Backed by `custom_field_options` since feature 061; `attributeId` stays the
  // attribute (extension) id the admin API has always exposed.
  function serializeOption(o: AttributeOptionResult): Record<string, unknown> {
    return {
      id: o.id,
      attributeId: o.attributeId,
      value: o.value,
      label: o.label,
      labelDefault: o.labelDefault,
      isDefault: o.isDefault,
      sortOrder: o.sortOrder,
      createdAt: o.createdAt.toISOString(),
      updatedAt: o.updatedAt.toISOString(),
    };
  }

  app.get<{ Params: { attributeId: string } }>(
    '/api/v1/admin/catalog/attributes/:attributeId/options',
    { preHandler: requireAdmin('catalog:read') },
    async (request) => {
      const attr = await adminService.getAttributeByIdOrKey(request.params.attributeId);
      const options = await adminService.listAttributeOptions(attr.id);
      return { data: { items: options.map(serializeOption) } };
    },
  );

  app.post<{
    Params: { attributeId: string };
    Body: {
      value: string;
      label?: Record<string, string>;
      labelDefault: string;
      isDefault?: boolean;
      sortOrder?: number;
    };
  }>(
    '/api/v1/admin/catalog/attributes/:attributeId/options',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      const row = await adminService.addAttributeOption(
        request.params.attributeId,
        request.body,
      );
      reply.status(201);
      return { data: serializeOption(row) };
    },
  );

  app.patch<{
    Params: { attributeId: string; optionId: string };
    Body: {
      label?: Record<string, string>;
      labelDefault?: string;
      isDefault?: boolean;
      sortOrder?: number;
    };
  }>(
    '/api/v1/admin/catalog/attributes/:attributeId/options/:optionId',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const row = await adminService.patchAttributeOption(
        request.params.optionId,
        request.body,
      );
      return { data: serializeOption(row) };
    },
  );

  app.delete<{ Params: { attributeId: string; optionId: string } }>(
    '/api/v1/admin/catalog/attributes/:attributeId/options/:optionId',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      await adminService.removeAttributeOption(request.params.optionId);
      return reply.status(204).send();
    },
  );

  // --- Categories CRUD -----------------------------------------------------

  if (deps.categoryAdminService) {
    const categoryService = deps.categoryAdminService;

    app.get(
      '/api/v1/admin/catalog/categories',
      { preHandler: requireAdmin('catalog:read') },
      async () => {
        const rows = await categoryService.listAll();
        return { data: rows.map(serializeAdminCategory) };
      },
    );

    app.post(
      '/api/v1/admin/catalog/categories',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: createCategoryRequestSchema },
      },
      async (request, reply) => {
        const body = createCategoryRequestSchema.parse(request.body);
        const cat = await categoryService.create(body);
        reply.status(201);
        return { data: serializeAdminCategory(cat) };
      },
    );

    app.patch<{ Params: { id: string } }>(
      '/api/v1/admin/catalog/categories/:id',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: updateCategoryRequestSchema },
      },
      async (request) => {
        const body = updateCategoryRequestSchema.parse(request.body);
        const cat = await categoryService.update(request.params.id, {
          ...(body.parentCategoryId !== undefined
            ? { parentCategoryId: body.parentCategoryId }
            : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.slug !== undefined ? { slug: body.slug } : {}),
          ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
          ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
          ...(body.mainImageAssetId !== undefined
            ? { mainImageAssetId: body.mainImageAssetId }
            : {}),
          ...(body.customFieldValues !== undefined
            ? { customFieldValues: body.customFieldValues }
            : {}),
        });
        return { data: serializeAdminCategory(cat) };
      },
    );

    app.delete<{ Params: { id: string } }>(
      '/api/v1/admin/catalog/categories/:id',
      { preHandler: requireAdmin('catalog:write') },
      async (request, reply) => {
        await categoryService.softDelete(request.params.id);
        return reply.status(204).send();
      },
    );
  }

  // ===== Feature 002 — Attribute Sets =========================================
  // contracts/catalog-002.contract.md → 7 endpoints. Wired only when the
  // composition root supplies `attributeSetService` (test-server.ts +
  // production composition root both do; dev shims may opt out).
  if (deps.attributeSetService) {
    const attrSetService = deps.attributeSetService;

    app.get(
      '/api/v1/admin/catalog/attribute-sets',
      { preHandler: requireAdmin('catalog:read') },
      async () => {
        const sets = await attrSetService.listSets();
        return { data: sets };
      },
    );

    app.get<{ Params: { id: string } }>(
      '/api/v1/admin/catalog/attribute-sets/:id',
      { preHandler: requireAdmin('catalog:read') },
      async (request) => {
        const detail = await attrSetService.getSetDetail(request.params.id);
        return { data: detail };
      },
    );

    app.post(
      '/api/v1/admin/catalog/attribute-sets',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: createAttributeSetRequestSchema },
      },
      async (request, reply) => {
        const body = createAttributeSetRequestSchema.parse(request.body);
        // Feature 054/061 — audited co-transactionally inside the service's
        // `attribute_set.create` Command (no hand audit here, Principle XIII).
        const detail = await attrSetService.createSet(body);
        reply.status(201);
        return { data: detail };
      },
    );

    app.patch<{ Params: { id: string } }>(
      '/api/v1/admin/catalog/attribute-sets/:id',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: updateAttributeSetRequestSchema },
      },
      async (request) => {
        const body = updateAttributeSetRequestSchema.parse(request.body);
        // Audited co-transactionally via the `attribute_set.update` Command.
        const set = await attrSetService.updateSet(request.params.id, body);
        return { data: set };
      },
    );

    app.delete<{ Params: { id: string } }>(
      '/api/v1/admin/catalog/attribute-sets/:id',
      { preHandler: requireAdmin('catalog:write') },
      async (request, reply) => {
        // Audited co-transactionally via the `attribute_set.delete` Command.
        await attrSetService.deleteSet(request.params.id);
        return reply.status(204).send();
      },
    );

    app.post<{ Params: { id: string } }>(
      '/api/v1/admin/catalog/attribute-sets/:id/attributes',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: assignAttributesRequestSchema },
      },
      async (request) => {
        const body = assignAttributesRequestSchema.parse(request.body);
        // Audited co-transactionally via the `attribute_set.assign_attributes`
        // Command (feature 061 — the bridge write and audit share one tx).
        const detail = await attrSetService.assignAttributes(request.params.id, body);
        return { data: detail };
      },
    );

    app.delete<{ Params: { id: string; attributeId: string } }>(
      '/api/v1/admin/catalog/attribute-sets/:id/attributes/:attributeId',
      { preHandler: requireAdmin('catalog:write') },
      async (request, reply) => {
        // Audited co-transactionally via the `attribute_set.unassign_attribute`
        // Command (no-op deletes stay 204 and are not double-audited).
        await attrSetService.unassignAttribute(
          request.params.id,
          request.params.attributeId,
        );
        return reply.status(204).send();
      },
    );
  }

  // ===== Feature 002 — Gallery admin CRUD (US3) ==============================
  if (deps.galleryService) {
    const gallery = deps.galleryService;

    app.get<{ Params: { productId: string } }>(
      '/api/v1/admin/catalog/products/:productId/gallery',
      { preHandler: requireAdmin('catalog:read') },
      async (request) => {
        const items = await gallery.list(request.params.productId);
        return { data: items };
      },
    );

    app.post<{ Params: { productId: string }; Querystring: { replace?: string } }>(
      '/api/v1/admin/catalog/products/:productId/gallery',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: createGalleryItemRequestSchema },
      },
      async (request, reply) => {
        const body = createGalleryItemRequestSchema.parse(request.body);
        const item = await gallery.create(request.params.productId, body, {
          replaceConflictingLabels: request.query.replace === 'true',
        });
        reply.status(201);
        await auditEmit(request, {
          action: 'gallery.create',
          objectType: 'gallery_item',
          objectId: item.id,
        });
        return { data: item };
      },
    );

    app.patch<{
      Params: { productId: string; itemId: string };
      Querystring: { replace?: string };
    }>(
      '/api/v1/admin/catalog/products/:productId/gallery/:itemId',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: updateGalleryItemRequestSchema },
      },
      async (request) => {
        const body = updateGalleryItemRequestSchema.parse(request.body);
        const item = await gallery.update(
          request.params.productId,
          request.params.itemId,
          body,
          { replaceConflictingLabels: request.query.replace === 'true' },
        );
        await auditEmit(request, {
          action: 'gallery.update',
          objectType: 'gallery_item',
          objectId: request.params.itemId,
        });
        return { data: item };
      },
    );

    app.delete<{ Params: { productId: string; itemId: string } }>(
      '/api/v1/admin/catalog/products/:productId/gallery/:itemId',
      { preHandler: requireAdmin('catalog:write') },
      async (request, reply) => {
        await gallery.delete(request.params.productId, request.params.itemId);
        await auditEmit(request, {
          action: 'gallery.delete',
          objectType: 'gallery_item',
          objectId: request.params.itemId,
        });
        return reply.status(204).send();
      },
    );

    app.put<{ Params: { productId: string } }>(
      '/api/v1/admin/catalog/products/:productId/gallery/order',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: reorderGalleryRequestSchema },
      },
      async (request, reply) => {
        const body = reorderGalleryRequestSchema.parse(request.body);
        await gallery.reorder(request.params.productId, body.orderedGalleryItemIds);
        await auditEmit(request, {
          action: 'gallery.reorder',
          objectType: 'product',
          objectId: request.params.productId,
        });
        return reply.status(204).send();
      },
    );
  }

  // ===== Feature 002 — Attachments admin CRUD (US3) ==========================
  if (deps.attachmentService) {
    const att = deps.attachmentService;

    app.get(
      '/api/v1/admin/catalog/attachment-types',
      { preHandler: requireAdmin('catalog:read') },
      async () => ({ data: await att.listTypes() }),
    );

    app.post(
      '/api/v1/admin/catalog/attachment-types',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: createAttachmentTypeRequestSchema },
      },
      async (request, reply) => {
        const body = createAttachmentTypeRequestSchema.parse(request.body);
        const type = await att.createType(body);
        reply.status(201);
        await auditEmit(request, {
          action: 'attachment_type.create',
          objectType: 'attachment_type',
          objectId: type.id,
        });
        return { data: type };
      },
    );

    app.patch<{ Params: { id: string } }>(
      '/api/v1/admin/catalog/attachment-types/:id',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: updateAttachmentTypeRequestSchema },
      },
      async (request) => {
        const body = updateAttachmentTypeRequestSchema.parse(request.body);
        const type = await att.updateType(request.params.id, body);
        await auditEmit(request, {
          action: 'attachment_type.update',
          objectType: 'attachment_type',
          objectId: request.params.id,
        });
        return { data: type };
      },
    );

    app.delete<{ Params: { id: string } }>(
      '/api/v1/admin/catalog/attachment-types/:id',
      { preHandler: requireAdmin('catalog:write') },
      async (request, reply) => {
        await att.deleteType(request.params.id);
        await auditEmit(request, {
          action: 'attachment_type.delete',
          objectType: 'attachment_type',
          objectId: request.params.id,
        });
        return reply.status(204).send();
      },
    );

    app.get<{ Params: { productId: string } }>(
      '/api/v1/admin/catalog/products/:productId/attachments',
      { preHandler: requireAdmin('catalog:read') },
      async (request) => ({
        data: await att.listAttachments(request.params.productId),
      }),
    );

    app.post<{ Params: { productId: string } }>(
      '/api/v1/admin/catalog/products/:productId/attachments',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: createAttachmentRequestSchema },
      },
      async (request, reply) => {
        const body = createAttachmentRequestSchema.parse(request.body);
        const a = await att.createAttachment(request.params.productId, body);
        reply.status(201);
        await auditEmit(request, {
          action: 'attachment.create',
          objectType: 'product_attachment',
          objectId: a.id,
        });
        return { data: a };
      },
    );

    app.patch<{ Params: { productId: string; attachmentId: string } }>(
      '/api/v1/admin/catalog/products/:productId/attachments/:attachmentId',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: updateAttachmentRequestSchema },
      },
      async (request) => {
        const body = updateAttachmentRequestSchema.parse(request.body);
        const a = await att.updateAttachment(
          request.params.productId,
          request.params.attachmentId,
          body,
        );
        await auditEmit(request, {
          action: 'attachment.update',
          objectType: 'product_attachment',
          objectId: request.params.attachmentId,
        });
        return { data: a };
      },
    );

    app.delete<{ Params: { productId: string; attachmentId: string } }>(
      '/api/v1/admin/catalog/products/:productId/attachments/:attachmentId',
      { preHandler: requireAdmin('catalog:write') },
      async (request, reply) => {
        await att.deleteAttachment(
          request.params.productId,
          request.params.attachmentId,
        );
        await auditEmit(request, {
          action: 'attachment.delete',
          objectType: 'product_attachment',
          objectId: request.params.attachmentId,
        });
        return reply.status(204).send();
      },
    );
  }

  // ===== Feature 043 — Packaging units admin CRUD ===========================
  if (deps.packagingUnitService) {
    const pkg = deps.packagingUnitService;

    app.get<{ Params: { productId: string } }>(
      '/api/v1/admin/catalog/products/:productId/packaging-units',
      { preHandler: requireAdmin('catalog:read') },
      async (request) => {
        const data = await pkg.list(request.params.productId);
        return { data };
      },
    );

    app.post<{ Params: { productId: string } }>(
      '/api/v1/admin/catalog/products/:productId/packaging-units',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: createPackagingUnitRequestSchema },
      },
      async (request, reply) => {
        const body = createPackagingUnitRequestSchema.parse(request.body);
        const unit = await pkg.create(request.params.productId, body);
        reply.status(201);
        await auditEmit(request, {
          action: 'packaging_unit.create',
          objectType: 'product_packaging_unit',
          objectId: unit.id,
        });
        return { data: unit };
      },
    );

    app.patch<{ Params: { productId: string; unitId: string } }>(
      '/api/v1/admin/catalog/products/:productId/packaging-units/:unitId',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: updatePackagingUnitRequestSchema },
      },
      async (request) => {
        const body = updatePackagingUnitRequestSchema.parse(request.body);
        const unit = await pkg.update(
          request.params.productId,
          request.params.unitId,
          body,
        );
        await auditEmit(request, {
          action: 'packaging_unit.update',
          objectType: 'product_packaging_unit',
          objectId: request.params.unitId,
        });
        return { data: unit };
      },
    );

    app.delete<{ Params: { productId: string; unitId: string } }>(
      '/api/v1/admin/catalog/products/:productId/packaging-units/:unitId',
      { preHandler: requireAdmin('catalog:write') },
      async (request, reply) => {
        await pkg.delete(request.params.productId, request.params.unitId);
        await auditEmit(request, {
          action: 'packaging_unit.delete',
          objectType: 'product_packaging_unit',
          objectId: request.params.unitId,
        });
        return reply.status(204).send();
      },
    );

    app.patch<{ Params: { productId: string } }>(
      '/api/v1/admin/catalog/products/:productId/packaging-units/reorder',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: reorderPackagingUnitsRequestSchema },
      },
      async (request) => {
        const body = reorderPackagingUnitsRequestSchema.parse(request.body);
        const data = await pkg.reorder(request.params.productId, body);
        await auditEmit(request, {
          action: 'packaging_unit.reorder',
          objectType: 'product',
          objectId: request.params.productId,
        });
        return { data };
      },
    );
  }

  // ===== Feature 002 — Variants admin CRUD ===================================
  // contracts/catalog-002.contract.md / spec.md US2: configurable Products
  // need an admin write surface for Variants. Foundation 001 shipped the
  // ProductVariant entity but no routes.

  app.post<{ Params: { productId: string } }>(
    '/api/v1/admin/catalog/products/:productId/variants',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: createVariantRequestSchema },
    },
    async (request, reply) => {
      const body = createVariantRequestSchema.parse(request.body);
      const variant = await adminService.createVariant(request.params.productId, body);
      reply.status(201);
      return { data: serializeAdminVariant(variant) };
    },
  );

  app.patch<{ Params: { productId: string; variantId: string } }>(
    '/api/v1/admin/catalog/products/:productId/variants/:variantId',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: updateVariantRequestSchema },
    },
    async (request) => {
      const body = updateVariantRequestSchema.parse(request.body);
      const variant = await adminService.updateVariant(
        request.params.productId,
        request.params.variantId,
        body,
      );
      return { data: serializeAdminVariant(variant) };
    },
  );

  app.delete<{ Params: { productId: string; variantId: string } }>(
    '/api/v1/admin/catalog/products/:productId/variants/:variantId',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      await adminService.deleteVariant(
        request.params.productId,
        request.params.variantId,
      );
      return reply.status(204).send();
    },
  );

  // --- Product Links (Feature 002 US4) ----------------------------------

  if (deps.productLinkService) {
    const links = deps.productLinkService;

    app.get<{ Params: { id: string }; Querystring: { kind?: string } }>(
      '/api/v1/admin/catalog/products/:id/links',
      { preHandler: requireAdmin('catalog:read') },
      async (request) => {
        const kind = request.query.kind
          ? productLinkKindSchema.parse(request.query.kind)
          : undefined;
        const rows = await links.listForAdmin(request.params.id, kind);
        return { data: rows };
      },
    );

    app.post<{ Params: { id: string } }>(
      '/api/v1/admin/catalog/products/:id/links',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: bulkCreateLinksRequestSchema },
      },
      async (request, reply) => {
        const body = bulkCreateLinksRequestSchema.parse(request.body);
        const rows = await links.bulkCreate(request.params.id, body.links);
        reply.status(201);
        for (const row of rows) {
          await auditEmit(request, {
            action: 'product_link.create',
            objectType: 'product_link',
            objectId: row.id,
            stateAfter: {
              sourceProductId: row.sourceProductId,
              targetProductId: row.targetProductId,
              kind: row.kind,
            },
          });
        }
        return { data: rows };
      },
    );

    app.delete<{ Params: { id: string; linkId: string } }>(
      '/api/v1/admin/catalog/products/:id/links/:linkId',
      { preHandler: requireAdmin('catalog:write') },
      async (request, reply) => {
        await links.removeLink(request.params.id, request.params.linkId);
        await auditEmit(request, {
          action: 'product_link.delete',
          objectType: 'product_link',
          objectId: request.params.linkId,
        });
        return reply.status(204).send();
      },
    );

    app.put<{ Params: { id: string; kind: string } }>(
      '/api/v1/admin/catalog/products/:id/links/:kind/order',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: reorderLinksRequestSchema },
      },
      async (request) => {
        const kind = productLinkKindSchema.parse(request.params.kind);
        const body = reorderLinksRequestSchema.parse(request.body);
        await links.reorderForKind(request.params.id, kind, body.linkIds);
        await auditEmit(request, {
          action: 'product_link.reorder',
          objectType: 'product',
          objectId: request.params.id,
          stateAfter: { kind, linkIds: body.linkIds },
        });
        return { data: { ok: true } };
      },
    );
  }

  // --- Grouped items (Feature 002 US5) ----------------------------------

  if (deps.groupedService) {
    const grouped = deps.groupedService;

    app.get<{ Params: { id: string } }>(
      '/api/v1/admin/catalog/products/:id/grouped-items',
      { preHandler: requireAdmin('catalog:read') },
      async (request) => {
        const rows = await grouped.list(request.params.id);
        return { data: rows };
      },
    );

    app.post<{ Params: { id: string } }>(
      '/api/v1/admin/catalog/products/:id/grouped-items',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: createGroupedItemRequestSchema },
      },
      async (request, reply) => {
        const body = createGroupedItemRequestSchema.parse(request.body);
        const row = await grouped.addItem(request.params.id, {
          childProductId: body.childProductId,
          quantity: body.quantity,
          ...(body.position !== undefined ? { position: body.position } : {}),
        });
        reply.status(201);
        await auditEmit(request, {
          action: 'grouped_item.create',
          objectType: 'grouped_item',
          objectId: row.id,
          stateAfter: {
            parentProductId: row.parentProductId,
            childProductId: row.childProductId,
            quantity: row.quantity,
          },
        });
        return { data: row };
      },
    );

    app.patch<{ Params: { id: string; itemId: string } }>(
      '/api/v1/admin/catalog/products/:id/grouped-items/:itemId',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: updateGroupedItemRequestSchema },
      },
      async (request) => {
        const body = updateGroupedItemRequestSchema.parse(request.body);
        const row = await grouped.updateItem(
          request.params.id,
          request.params.itemId,
          {
            ...(body.quantity !== undefined ? { quantity: body.quantity } : {}),
            ...(body.position !== undefined ? { position: body.position } : {}),
          },
        );
        await auditEmit(request, {
          action: 'grouped_item.update',
          objectType: 'grouped_item',
          objectId: request.params.itemId,
        });
        return { data: row };
      },
    );

    app.delete<{ Params: { id: string; itemId: string } }>(
      '/api/v1/admin/catalog/products/:id/grouped-items/:itemId',
      { preHandler: requireAdmin('catalog:write') },
      async (request, reply) => {
        await grouped.removeItem(request.params.id, request.params.itemId);
        await auditEmit(request, {
          action: 'grouped_item.delete',
          objectType: 'grouped_item',
          objectId: request.params.itemId,
        });
        return reply.status(204).send();
      },
    );
  }

  // --- Bundle slots + options (Feature 002 US5) -------------------------

  if (deps.bundleService) {
    const bundle = deps.bundleService;

    app.get<{ Params: { id: string } }>(
      '/api/v1/admin/catalog/products/:id/bundle-slots',
      { preHandler: requireAdmin('catalog:read') },
      async (request) => {
        const rows = await bundle.listSlots(request.params.id);
        return { data: rows };
      },
    );

    app.post<{ Params: { id: string } }>(
      '/api/v1/admin/catalog/products/:id/bundle-slots',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: createBundleSlotRequestSchema },
      },
      async (request, reply) => {
        const body = createBundleSlotRequestSchema.parse(request.body);
        const row = await bundle.createSlot(request.params.id, {
          name: body.name,
          ...(body.minQuantity !== undefined ? { minQuantity: body.minQuantity } : {}),
          maxQuantity: body.maxQuantity,
          ...(body.position !== undefined ? { position: body.position } : {}),
        });
        reply.status(201);
        await auditEmit(request, {
          action: 'bundle_slot.create',
          objectType: 'bundle_slot',
          objectId: row.id,
        });
        return { data: row };
      },
    );

    app.patch<{ Params: { id: string; slotId: string } }>(
      '/api/v1/admin/catalog/products/:id/bundle-slots/:slotId',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: updateBundleSlotRequestSchema },
      },
      async (request) => {
        const body = updateBundleSlotRequestSchema.parse(request.body);
        const row = await bundle.updateSlot(
          request.params.id,
          request.params.slotId,
          {
            ...(body.name !== undefined ? { name: body.name } : {}),
            ...(body.minQuantity !== undefined ? { minQuantity: body.minQuantity } : {}),
            ...(body.maxQuantity !== undefined ? { maxQuantity: body.maxQuantity } : {}),
            ...(body.position !== undefined ? { position: body.position } : {}),
          },
        );
        await auditEmit(request, {
          action: 'bundle_slot.update',
          objectType: 'bundle_slot',
          objectId: request.params.slotId,
        });
        return { data: row };
      },
    );

    app.delete<{ Params: { id: string; slotId: string } }>(
      '/api/v1/admin/catalog/products/:id/bundle-slots/:slotId',
      { preHandler: requireAdmin('catalog:write') },
      async (request, reply) => {
        await bundle.deleteSlot(request.params.id, request.params.slotId);
        await auditEmit(request, {
          action: 'bundle_slot.delete',
          objectType: 'bundle_slot',
          objectId: request.params.slotId,
        });
        return reply.status(204).send();
      },
    );

    app.post<{ Params: { id: string; slotId: string } }>(
      '/api/v1/admin/catalog/products/:id/bundle-slots/:slotId/options',
      {
        preHandler: requireAdmin('catalog:write'),
        schema: { body: createBundleSlotOptionRequestSchema },
      },
      async (request, reply) => {
        const body = createBundleSlotOptionRequestSchema.parse(request.body);
        const row = await bundle.addOption(
          request.params.id,
          request.params.slotId,
          {
            optionProductId: body.optionProductId,
            ...(body.defaultQuantity !== undefined
              ? { defaultQuantity: body.defaultQuantity }
              : {}),
            ...(body.position !== undefined ? { position: body.position } : {}),
          },
        );
        reply.status(201);
        await auditEmit(request, {
          action: 'bundle_slot_option.create',
          objectType: 'bundle_slot_option',
          objectId: row.id,
          stateAfter: {
            slotId: row.slotId,
            optionProductId: row.optionProductId,
          },
        });
        return { data: row };
      },
    );

    app.delete<{ Params: { id: string; slotId: string; optionId: string } }>(
      '/api/v1/admin/catalog/products/:id/bundle-slots/:slotId/options/:optionId',
      { preHandler: requireAdmin('catalog:write') },
      async (request, reply) => {
        await bundle.removeOption(
          request.params.id,
          request.params.slotId,
          request.params.optionId,
        );
        await auditEmit(request, {
          action: 'bundle_slot_option.delete',
          objectType: 'bundle_slot_option',
          objectId: request.params.optionId,
        });
        return reply.status(204).send();
      },
    );
  }
}

function serializeAdminProduct(p: Product) {
  return {
    id: p.id,
    sku: p.sku,
    slug: p.slug,
    type: p.type,
    status: p.status,
    name: p.name,
    description: p.description,
    visibility: p.visibility,
    stockMode: p.stockMode ?? null,
    attributeValues: p.attributeValues,
    allowedOrganizationIds: p.allowedOrganizationIds ?? [],
    // Feature 002 (T034) — surface the wired Attribute Set so the
    // admin Product editor can render the selector with the right
    // initial value.
    attributeSetId: p.attributeSetId,
    // Feature 002 — virtual product download fields.
    downloadAssetId: p.downloadAssetId ?? null,
    downloadUrl: p.downloadUrl ?? null,
    // Feature 010 — inventory module per-product stock flags.
    manageStock: p.manageStock,
    backorderEnabled: p.backorderEnabled,
    lowStockThreshold: p.lowStockThreshold ?? null,
    lowStockThresholdMode: p.lowStockThresholdMode,
    fulfilmentStrategy: p.fulfilmentStrategy ?? null,
    fulfilmentStrategyWarehouseOrder: p.fulfilmentStrategyWarehouseOrder ?? null,
    // Feature 022 — surface so the Bulk Edit summary and the single-
    // product editor can render the archived state.
    archivedAt: p.archivedAt ? p.archivedAt.toISOString() : null,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function serializeAdminAttribute(
  a: CatalogAttributeView,
  optionValues: string[] | null = null,
) {
  const api = dbToApiAttributeType(a.valueType, a.displayAsSlider);
  return {
    id: a.id,
    key: a.key,
    label: a.label,
    labelDefault: a.labelDefault,
    // API-form (feature 002 T013/T021/T022): admin UI can read either
    // `type` or the legacy `valueType` — both are emitted.
    type: api.type,
    numericKind: api.numericKind,
    valueType: a.valueType,
    // Feature 012 — legacy projection of the option rows (callers that
    // need the rich shape use the dedicated /attributes/:id/options
    // endpoints). Null when the attribute has no options or the caller
    // didn't fetch them.
    enumValues: optionValues,
    isSearchable: a.isSearchable,
    isFilterable: a.isFilterable,
    isVariantAxis: a.isVariantAxis,
    displayAsSlider: a.displayAsSlider,
    isComparable: a.isComparable,
    isRequired: a.isRequired,
    isPromoRule: a.isPromoRule,
    filterPosition: a.filterPosition,
    isVisibleOnProductPage: a.isVisibleOnProductPage,
    // Feature 022 — gates appearance in the Products Bulk Edit dialog.
    massEditable: a.massEditable,
    // Feature 039 — gates participation in Quick Order search.
    quickSearchable: a.quickSearchable,
    // Feature 061 (additive) — id of the backing product-host Custom Field
    // definition (adminAttributeResponseSchema.customFieldDefinitionId).
    customFieldDefinitionId: a.customFieldDefinitionId,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function serializeAdminVariant(v: ProductVariant) {
  return {
    id: v.id,
    parentProductId: v.parentProductId,
    sku: v.sku,
    variantAttributeValues: v.variantAttributeValues,
    priceOverride: v.priceOverride != null ? Number(v.priceOverride) : null,
    stockLevel: v.stockLevel ?? null,
    createdAt: v.createdAt.toISOString(),
    updatedAt: v.updatedAt.toISOString(),
  };
}

function serializeAdminCategory(c: Category) {
  return {
    id: c.id,
    parentCategoryId: c.parentCategoryId ?? null,
    name: c.name,
    slug: c.slug,
    sortOrder: c.sortOrder,
    // Feature 068 — the admin tree lists inactive categories too, so the
    // operator can see (and undo) what is hidden from customers.
    isActive: c.isActive,
    mainImageAssetId: c.mainImageAssetId ?? null,
    customFieldValues: c.customFieldValues ?? {},
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
