import type { FastifyInstance, FastifyReply } from 'fastify';
import { mfaVerifyRequestSchema } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import { SESSION_COOKIE_NAME } from '../auth/plugin.js';
import type { SessionService } from '../auth/services/session-service.js';
import type { MfaLoginService } from './services/mfa-login-service.js';

/**
 * Public MFA endpoints (feature 042). The customer second-step verify lives
 * here; admin verify + OAuth callbacks are added by later user stories.
 */
export interface MfaPublicDeps {
  loginService: MfaLoginService;
  sessionService: SessionService;
}

export async function registerMfaPublicRoutes(
  app: FastifyInstance,
  deps: MfaPublicDeps,
): Promise<void> {
  const { loginService, sessionService } = deps;

  app.post(
    '/api/v1/auth/customer/mfa/verify',
    { schema: { body: mfaVerifyRequestSchema } },
    async (request, reply) => {
      const body = mfaVerifyRequestSchema.parse(request.body);
      const result = await loginService.verifyChallenge(body.challengeId, body.code);
      if (!result.ok) {
        if (result.error === 'invalid_challenge') {
          throw new HttpError(400, 'MFA_INVALID_CHALLENGE', 'This login attempt has expired. Please sign in again.');
        }
        if (result.error === 'locked') {
          throw new HttpError(429, 'MFA_TOO_MANY_ATTEMPTS', 'Too many incorrect codes. Please sign in again.');
        }
        throw new HttpError(401, 'MFA_INVALID_CODE', 'The code is invalid or expired.');
      }
      if (result.subject.subjectType !== 'customer') {
        throw new HttpError(400, 'MFA_WRONG_SURFACE', 'This challenge is not for the storefront.');
      }
      const session = await sessionService.createSession({
        kind: 'customer',
        customerAccountId: result.subject.subjectId,
        ...(request.ip ? { ipAddress: request.ip } : {}),
        ...(typeof request.headers['user-agent'] === 'string'
          ? { userAgent: request.headers['user-agent'] }
          : {}),
      });
      setCustomerSessionCookie(reply, session.cookieValue, session.expiresAt);
      return { data: { status: 'authenticated' } };
    },
  );
}

function setCustomerSessionCookie(
  reply: FastifyReply,
  value: string,
  expiresAt: Date,
): void {
  reply.setCookie(SESSION_COOKIE_NAME, value, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env['NODE_ENV'] === 'production',
    expires: expiresAt,
    signed: false,
  });
}
