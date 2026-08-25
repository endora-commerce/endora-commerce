// `reply.setCookie` is not on `FastifyReply`: it is a declaration-merging
// augmentation `@fastify/cookie` contributes. Inside `backend/src` that
// augmentation arrived ambiently, through the host's own dependency and its
// `types` graph — so nothing in this module ever named it. A package compiles
// against its own manifest, where an unnamed dependency does not exist, and the
// property simply is not there (TS2339). The import is type-only, so it loads
// the declarations and emits nothing: registering the plugin stays the host's
// job, exactly as before.
import type {} from '@fastify/cookie';
import type { FastifyInstance, FastifyReply } from 'fastify';
import {
  mfaVerifyRequestSchema,
  mfaSetupTicketBeginSchema,
  mfaSetupTicketCompleteSchema,
  SESSION_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from '@endora-commerce/contracts';
import type { AuthSessionPort } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { MfaLoginService } from './services/mfa-login-service.js';
import type { ChallengeStore } from './services/challenge-store.js';
import type { MfaEnrolmentService } from './services/mfa-enrolment-service.js';

/**
 * Public MFA endpoints (feature 042). Per surface (customer US1 / admin US2):
 * the second-step verify, and the enforced-but-unenrolled setup-ticket flow
 * (US3). They differ only in the expected subject surface, session kind, and
 * cookie name.
 */
export interface MfaPublicDeps {
  loginService: MfaLoginService;
  sessionService: AuthSessionPort;
  challengeStore: ChallengeStore;
  enrolmentService: MfaEnrolmentService;
  auditLogService: AuditPort;
}

interface SurfaceCfg {
  subjectType: 'customer' | 'admin';
  cookieName: string;
  verifyPath: string;
  setupBeginPath: string;
  setupCompletePath: string;
}

const SURFACES: SurfaceCfg[] = [
  {
    subjectType: 'customer',
    cookieName: SESSION_COOKIE_NAME,
    verifyPath: '/api/v1/auth/customer/mfa/verify',
    setupBeginPath: '/api/v1/auth/customer/mfa/setup-ticket/begin',
    setupCompletePath: '/api/v1/auth/customer/mfa/setup-ticket/complete',
  },
  {
    subjectType: 'admin',
    cookieName: ADMIN_SESSION_COOKIE_NAME,
    verifyPath: '/api/v1/auth/admin/mfa/verify',
    setupBeginPath: '/api/v1/auth/admin/mfa/setup-ticket/begin',
    setupCompletePath: '/api/v1/auth/admin/mfa/setup-ticket/complete',
  },
];

export async function registerMfaPublicRoutes(
  app: FastifyInstance,
  deps: MfaPublicDeps,
): Promise<void> {
  for (const cfg of SURFACES) {
    registerVerifyRoute(app, deps, { path: cfg.verifyPath, subjectType: cfg.subjectType, cookieName: cfg.cookieName });
    registerSetupTicketRoutes(app, deps, cfg);
  }
}

/** Enforced-but-unenrolled flow: enrol using a setup ticket, then get a session. */
function registerSetupTicketRoutes(
  app: FastifyInstance,
  deps: MfaPublicDeps,
  cfg: SurfaceCfg,
): void {
  app.post(cfg.setupBeginPath, { schema: { body: mfaSetupTicketBeginSchema } }, async (request) => {
    const body = mfaSetupTicketBeginSchema.parse(request.body);
    const ticket = await resolveTicket(deps, body.setupTicket, cfg.subjectType);
    return {
      data: await deps.enrolmentService.setup(
        { subjectType: cfg.subjectType, subjectId: ticket.subjectId },
        ticket.subjectId,
      ),
    };
  });

  app.post(
    cfg.setupCompletePath,
    { schema: { body: mfaSetupTicketCompleteSchema } },
    async (request, reply) => {
      const body = mfaSetupTicketCompleteSchema.parse(request.body);
      const ticket = await resolveTicket(deps, body.setupTicket, cfg.subjectType);
      const subject = { subjectType: cfg.subjectType, subjectId: ticket.subjectId } as const;
      const { recoveryCodes } = await deps.enrolmentService.activate(subject, body.code);
      await deps.challengeStore.consumeSetupTicket(body.setupTicket);
      const session = await deps.sessionService.createSession(
        cfg.subjectType === 'customer'
          ? { kind: 'customer', customerAccountId: ticket.subjectId, ...ipUa(request) }
          : { kind: 'admin', adminUserId: ticket.subjectId, ...ipUa(request) },
      );
      setSessionCookie(reply, cfg.cookieName, session.cookieValue, session.expiresAt);
      return { data: { status: 'authenticated', recoveryCodes } };
    },
  );
}

async function resolveTicket(
  deps: MfaPublicDeps,
  setupTicket: string,
  subjectType: 'customer' | 'admin',
): Promise<{ subjectId: string }> {
  const ticket = await deps.challengeStore.getSetupTicket(setupTicket);
  if (!ticket || ticket.subjectType !== subjectType) {
    throw new HttpError(400, 'MFA_INVALID_CHALLENGE', 'This setup session has expired. Please sign in again.');
  }
  return { subjectId: ticket.subjectId };
}

function registerVerifyRoute(
  app: FastifyInstance,
  deps: MfaPublicDeps,
  cfg: { path: string; subjectType: 'customer' | 'admin'; cookieName: string },
): void {
  app.post(cfg.path, { schema: { body: mfaVerifyRequestSchema } }, async (request, reply) => {
    const body = mfaVerifyRequestSchema.parse(request.body);
    const objectType = cfg.subjectType === 'customer' ? 'customer_account' : 'admin_user';
    const result = await deps.loginService.verifyChallenge(body.challengeId, body.code);
    if (!result.ok) {
      if (result.error === 'invalid_challenge') {
        throw new HttpError(400, 'MFA_INVALID_CHALLENGE', 'This login attempt has expired. Please sign in again.');
      }
      if (result.error === 'locked') {
        await deps.auditLogService.record({
          action: 'mfa.second_step_locked',
          objectType,
          objectId: result.subject.subjectId,
          ...(request.ip ? { ipAddress: request.ip } : {}),
        });
        throw new HttpError(429, 'MFA_TOO_MANY_ATTEMPTS', 'Too many incorrect codes. Please sign in again.');
      }
      throw new HttpError(401, 'MFA_INVALID_CODE', 'The code is invalid or expired.');
    }
    if (result.subject.subjectType !== cfg.subjectType) {
      throw new HttpError(400, 'MFA_WRONG_SURFACE', 'This challenge is not valid here.');
    }
    if (result.factor === 'recovery') {
      await deps.auditLogService.record({
        action: 'mfa.recovery_code_used',
        objectType,
        objectId: result.subject.subjectId,
        ...(request.ip ? { ipAddress: request.ip } : {}),
      });
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
