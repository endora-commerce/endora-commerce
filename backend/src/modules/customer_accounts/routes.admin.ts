import type { FastifyInstance } from 'fastify';
import { upsertCustomerGroupRequestSchema } from '@b2b/contracts';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { CustomerGroup } from './entities/customer-group.entity.js';
import type { CustomerGroupService } from './services/customer-group-service.js';

/**
 * The customer-group admin surface (feature 076, D-79).
 *
 * Three routes, at the paths they have always had — `price_lists` served them
 * until this module took the entity over, and the admin SPA's pickers call the
 * same URLs with the same payloads. What changed is the gate: `catalog:write`
 * was the pricing module's permission and is the wrong question to ask about a
 * customer's segmentation, so the surface is gated by the two codes this module
 * declares in its manifest. An operator's role has to be granted them; there is
 * no silent inheritance from `catalog:write`.
 */
export interface CustomerGroupAdminDeps {
  /**
   * Resolved per call rather than captured: the registration is a gated port,
   * and a gate captured at boot keeps answering whatever the effective state
   * later says. The module is non-deactivatable, so the gate is unreachable —
   * which is a reason to be uniform, not a reason to be careless.
   */
  customerGroupService: () => CustomerGroupService;
  requireAdmin: RequireAdminFactory;
}

export async function registerCustomerGroupAdminRoutes(
  app: FastifyInstance,
  deps: CustomerGroupAdminDeps,
): Promise<void> {
  const { customerGroupService, requireAdmin } = deps;

  app.get(
    '/api/v1/admin/customer-groups',
    { preHandler: requireAdmin('customer_groups:read') },
    async () => {
      const rows = await customerGroupService().list();
      return { data: rows.map(serializeCustomerGroup) };
    },
  );

  app.put<{ Params: { code: string } }>(
    '/api/v1/admin/customer-groups/:code',
    {
      preHandler: requireAdmin('customer_groups:write'),
      schema: { body: upsertCustomerGroupRequestSchema },
    },
    async (request) => {
      const body = upsertCustomerGroupRequestSchema.parse(request.body);
      const row = await customerGroupService().upsertByCode({
        code: request.params.code,
        name: body.name,
        ...(body.description !== undefined ? { description: body.description } : {}),
      });
      return { data: serializeCustomerGroup(row) };
    },
  );

  app.delete<{ Params: { id: string } }>(
    '/api/v1/admin/customer-groups/:id',
    { preHandler: requireAdmin('customer_groups:write') },
    async (request, reply) => {
      await customerGroupService().remove(request.params.id);
      return reply.status(204).send();
    },
  );
}

function serializeCustomerGroup(row: CustomerGroup): Record<string, unknown> {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    description: row.description ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
