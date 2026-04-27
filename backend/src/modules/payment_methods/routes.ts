import type { FastifyInstance } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { PaymentMethod } from './entities/payment-method.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

/**
 * Public read endpoint: list active payment methods.
 *
 * The storefront checkout step uses the `kind` to render method-specific
 * copy (e.g. bank-transfer instructions, credit-limit notice). Admin
 * mutation lives under `/api/v1/admin/payment-methods` (T164).
 */
export interface PaymentMethodsPublicDeps {
  emFactory: () => EntityManager;
}

export interface PaymentMethodsAdminDeps {
  emFactory: () => EntityManager;
  requireAdmin: RequireAdminFactory;
}

const upsertPaymentMethodSchema = z.object({
  code: z.string().min(1).max(64),
  name: z.record(z.string(), z.string().min(1)),
  kind: z.enum(['bank_transfer', 'pickup', 'credit_limit', 'gateway']),
  status: z.enum(['active', 'inactive']).optional(),
});

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

export async function registerPaymentMethodsAdminRoutes(
  app: FastifyInstance,
  deps: PaymentMethodsAdminDeps,
): Promise<void> {
  const requireAdmin = deps.requireAdmin;

  app.get(
    '/api/v1/admin/payment-methods',
    { preHandler: requireAdmin('catalog:read') },
    async () => {
      const em = deps.emFactory();
      const rows = await em.find(PaymentMethod, {}, { orderBy: { code: 'asc' } });
      return { data: rows.map(serializePaymentMethod) };
    },
  );

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/payment-methods/:code',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: upsertPaymentMethodSchema },
    },
    async (request) => {
      const body = upsertPaymentMethodSchema.parse(request.body);
      const em = deps.emFactory();
      let row = await em.findOne(PaymentMethod, { code: request.params.code });
      if (row) {
        row.name = body.name;
        row.kind = body.kind;
        if (body.status !== undefined) row.status = body.status;
      } else {
        row = em.create(PaymentMethod, {
          code: request.params.code,
          name: body.name,
          kind: body.kind,
          status: body.status ?? 'active',
        });
      }
      await em.persistAndFlush(row);
      return { data: serializePaymentMethod(row) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/payment-methods/:id',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      const em = deps.emFactory();
      const row = await em.findOne(PaymentMethod, { id: request.params.id });
      if (!row) {
        throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Payment method not found.');
      }
      await em.removeAndFlush(row);
      reply.status(204).send();
    },
  );
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
