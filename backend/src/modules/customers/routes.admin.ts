import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { blockCustomerRequestSchema, startImpersonationRequestSchema } from '@b2b/contracts';
import { SESSION_COOKIE_NAME } from '../auth/plugin.js';
import type { CustomerModerationService } from './services/customer-moderation-service.js';
import type { CustomerAdminQueryService } from './services/customer-admin-query-service.js';
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

/**
 * Resolves the acting admin's id, whether they are a Platform Administrator,
 * and (for a scoped Salesperson) the Organizations they may act on.
 */
export type ResolveModerationActor = (
  request: FastifyRequest,
) => Promise<{
  adminUserId: string;
  isPlatformAdmin: boolean;
  allowedOrganizationIds: string[];
}>;

export interface CustomersAdminDeps {
  requireAdmin: RequireAdminGuard;
  resolveModerationActor: ResolveModerationActor;
  moderationService: CustomerModerationService;
  queryService: CustomerAdminQueryService;
  impersonationService: ImpersonationService;
}

export async function registerCustomersAdminRoutes(
  app: FastifyInstance,
  deps: CustomersAdminDeps,
): Promise<void> {
  const { requireAdmin, resolveModerationActor, moderationService } = deps;
  const { impersonationService, queryService } = deps;

  // GET /api/v1/admin/customers — list (authority-scoped)
  app.get<{
    Querystring: {
      q?: string;
      status?: 'active' | 'blocked' | 'deleted';
      organizationId?: string;
      customerGroupId?: string;
      page?: string;
      pageSize?: string;
    };
  }>(
    '/api/v1/admin/customers',
    { preHandler: requireAdmin('customers:read') },
    async (request) => {
      const actor = await resolveModerationActor(request);
      const q = request.query;
      const page = Math.max(1, Number.parseInt(q.page ?? '1', 10) || 1);
      const pageSize = Math.min(100, Math.max(1, Number.parseInt(q.pageSize ?? '20', 10) || 20));
      const result = await queryService.list(
        {
          ...(q.q !== undefined ? { q: q.q } : {}),
          ...(q.status !== undefined ? { status: q.status } : {}),
          ...(q.organizationId !== undefined ? { organizationId: q.organizationId } : {}),
          ...(q.customerGroupId !== undefined ? { customerGroupId: q.customerGroupId } : {}),
          page,
          pageSize,
        },
        {
          isPlatformAdmin: actor.isPlatformAdmin,
          allowedOrganizationIds: actor.allowedOrganizationIds,
        },
      );
      return { data: result.rows, meta: { page, pageSize, total: result.total } };
    },
  );

  // GET /api/v1/admin/customers/:id — detail
  app.get<{ Params: { id: string } }>(
    '/api/v1/admin/customers/:id',
    { preHandler: requireAdmin('customers:read') },
    async (request, reply) => {
      await resolveModerationActor(request);
      const detail = await queryService.getDetail(request.params.id);
      if (!detail) {
        reply.code(404);
        return { error: { code: 'CUSTOMER_NOT_FOUND', message: 'Customer not found.' } };
      }
      return { data: detail };
    },
  );

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
