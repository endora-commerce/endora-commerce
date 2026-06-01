import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { blockCustomerRequestSchema, startImpersonationRequestSchema } from '@b2b/contracts';
import { SESSION_COOKIE_NAME } from '../auth/plugin.js';
import type { CustomerModerationService } from './services/customer-moderation-service.js';
import type { ImpersonationService } from '../admin_users/services/impersonation-service.js';

const ADMIN_SHADOW_COOKIE = 'admin_shadow_session';

function setSessionCookie(reply: FastifyReply, value: string, expiresAt: Date): void {
  reply.setCookie(SESSION_COOKIE_NAME, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    expires: expiresAt,
    signed: false,
  });
}

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
  impersonationService: ImpersonationService;
}

export async function registerCustomersAdminRoutes(
  app: FastifyInstance,
  deps: CustomersAdminDeps,
): Promise<void> {
  const { requireAdmin, resolveModerationActor, moderationService } = deps;
  const { impersonationService } = deps;

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

  // POST /api/v1/admin/customers/:id/impersonate (US4) — works for org-less
  // customers (organizationId omitted → target resolved by id alone, R10).
  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id/impersonate',
    {
      preHandler: requireAdmin('customers:impersonate'),
      schema: { body: startImpersonationRequestSchema },
    },
    async (request, reply) => {
      const actor = await resolveModerationActor(request);
      const body = startImpersonationRequestSchema.parse(request.body ?? {});
      const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
      const adminCookie = cookies?.[SESSION_COOKIE_NAME] ?? '';

      const result = await impersonationService.start({
        adminUserId: actor.adminUserId,
        adminSessionCookieValue: adminCookie,
        customerAccountId: request.params.id,
        ...(body.reason !== undefined ? { reason: body.reason } : {}),
        ...(request.ip ? { ip: request.ip } : {}),
        ...(typeof request.headers['user-agent'] === 'string'
          ? { userAgent: request.headers['user-agent'] }
          : {}),
        requestId: request.id,
      });

      setSessionCookie(reply, result.impersonationCookieValue, result.impersonationExpiresAt);
      reply.setCookie(ADMIN_SHADOW_COOKIE, result.adminShadowSessionCookieValue, {
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env['NODE_ENV'] === 'production',
        expires: result.impersonationExpiresAt,
        signed: false,
      });

      return {
        data: {
          impersonationSessionId: result.impersonationSessionId,
          impersonatedCustomerAccount: {
            id: result.impersonatedCustomerAccount.id,
            email: result.impersonatedCustomerAccount.email,
            firstName: result.impersonatedCustomerAccount.firstName,
            lastName: result.impersonatedCustomerAccount.lastName,
          },
        },
      };
    },
  );
}
