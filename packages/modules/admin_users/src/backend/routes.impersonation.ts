// `reply.setCookie` / `reply.clearCookie` are not on `FastifyReply`: they are a
// declaration-merging augmentation `@fastify/cookie` contributes. Inside
// `backend/src` that augmentation arrived ambiently, through the host's own
// dependency and its `types` graph — so nothing in this module ever named it. A
// package compiles against its own manifest, where an unnamed dependency does
// not exist, and the property simply is not there (TS2339). The import is
// type-only, so it loads the declarations and emits nothing: registering the
// plugin stays the host's job, exactly as before.
import type {} from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ADMIN_SESSION_COOKIE_NAME,
  ERROR_CODES,
  SESSION_COOKIE_NAME,
  impersonationRequestSchema,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { ImpersonationService } from './services/impersonation-service.js';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';

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
  /**
   * The acting admin's id, resolved from the request the
   * `requireAdmin('customers:impersonate')` guard has already accepted.
   *
   * It used to be read here from `request.testActor`, narrowed through
   * `http/test-actor-carrier` — a file `contracts/host-package.md` §1.4j
   * classifies **A**, because it exists to keep this repository's test-harness
   * Fastify augmentation out of production code and an installed package has no
   * relationship to that harness. Nothing under `src/` writes that field, so the
   * inline check answered `401 Admin session required` to every production
   * request while the guard in front of it was doing the real gating.
   *
   * Both composition roots supply it from `adminContextResolver`, which reads
   * the production actor and throws 401 for a non-admin.
   */
  resolveAdminUserId: (request: FastifyRequest) => string;
}

export async function registerImpersonationRoutes(
  app: FastifyInstance,
  deps: ImpersonationDeps,
): Promise<void> {
  const { impersonationService, requireAdmin, resolveAdminUserId } = deps;

  app.post<{ Params: { id: string } }>(
    '/api/v1/admin/organizations/:id/impersonate',
    {
      preHandler: requireAdmin('customers:impersonate'),
      schema: { body: impersonationRequestSchema },
    },
    async (request, reply) => {
      const body = impersonationRequestSchema.parse(request.body);
      const adminId = resolveAdminUserId(request);

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
