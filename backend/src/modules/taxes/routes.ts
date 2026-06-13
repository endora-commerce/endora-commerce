import type { FastifyInstance } from 'fastify';
import { taxResolutionInputSchema, upsertTaxRequestSchema } from '@b2b/contracts';
import type { TaxService } from './services/tax-service.js';
import type { Tax } from './entities/tax.entity.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

export interface TaxRoutesDeps {
  taxService: TaxService;
  requireAdmin: RequireAdminFactory;
}

export async function registerTaxRoutes(
  app: FastifyInstance,
  deps: TaxRoutesDeps,
): Promise<void> {
  const { taxService, requireAdmin } = deps;

  app.get(
    '/api/v1/admin/taxes',
    { preHandler: requireAdmin('catalog:write') },
    async () => {
      const rows = await taxService.list();
      return { data: rows.map(serialize) };
    },
  );

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/taxes/:code',
    {
      preHandler: requireAdmin('catalog:write'),
      schema: { body: upsertTaxRequestSchema },
    },
    async (request) => {
      const body = upsertTaxRequestSchema.parse(request.body);
      const row = await taxService.upsertByCode({
        code: request.params.code,
        name: body.name,
        rate: body.rate,
        ...(body.country !== undefined ? { country: body.country } : {}),
        ...(body.productType !== undefined ? { productType: body.productType } : {}),
        ...(body.appliesToVatStatuses !== undefined
          ? { appliesToVatStatuses: body.appliesToVatStatuses }
          : {}),
        ...(body.isDefault !== undefined ? { isDefault: body.isDefault } : {}),
        ...(body.priority !== undefined ? { priority: body.priority } : {}),
      });
      return { data: serialize(row) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/taxes/:id',
    { preHandler: requireAdmin('catalog:write') },
    async (request, reply) => {
      await taxService.remove(request.params.id);
      return reply.status(204).send();
    },
  );

  app.get<{ Querystring: { country?: string; productType?: string; vatStatus?: string } }>(
    '/api/v1/admin/taxes/preview',
    { preHandler: requireAdmin('catalog:write') },
    async (request) => {
      const input = taxResolutionInputSchema.parse({
        country: request.query.country,
        productType: request.query.productType,
        vatStatus: request.query.vatStatus,
      });
      const result = await taxService.taxRateFor(input);
      return { data: result };
    },
  );
}

function serialize(row: Tax): Record<string, unknown> {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    rate: Number(row.rate),
    country: row.country ?? null,
    productType: row.productType ?? null,
    appliesToVatStatuses: row.appliesToVatStatuses,
    isDefault: row.isDefault,
    priority: row.priority,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
