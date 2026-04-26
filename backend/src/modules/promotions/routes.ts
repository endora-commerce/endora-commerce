import type { FastifyInstance } from 'fastify';
import { cartSnapshotSchema, upsertPromotionRequestSchema } from '@b2b/contracts';
import type { PromotionService } from './services/promotion-service.js';
import type { Promotion } from './entities/promotion.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface PromotionRoutesDeps {
  promotionService: PromotionService;
  requireAdmin: RequireAdminFactory;
}

export async function registerPromotionRoutes(
  app: FastifyInstance,
  deps: PromotionRoutesDeps,
): Promise<void> {
  const { promotionService, requireAdmin } = deps;

  app.get(
    '/api/v1/admin/promotions',
    { preHandler: requireAdmin('catalog:write') },
    async () => {
      const rows = await promotionService.list();
      return { data: rows.map(serialize) };
    },
  );

  app.post(
    '/api/v1/admin/promotions',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: upsertPromotionRequestSchema },
    },
    async (request, reply) => {
      const body = upsertPromotionRequestSchema.parse(request.body);
      const row = await promotionService.upsert({
        name: body.name,
        kind: body.kind,
        value: body.value,
        ...(body.code !== undefined ? { code: body.code } : {}),
        ...(body.currency !== undefined ? { currency: body.currency } : {}),
        ...(body.minCartSubtotal !== undefined ? { minCartSubtotal: body.minCartSubtotal } : {}),
        ...(body.validFrom !== undefined ? { validFrom: body.validFrom } : {}),
        ...(body.validUntil !== undefined ? { validUntil: body.validUntil } : {}),
        ...(body.organizationId !== undefined ? { organizationId: body.organizationId } : {}),
        ...(body.customerGroupId !== undefined ? { customerGroupId: body.customerGroupId } : {}),
        ...(body.categoryId !== undefined ? { categoryId: body.categoryId } : {}),
        ...(body.productId !== undefined ? { productId: body.productId } : {}),
        ...(body.isActive !== undefined ? { isActive: body.isActive } : {}),
      });
      reply.status(201);
      return { data: serialize(row) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/promotions/:id',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      await promotionService.remove(request.params.id);
      reply.status(204).send();
    },
  );

  app.post(
    '/api/v1/admin/promotions/preview',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: cartSnapshotSchema },
    },
    async (request) => {
      const snapshot = cartSnapshotSchema.parse(request.body);
      const result = await promotionService.applyToCart(snapshot);
      return { data: result };
    },
  );
}

function serialize(row: Promotion): Record<string, unknown> {
  return {
    id: row.id,
    code: row.code ?? null,
    name: row.name,
    kind: row.kind,
    value: Number(row.value),
    currency: row.currency ?? null,
    minCartSubtotal: row.minCartSubtotal != null ? Number(row.minCartSubtotal) : null,
    validFrom: row.validFrom?.toISOString() ?? null,
    validUntil: row.validUntil?.toISOString() ?? null,
    organizationId: row.organizationId ?? null,
    customerGroupId: row.customerGroupId ?? null,
    categoryId: row.categoryId ?? null,
    productId: row.productId ?? null,
    isActive: row.isActive,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
