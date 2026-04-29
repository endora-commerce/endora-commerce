import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  assignAttributesRequestSchema,
  createAttributeRequestSchema,
  createAttributeSetRequestSchema,
  createCategoryRequestSchema,
  createAttachmentRequestSchema,
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
} from '@b2b/contracts';
import type { CatalogAdminService } from './services/catalog-admin.service.js';
import { dbToApiAttributeType } from './services/catalog-admin.service.js';
import type { CategoryAdminService } from './services/category-admin.service.js';
import type { AttributeSetService } from './services/attribute-set.service.js';
import type { GalleryService } from './services/gallery.service.js';
import type { AttachmentService } from './services/attachment.service.js';
import type { ProductLinkService } from './services/product-link.service.js';
import type { GroupedService } from './services/grouped.service.js';
import type { BundleService } from './services/bundle.service.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import type { Product } from './entities/product.entity.js';
import type { ProductAttribute } from './entities/product-attribute.entity.js';
import type { Category } from './entities/category.entity.js';

/**
 * Admin write surface for the catalog. Every route is gated by an admin session
 * with the `catalog:write` permission — wiring for permission enforcement is
 * finalised in US4 (T188). Until then the plugin accepts any authenticated admin.
 */

export type RequireAdminFactory = (
  permission?: string,
) => (req: FastifyRequest, reply: FastifyReply) => Promise<void>;

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
  /** Feature 002 — Product Links admin CRUD (US4). */
  productLinkService?: ProductLinkService;
  /** Feature 002 — Grouped product children admin CRUD (US5). */
  groupedService?: GroupedService;
  /** Feature 002 — Bundle slots + options admin CRUD (US5). */
  bundleService?: BundleService;
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
  auditLogService?: AuditLogService;
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
      const product = await adminService.createProduct(body);
      reply.status(201);
      return { data: product };
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
      const auditCtx = deps.resolveAdminAuditContext?.(request);
      const product = await adminService.updateProduct(
        request.params.id,
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
      return { data: product };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/catalog/products/:id',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      await adminService.archiveProduct(request.params.id);
      reply.status(204).send();
    },
  );

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
      return { data: serializeAdminAttribute(attr) };
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
      // Accept either UUID (id) or snake_case key — admin UI consumes
      // the API by key, but contract tests round-trip through the id
      // returned on create.
      const attr = await adminService.updateAttributeByIdOrKey(
        request.params.idOrKey,
        body,
      );
      return { data: serializeAdminAttribute(attr) };
    },
  );

  // --- Read endpoints feeding the admin UI ---------------------------------

  app.get(
    '/api/v1/admin/catalog/products',
    { preHandler: requireAdmin('catalog:read') },
    async (request) => {
      const q = (request.query ?? {}) as Record<string, string | undefined>;
      const includeArchived = q['includeArchived'] === '1' || q['includeArchived'] === 'true';
      const rows = await adminService.listProducts({ includeArchived });
      return {
        data: rows.map(serializeAdminProduct),
        pagination: { cursor: null, hasMore: false, limit: rows.length },
      };
    },
  );

  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/catalog/products/:id',
    { preHandler: requireAdmin('catalog:read') },
    async (request) => {
      const product = await adminService.getProductById(request.params.id);
      return { data: serializeAdminProduct(product) };
    },
  );

  app.get(
    '/api/v1/admin/catalog/attributes',
    { preHandler: requireAdmin('catalog:read') },
    async () => {
      const rows = await adminService.listAttributes();
      return { data: rows.map(serializeAdminAttribute) };
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
        });
        return { data: serializeAdminCategory(cat) };
      },
    );

    app.delete<{ Params: { id: string } }>(
      '/api/v1/admin/catalog/categories/:id',
      { preHandler: requireAdmin('catalog:write') },
      async (request, reply) => {
        await categoryService.softDelete(request.params.id);
        reply.status(204).send();
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
        const detail = await attrSetService.createSet(body);
        reply.status(201);
        await auditEmit(request, {
          action: 'attribute_set.create',
          objectType: 'attribute_set',
          objectId: detail.id,
        });
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
        const set = await attrSetService.updateSet(request.params.id, body);
        await auditEmit(request, {
          action: 'attribute_set.update',
          objectType: 'attribute_set',
          objectId: request.params.id,
        });
        return { data: set };
      },
    );

    app.delete<{ Params: { id: string } }>(
      '/api/v1/admin/catalog/attribute-sets/:id',
      { preHandler: requireAdmin('catalog:write') },
      async (request, reply) => {
        await attrSetService.deleteSet(request.params.id);
        await auditEmit(request, {
          action: 'attribute_set.delete',
          objectType: 'attribute_set',
          objectId: request.params.id,
        });
        reply.status(204).send();
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
        const detail = await attrSetService.assignAttributes(request.params.id, body);
        await auditEmit(request, {
          action: 'attribute_set.assign_attributes',
          objectType: 'attribute_set',
          objectId: request.params.id,
        });
        return { data: detail };
      },
    );

    app.delete<{ Params: { id: string; attributeId: string } }>(
      '/api/v1/admin/catalog/attribute-sets/:id/attributes/:attributeId',
      { preHandler: requireAdmin('catalog:write') },
      async (request, reply) => {
        await attrSetService.unassignAttribute(
          request.params.id,
          request.params.attributeId,
        );
        await auditEmit(request, {
          action: 'attribute_set.unassign_attribute',
          objectType: 'attribute_set',
          objectId: request.params.id,
        });
        reply.status(204).send();
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
        reply.status(204).send();
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
        reply.status(204).send();
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
        reply.status(204).send();
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
        reply.status(204).send();
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
      reply.status(204).send();
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
        reply.status(204).send();
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
        reply.status(204).send();
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
        reply.status(204).send();
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
        reply.status(204).send();
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
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function serializeAdminAttribute(a: ProductAttribute) {
  const api = dbToApiAttributeType(a.valueType, a.displayAsSlider);
  return {
    id: a.id,
    key: a.key,
    label: a.label,
    // API-form (feature 002 T013/T021/T022): admin UI can read either
    // `type` or the legacy `valueType` — both are emitted.
    type: api.type,
    numericKind: api.numericKind,
    valueType: a.valueType,
    enumValues: a.enumValues ?? null,
    isSearchable: a.isSearchable,
    isFilterable: a.isFilterable,
    isVariantAxis: a.isVariantAxis,
    displayAsSlider: a.displayAsSlider,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}

function serializeAdminVariant(v: import('./entities/product-variant.entity.js').ProductVariant) {
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
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
