import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  createAttributeRequestSchema,
  createProductRequestSchema,
  updateAttributeRequestSchema,
  updateProductRequestSchema,
} from '@b2b/contracts';
import type { CatalogAdminService } from './services/catalog-admin.service.js';

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
  /**
   * PreHandler gate — supplied by the composition root. Set to the real
   * `requireAdmin('catalog:write')` factory at server boot. Optional so tests
   * and dev-mode servers can wire this up progressively.
   */
  requireAdmin: RequireAdminFactory;
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
      const product = await adminService.updateProduct(request.params.id, body);
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
}
