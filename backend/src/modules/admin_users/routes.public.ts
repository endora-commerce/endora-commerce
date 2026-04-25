import type { FastifyInstance, FastifyReply } from 'fastify';
import { adminLoginRequestSchema } from '@b2b/contracts';
import type { AdminAuthService } from './services/admin-auth-service.js';
import { SESSION_COOKIE_NAME } from '../auth/plugin.js';
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
      setSessionCookie(reply, result.sessionCookieValue, result.sessionExpiresAt);
      return { data: { adminUser: serializeAdminUser(result.adminUser) } };
    },
  );

  app.post('/api/v1/auth/admin/logout', async (request, reply) => {
    const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
    const raw = cookies?.[SESSION_COOKIE_NAME];
    if (raw) {
      const dot = raw.indexOf('.');
      if (dot !== -1) {
        const sessionId = raw.slice(0, dot);
        if (sessionId) await adminAuthService.logout(sessionId);
      }
    }
    reply.clearCookie(SESSION_COOKIE_NAME, { path: '/' });
    reply.status(204).send();
  });
}

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

function serializeAdminUser(a: AdminUser): Record<string, unknown> {
  return {
    id: a.id,
    email: a.email,
    firstName: a.firstName,
    lastName: a.lastName,
    adminRoleId: a.adminRoleId ?? null,
    twoFactorEnabled: !!a.twoFactorConfirmedAt,
    status: a.status,
    lastLoginAt: a.lastLoginAt?.toISOString() ?? null,
    createdAt: a.createdAt.toISOString(),
    updatedAt: a.updatedAt.toISOString(),
  };
}
