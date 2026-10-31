import type {} from '@fastify/cookie';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  ERROR_CODES,
  mfaActivateRequestSchema,
  mfaDisableRequestSchema,
  mfaRegenerateRequestSchema,
  mfaSocialUnlinkParamsSchema,
} from '@endora-commerce/contracts';
import type { AdminAuthenticationOrigin, MfaSubjectRef } from '@endora-commerce/contracts';
import { readKnownDevice } from './known-device-cookie.js';
import { HttpError } from '@endora-commerce/platform/http';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { currentSalesChannel } from '@endora-commerce/platform/kernel';
import type { MfaEnrolmentService } from './services/mfa-enrolment-service.js';
import type { SecondFactorVerifier } from './services/second-factor-verifier.js';
import type { MfaPolicyResolver } from './services/mfa-policy-resolver.js';
import type { SocialLinkService } from './services/social-link-service.js';
import type { FactorWithdrawal } from './services/factor-withdrawal.js';

/**
 * Surface-agnostic self-service 2FA endpoints (feature 042). Mounted twice by
 * the plugin: once for storefront customers (`/api/v1/account/mfa/*`, US1) and
 * once for admin users (`/api/v1/admin/account/mfa/*`, US2). The only
 * differences are the path prefix, the auth guard, how the subject id is
 * resolved, and the audit `objectType`.
 */
export interface MfaSelfServiceOptions {
  pathPrefix: string;
  subjectType: 'customer' | 'admin';
  auditObjectType: 'customer_account' | 'admin_user';
  requireGuard: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  resolveSubjectId: (req: FastifyRequest) => string;
  resolveOrganizationId?: (req: FastifyRequest) => string | null;
  enrolmentService: MfaEnrolmentService;
  /**
   * The check behind every code these routes take as proof — an
   * administrator's goes through the account's authentication throttle.
   */
  verifySecondFactor: SecondFactorVerifier;
  policyResolver: MfaPolicyResolver;
  socialLinkService: SocialLinkService;
  auditLogService: AuditPort;
  /** The cookie this surface's sessions travel in. */
  sessionCookieName: string;
  /** Ends the subject's other sessions and pending logins once a factor is removed. */
  withdrawFactorGrants: FactorWithdrawal;
  /**
   * `specs/110-instance-repository/` T118c — required, both of them. `mfa`
   * resolves each from its owner's published port rather than taking whatever a
   * composition root happened to contribute, and while they were optional the
   * two roots disagreed: production answered both, the test harness neither.
   */
  resolveAccountEmail: (
    subjectType: 'customer' | 'admin',
    subjectId: string,
  ) => Promise<string | null>;
  verifyAccountPassword: (
    subjectType: 'customer' | 'admin',
    subjectId: string,
    password: string,
    context?: AdminAuthenticationOrigin,
  ) => Promise<boolean>;
}

export async function registerMfaSelfServiceRoutes(
  app: FastifyInstance,
  opts: MfaSelfServiceOptions,
): Promise<void> {
  const {
    pathPrefix,
    subjectType,
    auditObjectType,
    requireGuard,
    resolveSubjectId,
    enrolmentService,
    policyResolver,
    socialLinkService,
    auditLogService,
  } = opts;

  const subjectOf = (req: FastifyRequest): MfaSubjectRef => ({
    subjectType,
    subjectId: resolveSubjectId(req),
  });

  app.post(`${pathPrefix}/setup`, { preHandler: requireGuard }, async (request) => {
    const subject = subjectOf(request);
    // FR-001 — enrolment is only permitted when 2FA is enabled for the scope.
    const policy = await policyResolver.resolve(subject, {
      salesChannelId: currentSalesChannel()?.id ?? null,
      organizationId: opts.resolveOrganizationId?.(request) ?? null,
    });
    if (!policy.totpEnabled) {
      throw new HttpError(403, 'MFA_NOT_ENABLED', 'Two-step verification is not enabled for your account.');
    }
    const label =
      (await opts.resolveAccountEmail(subjectType, subject.subjectId)) ?? subject.subjectId;
    return { data: await enrolmentService.setup(subject, label) };
  });

  app.post(
    `${pathPrefix}/activate`,
    { preHandler: requireGuard, schema: { body: mfaActivateRequestSchema } },
    async (request) => {
      const body = mfaActivateRequestSchema.parse(request.body);
      const subject = subjectOf(request);
      const res = await asSignedInRefusal(enrolmentService.activate(subject, body.code));
      await auditLogService.record({
        action: 'mfa.enabled',
        objectType: auditObjectType,
        objectId: subject.subjectId,
        ...(request.ip ? { ipAddress: request.ip } : {}),
      });
      return { data: res };
    },
  );

  app.post(
    `${pathPrefix}/disable`,
    { preHandler: requireGuard, schema: { body: mfaDisableRequestSchema } },
    async (request) => {
      const body = mfaDisableRequestSchema.parse(request.body);
      const subject = subjectOf(request);
      await reauthenticate(opts, subject, body, originOf(request, subjectType));
      const removed = await enrolmentService.disable(subject);
      await auditLogService.record({
        action: 'mfa.disabled',
        objectType: auditObjectType,
        objectId: subject.subjectId,
        ...(request.ip ? { ipAddress: request.ip } : {}),
      });
      // The factor is gone; the sessions it protected elsewhere go with it.
      // The one this request was made from stays.
      if (removed) {
        await opts.withdrawFactorGrants(subject, request.cookies?.[opts.sessionCookieName]);
      }
      return { data: { status: 'disabled' } };
    },
  );

  app.post(
    `${pathPrefix}/recovery-codes/regenerate`,
    { preHandler: requireGuard, schema: { body: mfaRegenerateRequestSchema } },
    async (request) => {
      const body = mfaRegenerateRequestSchema.parse(request.body);
      const subject = subjectOf(request);
      const verified = await opts.verifySecondFactor(subject, body.code, originOf(request, subjectType));
      if (!verified.ok) throw wrongCode();
      const res = await enrolmentService.regenerateRecoveryCodes(subject);
      await auditLogService.record({
        action: 'mfa.recovery_codes_regenerated',
        objectType: auditObjectType,
        objectId: subject.subjectId,
        ...(request.ip ? { ipAddress: request.ip } : {}),
      });
      return { data: res };
    },
  );

  app.get(`${pathPrefix}/status`, { preHandler: requireGuard }, async (request) => {
    const subject = subjectOf(request);
    const status = await enrolmentService.status(subject);
    const policy = await policyResolver.resolve(subject, {
      salesChannelId: currentSalesChannel()?.id ?? null,
      organizationId: opts.resolveOrganizationId?.(request) ?? null,
    });
    return {
      data: {
        totpActive: status.totpActive,
        recoveryCodesRemaining: status.recoveryCodesRemaining,
        totpEnabledForScope: policy.totpEnabled,
        totpEnforcedForScope: policy.totpEnforced,
        // Issue #194 — the contract has declared this field since feature 042
        // and the handler answered `[]` unconditionally, so the account holder
        // could neither see a linked identity nor reach the route that removes
        // one. The verdict travels with each link, so the surface renders the
        // refusal instead of discovering it on the click.
        socialLinks: await socialLinkService.list(subject),
      },
    };
  });

  /**
   * Sever a federated identity (issue #194). Refused when it is the account's
   * only link — see {@link SocialLinkService} for why that is the rule and what
   * would be needed to relax it.
   */
  app.delete(
    `${pathPrefix}/social-links/:provider`,
    { preHandler: requireGuard, schema: { params: mfaSocialUnlinkParamsSchema } },
    async (request) => {
      const { provider } = mfaSocialUnlinkParamsSchema.parse(request.params);
      const subject = subjectOf(request);
      await socialLinkService.unlink(subject, provider);
      return { data: { status: 'unlinked' as const, provider } };
    },
  );
}

/**
 * Where the request came from, for the account owner's authentication
 * throttle: the verified known-device cookie of this surface.
 */
function originOf(
  request: FastifyRequest,
  subjectType: 'customer' | 'admin',
): AdminAuthenticationOrigin {
  const knownDevice = readKnownDevice(request, subjectType);
  return {
    ...(request.ip ? { ip: request.ip } : {}),
    ...(knownDevice !== undefined ? { knownDevice } : {}),
  };
}

/**
 * Issue #244 — a wrong confirmation on these routes refuses the confirmation,
 * not the session, so it answers `403` with a typed code rather than `401`.
 *
 * Every route here runs behind the account's own session guard: the caller is
 * signed in, and a `401` says otherwise. The Admin UI acts on that — any `401`
 * is an expired session and signs the administrator out — so a typo while
 * confirming 2FA setup, disabling it or regenerating recovery codes ended the
 * session instead of showing the error. #215 answers `403
 * CURRENT_PASSWORD_INVALID` for the same situation on the profile screen.
 *
 * Only here: the same codes answer `401` before a session exists — the login
 * challenge and enrolment during sign-in (`routes.public.ts`) — where it is
 * the right answer.
 */
function wrongCode(): HttpError {
  return new HttpError(403, 'MFA_INVALID_CODE', 'The code is invalid or expired.');
}

/**
 * `MfaEnrolmentService.activate` refuses a wrong code with the `401` the
 * sign-in enrolment answers; on a signed-in route it is {@link wrongCode}.
 */
async function asSignedInRefusal<T>(work: Promise<T>): Promise<T> {
  try {
    return await work;
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 401 && error.code === 'MFA_INVALID_CODE') {
      throw wrongCode();
    }
    throw error;
  }
}

/** Re-auth on self-disable: a current TOTP/recovery code or the password. */
async function reauthenticate(
  opts: MfaSelfServiceOptions,
  subject: MfaSubjectRef,
  body: { code?: string | undefined; password?: string | undefined },
  context: AdminAuthenticationOrigin,
): Promise<void> {
  if (body.code) {
    const verified = await opts.verifySecondFactor(subject, body.code, context);
    if (verified.ok) return;
    throw wrongCode();
  }
  if (body.password) {
    const ok = await opts.verifyAccountPassword(
      subject.subjectType,
      subject.subjectId,
      body.password,
      context,
    );
    if (ok) return;
    // `CURRENT_PASSWORD_INVALID`, not `INVALID_CREDENTIALS`: the latter's
    // sentence is the sign-in form's "invalid email or password", and nobody
    // typed an email here.
    throw new HttpError(403, ERROR_CODES.CURRENT_PASSWORD_INVALID, 'The current password is incorrect.');
  }
  throw new HttpError(400, 'MFA_REAUTH_REQUIRED', 'A current code is required to disable two-step verification.');
}
