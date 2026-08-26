// `reply.setCookie` / `reply.clearCookie` are not on `FastifyReply`: they are a
// declaration-merging augmentation `@fastify/cookie` contributes. Inside
// `backend/src` that augmentation arrived ambiently, through the host's own
// dependency and its `types` graph — so nothing in this module ever named it. A
// package compiles against its own manifest, where an unnamed dependency does
// not exist, and the property simply is not there (TS2339). The import is
// type-only, so it loads the declarations and emits nothing: registering the
// plugin stays the host's job, exactly as before.
import type {} from '@fastify/cookie';
import type { FastifyInstance, FastifyReply } from 'fastify';
import { ADMIN_SESSION_COOKIE_NAME, adminLoginRequestSchema } from '@endora-commerce/contracts';
import type { AdminAuthService } from './services/admin-auth-service.js';
import type { AdminUser } from './entities/admin-user.entity.js';

/**
 * Anonymous admin endpoints — login + logout. The admin surface is otherwise
 * gated by `requireAdmin` in each module's admin routes.
 */
export interface AdminPublicDeps {
  adminAuthService: AdminAuthService;
}

export async function registerAdminPublicRoutes(
  app: FastifyInstance,
  deps: AdminPublicDeps,
): Promise<void> {
  const { adminAuthService } = deps;

  app.post(
    '/api/v1/auth/admin/login',
    { schema: { body: adminLoginRequestSchema } },
    async (request, reply) => {
      const body = adminLoginRequestSchema.parse(request.body);
      const result = await adminAuthService.login({
        email: body.email,
        password: body.password,
        ...(request.ip ? { ip: request.ip } : {}),
        ...(typeof request.headers['user-agent'] === 'string'
          ? { userAgent: request.headers['user-agent'] }
          : {}),
      });
      // Feature 042 — two-step login (no session cookie until the second step).
      if (result.status === 'mfaRequired') {
        return { data: { status: 'mfaRequired', challengeId: result.challengeId } };
      }
      if (result.status === 'mfaSetupRequired') {
        return { data: { status: 'mfaSetupRequired', setupTicket: result.setupTicket } };
      }
      setSessionCookie(reply, result.sessionCookieValue, result.sessionExpiresAt);
      return {
        data: { status: 'authenticated', adminUser: serializeAdminUser(result.adminUser) },
      };
    },
  );

  app.post('/api/v1/auth/admin/logout', async (request, reply) => {
    const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
    const raw = cookies?.[ADMIN_SESSION_COOKIE_NAME];
    if (raw) {
      const dot = raw.indexOf('.');
      if (dot !== -1) {
        const sessionId = raw.slice(0, dot);
        if (sessionId) await adminAuthService.logout(sessionId);
      }
    }
    reply.clearCookie(ADMIN_SESSION_COOKIE_NAME, { path: '/' });
    return reply.status(204).send();
  });
}

function setSessionCookie(reply: FastifyReply, value: string, expiresAt: Date): void {
  reply.setCookie(ADMIN_SESSION_COOKIE_NAME, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    expires: expiresAt,
    signed: false,
  });
}

function serializeAdminUser(a: AdminUser): Record<string, unknown> {
  return {
    id: a.id,
    email: a.email,
    firstName: a.firstName,
    lastName: a.lastName,
    adminRoleId: a.adminRoleId ?? null,
    twoFactorEnabled: !!a.twoFactorConfirmedAt,
    status: a.status,
    // Feature 019: surface the per-user Admin UI language preference so the
    // SPA's TranslationProvider can seed itself without a separate fetch.
    preferredLanguage: a.preferredLanguage ?? null,
    lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}
