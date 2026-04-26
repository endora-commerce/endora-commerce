import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { PaymentMethod } from './entities/payment-method.entity.js';

/**
 * Public read endpoint: list active payment methods.
 *
 * The storefront checkout step uses the `kind` to render method-specific
 * copy (e.g. bank-transfer instructions, credit-limit notice). Admin
 * mutation lives under `/api/v1/admin/payment-methods` (T164, not yet wired).
 */
export interface PaymentMethodsPublicDeps {
  emFactory: () => EntityManager;
}

export async function registerPaymentMethodsPublicRoutes(
  app: FastifyInstance,
  deps: PaymentMethodsPublicDeps,
): Promise<void> {
  app.get('/api/v1/payment-methods', async () => {
    const em = deps.emFactory();
    const rows = await em.find(
      PaymentMethod,
      { status: 'active' },
      { orderBy: { code: 'asc' } },
    );
    return { data: rows.map(serializePaymentMethod) };
  });
}

function serializePaymentMethod(m: PaymentMethod) {
  return {
    id: m.id,
    code: m.code,
    name: m.name,
    kind: m.kind,
    status: m.status,
  };
}
