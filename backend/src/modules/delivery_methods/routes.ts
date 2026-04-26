import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { DeliveryMethod } from './entities/delivery-method.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

/**
 * Public read endpoint: list active delivery methods.
 *
 * The storefront checkout step renders one option per row; admin
 * mutation lives under `/api/v1/admin/delivery-methods` (T164).
 */
export interface DeliveryMethodsPublicDeps {
  emFactory: () => EntityManager;
}

export interface DeliveryMethodsAdminDeps {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
}

const upsertDeliveryMethodSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.record(z.string(), z.string().min(1)),
  cost: z.number().finite().nonnegative(),
  currency: z.string().length(3),
  status: z.enum(['active', 'inactive']).optional(),
});

export async function registerDeliveryMethodsPublicRoutes(
  app: FastifyInstance,
  deps: DeliveryMethodsPublicDeps,
): Promise<void> {
  app.get('/api/v1/delivery-methods', async () => {
    const em = deps.emFactory();
    const rows = await em.find(
      DeliveryMethod,
      { status: 'active' },
      { orderBy: { code: 'asc' } },
    );
    return { data: rows.map(serializeDeliveryMethod) };
  });
}

export async function registerDeliveryMethodsAdminRoutes(
  app: FastifyInstance,
  deps: DeliveryMethodsAdminDeps,
): Promise<void> {
  const requireAdmin = deps.requireAdmin;

  app.get(
    '/api/v1/admin/delivery-methods',
    { preHandler: requireAdmin('catalog:read') },
    async () => {
      const em = deps.emFactory();
      const rows = await em.find(DeliveryMethod, {}, { orderBy: { code: 'asc' } });
      return { data: rows.map(serializeDeliveryMethod) };
    },
  );

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/delivery-methods/:code',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: upsertDeliveryMethodSchema },
    },
    async (request) => {
      const body = upsertDeliveryMethodSchema.parse(request.body);
      const em = deps.emFactory();
      let row = await em.findOne(DeliveryMethod, { code: request.params.code });
      if (row) {
        row.name = body.name;
        row.cost = body.cost.toFixed(2);
        row.currency = body.currency;
        if (body.status !== undefined) row.status = body.status;
      } else {
        row = em.create(DeliveryMethod, {
          code: request.params.code,
          name: body.name,
          cost: body.cost.toFixed(2),
          currency: body.currency,
          status: body.status ?? 'active',
        });
      }
      await em.persistAndFlush(row);
      return { data: serializeDeliveryMethod(row) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/delivery-methods/:id',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      const em = deps.emFactory();
      const row = await em.findOne(DeliveryMethod, { id: request.params.id });
      if (!row) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Delivery method not found.');
      }
      await em.removeAndFlush(row);
      reply.status(204).send();
    },
  );
}

function serializeDeliveryMethod(m: DeliveryMethod) {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    cost: { amount: Number(m.cost), currency: m.currency },
    status: m.status,
  };
}
