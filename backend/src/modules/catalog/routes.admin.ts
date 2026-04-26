import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createAttributeRequestSchema,
  createCategoryRequestSchema,
  createProductRequestSchema,
  updateAttributeRequestSchema,
  updateCategoryRequestSchema,
  updateProductRequestSchema,
} from '@b2b/contracts';
import type { CatalogAdminService } from './services/catalog-admin.service.js';
import type { CategoryAdminService } from './services/category-admin.service.js';
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
}

export async function registerCatalogAdminRoutes(
  app: FastifyInstance,
  deps: CatalogAdminDeps,
): Promise<void> {
  const { adminService, requireAdmin } = deps;

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
      return { data: attr };
    },
  );

  app.patch<{ Params: { key: string } }>(
    '/api/v1/admin/catalog/attributes/:key',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: updateAttributeRequestSchema },
    },
    async (request) => {
      const body = updateAttributeRequestSchema.parse(request.body);
      const attr = await adminService.updateAttribute(request.params.key, body);
      return { data: attr };
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
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

function serializeAdminAttribute(a: ProductAttribute) {
  return {
    id: a.id,
    key: a.key,
    label: a.label,
    valueType: a.valueType,
    enumValues: a.enumValues ?? null,
    isSearchable: a.isSearchable,
    isFilterable: a.isFilterable,
    isVariantAxis: a.isVariantAxis,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
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
