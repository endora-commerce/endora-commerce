import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { DeliveryMethod } from './entities/delivery-method.entity.js';

/**
 * Public read endpoint: list active delivery methods.
 *
 * The storefront checkout step renders one option per row; admin
 * mutation lives under `/api/v1/admin/delivery-methods` (T164,
 * not yet wired).
 */
export interface DeliveryMethodsPublicDeps {
  emFactory: () => EntityManager;
}

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

function serializeDeliveryMethod(m: DeliveryMethod) {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    cost: { amount: Number(m.cost), currency: m.currency },
    status: m.status,
  };
}
