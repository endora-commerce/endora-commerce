import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ADMIN_SESSION_COOKIE_NAME,
  ERROR_CODES,
  SESSION_COOKIE_NAME,
  impersonationRequestSchema,
} from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { TestActorCarrier } from '../../http/test-actor-carrier.js';
import type { ImpersonationService } from './services/impersonation-service.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Admin impersonation routes (T191).
 *
 * - POST /admin/organizations/:id/impersonate — admin starts impersonation of
 *   a customer in the target Organization. Audit row written BEFORE the
 *   cookie is set (T179). Two cookies are issued: the new b2b_session for
 *   the impersonation, and admin_shadow_session preserving the original
 *   admin session value so end can restore it.
 * - POST /admin/impersonation/end — destroys the impersonation session,
 *   restores the admin session from admin_shadow_session, writes the
 *   impersonation.end audit row.
 */

const ADMIN_SHADOW_COOKIE = 'admin_shadow_session';

export interface ImpersonationDeps {
  impersonationService: ImpersonationService;
  requireAdmin: RequireAdminFactory;
}

export async function registerImpersonationRoutes(
  app: FastifyInstance,
  deps: ImpersonationDeps,
): Promise<void> {
  const { impersonationService, requireAdmin } = deps;

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/impersonate',
    {
      preHandler: requireAdmin('customers:impersonate'),
      schema: { body: impersonationRequestSchema },
    },
    async (request, reply) => {
      const body = impersonationRequestSchema.parse(request.body);
      // The test harness decorates `request.testActor` (test/helpers/test-actors.ts).
      // Narrow it locally rather than relying on that file's global `fastify`
      // augmentation — it lives under test/, which tsconfig.build.json excludes.
      const testActor = (request as FastifyRequest & TestActorCarrier).testActor;
      if (testActor?.kind !== 'admin') {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
      }
      const adminId = testActor.adminUserId;

      const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
      // The admin's own session lives in the dedicated admin cookie; fall back to
      // the legacy customer-cookie name so older sessions / test stubs still work.
      const adminCookie =
        cookies?.[ADMIN_SESSION_COOKIE_NAME] ?? cookies?.[SESSION_COOKIE_NAME] ?? '';
      // For tests, the stub-admin-session cookie isn't a real session value —
      // we treat the entire raw cookie as the shadow regardless. End() will
      // refuse to restore a stub cookie that no longer resolves.

      const result = await impersonationService.start({
        adminUserId: adminId,
        adminSessionCookieValue: adminCookie,
        customerAccountId: body.customerAccountId,
        organizationId: request.params.id,
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
            role: result.impersonatedCustomerAccount.role,
          },
        },
      };
    },
  );

  app.post('/api/v1/admin/impersonation/end', async (request, reply) => {
    const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
    const impersonationCookie = cookies?.[SESSION_COOKIE_NAME];
    const shadow = cookies?.[ADMIN_SHADOW_COOKIE];
    if (!impersonationCookie || !shadow) {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'No impersonation session active.');
    }
    const result = await impersonationService.end({
      impersonationSessionCookieValue: impersonationCookie,
      adminShadowCookieValue: shadow,
      ...(request.ip ? { ip: request.ip } : {}),
      ...(typeof request.headers['user-agent'] === 'string'
        ? { userAgent: request.headers['user-agent'] }
        : {}),
      requestId: request.id,
    });

    // Restore the admin session into the admin cookie and drop the impersonation
    // session from the customer cookie, so ending impersonation leaves the admin
    // signed in to the Admin UI but no longer acting as the customer.
    setAdminSessionCookie(reply, result.adminSessionCookieValue, result.adminSessionExpiresAt);
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    reply.clearCookie(ADMIN_SHADOW_COOKIE, { path: '/' });
    return { data: { restored: true } };
  });
}

/** Set the impersonation (customer-scoped) session in the customer cookie. */
function setSessionCookie(reply: FastifyReply, value: string, expiresAt: Date): void {
  setCookie(reply, SESSION_COOKIE_NAME, value, expiresAt);
}

/** Set the admin session in the dedicated admin cookie. */
function setAdminSessionCookie(reply: FastifyReply, value: string, expiresAt: Date): void {
  setCookie(reply, ADMIN_SESSION_COOKIE_NAME, value, expiresAt);
}

function setCookie(reply: FastifyReply, name: string, value: string, expiresAt: Date): void {
  reply.setCookie(name, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    expires: expiresAt,
    signed: false,
  });
}
