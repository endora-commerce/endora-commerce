import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { blockCustomerRequestSchema } from '@b2b/contracts';
import type { CustomerModerationService } from './services/customer-moderation-service.js';

/**
 * Admin customer-management routes (feature 040). Block/unblock land here in
 * US3; later user stories extend this file (impersonate, detail, group,
 * delete/restore, presence). Every route is gated by `requireAdmin`.
 */
export type RequireAdminGuard = (
  permission?: string,
) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/** Resolves the acting admin's id + whether they are a Platform Administrator. */
export type ResolveModerationActor = (
  request: FastifyRequest,
) => Promise<{ adminUserId: string; isPlatformAdmin: boolean }>;

export interface CustomersAdminDeps {
  requireAdmin: RequireAdminGuard;
  resolveModerationActor: ResolveModerationActor;
  moderationService: CustomerModerationService;
}

export async function registerCustomersAdminRoutes(
  app: FastifyInstance,
  deps: CustomersAdminDeps,
): Promise<void> {
  const { requireAdmin, resolveModerationActor, moderationService } = deps;

  // POST /api/v1/admin/customers/:id/block
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/block',
    { preHandler: requireAdmin('customers:manage'), schema: { body: blockCustomerRequestSchema } },
    async (request) => {
      const actor = await resolveModerationActor(request);
      const body = blockCustomerRequestSchema.parse(request.body ?? {});
      const customer = await moderationService.block({
        targetCustomerAccountId: request.params.id,
        actor,
        reason: body.reason ?? null,
        audit: {
          ipAddress: request.ip,
          ...(typeof request.headers['user-agent'] === 'string'
            ? { userAgent: request.headers['user-agent'] }
            : {}),
        },
      });
      return { data: { id: customer.id, blocked: customer.blockedAt != null } };
    },
  );

  // POST /api/v1/admin/customers/:id/unblock
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/unblock',
    { preHandler: requireAdmin('customers:manage') },
    async (request) => {
      const actor = await resolveModerationActor(request);
      const customer = await moderationService.unblock({
        targetCustomerAccountId: request.params.id,
        actor,
        audit: {
          ipAddress: request.ip,
          ...(typeof request.headers['user-agent'] === 'string'
            ? { userAgent: request.headers['user-agent'] }
            : {}),
        },
      });
      return { data: { id: customer.id, blocked: customer.blockedAt != null } };
    },
  );
}
