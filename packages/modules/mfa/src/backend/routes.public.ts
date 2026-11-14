// `reply.setCookie` is not on `FastifyReply`: it is a declaration-merging
// augmentation `@fastify/cookie` contributes. Inside `backend/src` that
// augmentation arrived ambiently, through the host's own dependency and its
// `types` graph — so nothing in this module ever named it. A package compiles
// against its own manifest, where an unnamed dependency does not exist, and the
// property simply is not there (TS2339). The import is type-only, so it loads
// the declarations and emits nothing: registering the plugin stays the host's
// job, exactly as before.
import type {} from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  mfaVerifyRequestSchema,
  mfaSetupTicketBeginSchema,
  mfaSetupTicketCompleteSchema,
  SESSION_COOKIE_NAME,
  ADMIN_SESSION_COOKIE_NAME,
} from '@endora-commerce/contracts';
import type {
  AdminAuthenticationThrottlePort,
  AuthSessionPort,
  CartMergeOutcomePublic,
  CustomerAuthenticationThrottlePort,
  CustomerSignInCompletionPort,
} from '@endora-commerce/contracts';
import { readKnownDevice, rememberKnownDevice } from './known-device-cookie.js';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import type { MfaLoginService } from './services/mfa-login-service.js';
import type { ChallengeStore } from './services/challenge-store.js';
import type { MfaEnrolmentService } from './services/mfa-enrolment-service.js';
import type { CustomerChannelAccess } from './services/customer-channel-access.js';

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
  /**
   * Mint the known-device cookie value once a sign-in has completed here — the
   * second step, or the enforced enrolment — for an administrator and for a
   * customer respectively.
   */
  adminAuthenticationThrottle: Pick<AdminAuthenticationThrottlePort, 'issueKnownDevice'>;
  customerAuthenticationThrottle: Pick<CustomerAuthenticationThrottlePort, 'issueKnownDevice'>;
  /**
   * Feature 154 — both routes below complete a customer sign-in begun earlier,
   * and both are open to the kernel's access step, so the access rule is
   * re-decided here on the channel the sign-in was begun on: an assignment
   * removed between the password and the code issues no session.
   */
  customerChannelAccess: Pick<CustomerChannelAccess, 'assertAccountMayUse'>;
  /**
   * Issue #368 — `organizations`' post-sign-in step (the signed-out basket
   * merged, the anonymous comparison adopted). The password sign-in runs it
   * itself, but returns before it whenever a second step is required, so the
   * two customer routes here that establish the session run it instead.
   */
  customerSignInCompletion: Pick<CustomerSignInCompletionPort, 'complete'>;
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
  // Feature 154 — reachable whatever the sales-channel access rule decides:
  // a second-factor set-up ticket is completed before a session exists.
  app.post(cfg.setupBeginPath, { schema: { body: mfaSetupTicketBeginSchema }, config: { salesChannelAccess: 'open' } }, async (request) => {
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
    { schema: { body: mfaSetupTicketCompleteSchema }, config: { salesChannelAccess: 'open' } },
    async (request, reply) => {
      const body = mfaSetupTicketCompleteSchema.parse(request.body);
      const ticket = await resolveTicket(deps, body.setupTicket, cfg.subjectType);
      // Feature 154 — before the enrolment is activated, so a refused sign-in
      // leaves the account as it found it.
      if (cfg.subjectType === 'customer') {
        await deps.customerChannelAccess.assertAccountMayUse(
          ticket.subjectId,
          ticket.salesChannelId,
        );
      }
      const subject = { subjectType: cfg.subjectType, subjectId: ticket.subjectId } as const;
      const { recoveryCodes } = await deps.enrolmentService.activate(subject, body.code);
      await deps.challengeStore.consumeSetupTicket(body.setupTicket);
      const session = await deps.sessionService.createSession(
        cfg.subjectType === 'customer'
          ? { kind: 'customer', customerAccountId: ticket.subjectId, ...ipUa(request) }
          : { kind: 'admin', adminUserId: ticket.subjectId, ...ipUa(request) },
      );
      setSessionCookie(reply, cfg.cookieName, session.cookieValue, session.expiresAt);
      await rememberDevice(deps, reply, cfg.subjectType, ticket.subjectId);
      const cartMerge = await completeSignIn(deps, request, reply, cfg.subjectType, ticket.subjectId);
      return { data: { status: 'authenticated', recoveryCodes, ...(cartMerge ? { cartMerge } : {}) } };
    },
  );
}

async function resolveTicket(
  deps: MfaPublicDeps,
  setupTicket: string,
  subjectType: 'customer' | 'admin',
): Promise<{ subjectId: string; salesChannelId: string | null }> {
  const ticket = await deps.challengeStore.getSetupTicket(setupTicket);
  if (!ticket || ticket.subjectType !== subjectType) {
    throw new HttpError(400, 'MFA_INVALID_CHALLENGE', 'This setup session has expired. Please sign in again.');
  }
  return { subjectId: ticket.subjectId, salesChannelId: ticket.salesChannelId };
}

function registerVerifyRoute(
  app: FastifyInstance,
  deps: MfaPublicDeps,
  cfg: { path: string; subjectType: 'customer' | 'admin'; cookieName: string },
): void {
  // Feature 154 — reachable whatever the sales-channel access rule decides:
  // the second factor of a sign-in is verified before a session exists.
  app.post(cfg.path, { schema: { body: mfaVerifyRequestSchema }, config: { salesChannelAccess: 'open' } }, async (request, reply) => {
    const body = mfaVerifyRequestSchema.parse(request.body);
    const objectType = cfg.subjectType === 'customer' ? 'customer_account' : 'admin_user';
    const knownDevice = readKnownDevice(request, cfg.subjectType);
    const result = await deps.loginService.verifyChallenge(body.challengeId, body.code, {
      ...(request.ip ? { ip: request.ip } : {}),
      ...(knownDevice !== undefined ? { knownDevice } : {}),
    });
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
    // Feature 154 — the access rule, on the channel the sign-in was begun on.
    if (cfg.subjectType === 'customer') {
      await deps.customerChannelAccess.assertAccountMayUse(
        result.subject.subjectId,
        result.salesChannelId,
      );
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
    await rememberDevice(deps, reply, cfg.subjectType, result.subject.subjectId);
    const cartMerge = await completeSignIn(deps, request, reply, cfg.subjectType, result.subject.subjectId);
    return { data: { status: 'authenticated', ...(cartMerge ? { cartMerge } : {}) } };
  });
}

/**
 * A sign-in has completed on this response: leave the surface's known-device
 * cookie beside the session, minted by the throttle that owns the account.
 */
async function rememberDevice(
  deps: MfaPublicDeps,
  reply: FastifyReply,
  subjectType: 'customer' | 'admin',
  subjectId: string,
): Promise<void> {
  const value =
    subjectType === 'admin'
      ? await deps.adminAuthenticationThrottle.issueKnownDevice(subjectId)
      : await deps.customerAuthenticationThrottle.issueKnownDevice(subjectId);
  rememberKnownDevice(reply, value, subjectType);
}

/**
 * A customer session has been established on this response: run the
 * post-sign-in step `organizations` owns (issue #368) and drop the anonymous
 * basket's cookie when the step consumed it. Answers the merge the storefront
 * reads, or `null`. An administrator has no basket, so the admin surface skips
 * it. The step is best-effort inside its owner and does not throw for a failed
 * merge, so nothing here catches.
 */
async function completeSignIn(
  deps: MfaPublicDeps,
  request: FastifyRequest,
  reply: FastifyReply,
  subjectType: 'customer' | 'admin',
  subjectId: string,
): Promise<CartMergeOutcomePublic | null> {
  if (subjectType !== 'customer') return null;
  const completion = await deps.customerSignInCompletion.complete({
    customerAccountId: subjectId,
    cookies: request.cookies ?? {},
    log: request.log,
  });
  if (completion.clearAnonymousCartCookie) {
    reply.clearCookie(ANON_CART_COOKIE_NAME, { path: '/' });
  }
  return completion.cartMerge;
}

/** The signed-out basket's cookie, as `carts` sets it and the storefront forwards it. */
const ANON_CART_COOKIE_NAME = 'b2b_cart_anon';

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
