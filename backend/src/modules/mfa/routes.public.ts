import type { FastifyInstance, FastifyReply } from 'fastify';
import { mfaVerifyRequestSchema } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { SESSION_COOKIE_NAME, ADMIN_SESSION_COOKIE_NAME } from '../auth/plugin.js';
import type { SessionService } from '../auth/services/session-service.js';
import type { MfaLoginService } from './services/mfa-login-service.js';

/**
 * Public MFA verify endpoints (feature 042). The customer (US1) and admin
 * (US2) second-step routes share one handler, differing only in the expected
 * subject surface, the session kind, and the cookie name.
 */
export interface MfaPublicDeps {
  loginService: MfaLoginService;
  sessionService: SessionService;
}

export async function registerMfaPublicRoutes(
  app: FastifyInstance,
  deps: MfaPublicDeps,
): Promise<void> {
  registerVerifyRoute(app, deps, {
    path: '/api/v1/auth/customer/mfa/verify',
    subjectType: 'customer',
    cookieName: SESSION_COOKIE_NAME,
  });
  registerVerifyRoute(app, deps, {
    path: '/api/v1/auth/admin/mfa/verify',
    subjectType: 'admin',
    cookieName: ADMIN_SESSION_COOKIE_NAME,
  });
}

function registerVerifyRoute(
  app: FastifyInstance,
  deps: MfaPublicDeps,
  cfg: { path: string; subjectType: 'customer' | 'admin'; cookieName: string },
): void {
  app.post(cfg.path, { schema: { body: mfaVerifyRequestSchema } }, async (request, reply) => {
    const body = mfaVerifyRequestSchema.parse(request.body);
    const result = await deps.loginService.verifyChallenge(body.challengeId, body.code);
    if (!result.ok) {
      if (result.error === 'invalid_challenge') {
        throw new HttpError(400, 'MFA_INVALID_CHALLENGE', 'This login attempt has expired. Please sign in again.');
      }
      if (result.error === 'locked') {
        throw new HttpError(429, 'MFA_TOO_MANY_ATTEMPTS', 'Too many incorrect codes. Please sign in again.');
      }
      throw new HttpError(401, 'MFA_INVALID_CODE', 'The code is invalid or expired.');
    }
    if (result.subject.subjectType !== cfg.subjectType) {
      throw new HttpError(400, 'MFA_WRONG_SURFACE', 'This challenge is not valid here.');
    }
    const session = await deps.sessionService.createSession(
      cfg.subjectType === 'customer'
        ? {
            kind: 'customer',
            customerAccountId: result.subject.subjectId,
            ...ipUa(request),
          }
        : {
            kind: 'admin',
            adminUserId: result.subject.subjectId,
            ...ipUa(request),
          },
    );
    setSessionCookie(reply, cfg.cookieName, session.cookieValue, session.expiresAt);
    return { data: { status: 'authenticated' } };
  });
}

function ipUa(request: {
  ip?: string;
  headers: Record<string, unknown>;
}): { ipAddress?: string; userAgent?: string } {
  return {
    ...(request.ip ? { ipAddress: request.ip } : {}),
    ...(typeof request.headers['user-agent'] === 'string'
      ? { userAgent: request.headers['user-agent'] as string }
      : {}),
  };
}

function setSessionCookie(
  reply: FastifyReply,
  cookieName: string,
  value: string,
  expiresAt: Date,
): void {
  reply.setCookie(cookieName, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    expires: expiresAt,
    signed: false,
  });
}
