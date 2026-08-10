import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  mfaActivateRequestSchema,
  mfaDisableRequestSchema,
  mfaRegenerateRequestSchema,
} from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { MfaSubjectRef } from '../auth/services/mfa-login-port.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { MfaEnrolmentService } from './services/mfa-enrolment-service.js';
import type { MfaPolicyResolver } from './services/mfa-policy-resolver.js';

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
  policyResolver: MfaPolicyResolver;
  auditLogService: AuditLogService;
  resolveAccountEmail?: (
    subjectType: 'customer' | 'admin',
    subjectId: string,
  ) => Promise<string | null>;
  verifyAccountPassword?: (
    subjectType: 'customer' | 'admin',
    subjectId: string,
    password: string,
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
      salesChannelId:
        (request as { salesChannel?: { id: string } }).salesChannel?.id ?? null,
      organizationId: opts.resolveOrganizationId?.(request) ?? null,
    });
    if (!policy.totpEnabled) {
      throw new HttpError(403, 'MFA_NOT_ENABLED', 'Two-factor authentication is not enabled for your account.');
    }
    const label =
      (await opts.resolveAccountEmail?.(subjectType, subject.subjectId)) ?? subject.subjectId;
    return { data: await enrolmentService.setup(subject, label) };
  });

  app.post(
    `${pathPrefix}/activate`,
    { preHandler: requireGuard, schema: { body: mfaActivateRequestSchema } },
    async (request) => {
      const body = mfaActivateRequestSchema.parse(request.body);
      const subject = subjectOf(request);
      const res = await enrolmentService.activate(subject, body.code);
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
      await reauthenticate(opts, subject, body);
      await enrolmentService.disable(subject);
      await auditLogService.record({
        action: 'mfa.disabled',
        objectType: auditObjectType,
        objectId: subject.subjectId,
        ...(request.ip ? { ipAddress: request.ip } : {}),
      });
      return { data: { status: 'disabled' } };
    },
  );

  app.post(
    `${pathPrefix}/recovery-codes/regenerate`,
    { preHandler: requireGuard, schema: { body: mfaRegenerateRequestSchema } },
    async (request) => {
      const body = mfaRegenerateRequestSchema.parse(request.body);
      const subject = subjectOf(request);
      const verified = await enrolmentService.verifySecondFactor(subject, body.code);
      if (!verified.ok) throw new HttpError(401, 'MFA_INVALID_CODE', 'The code is invalid or expired.');
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
      salesChannelId:
        (request as { salesChannel?: { id: string } }).salesChannel?.id ?? null,
      organizationId: opts.resolveOrganizationId?.(request) ?? null,
    });
    return {
      data: {
        totpActive: status.totpActive,
        recoveryCodesRemaining: status.recoveryCodesRemaining,
        totpEnabledForScope: policy.totpEnabled,
        totpEnforcedForScope: policy.totpEnforced,
        socialLinks: [],
      },
    };
  });
}

/** Re-auth on self-disable: a current TOTP/recovery code or the password. */
async function reauthenticate(
  opts: MfaSelfServiceOptions,
  subject: MfaSubjectRef,
  body: { code?: string | undefined; password?: string | undefined },
): Promise<void> {
  if (body.code) {
    const verified = await opts.enrolmentService.verifySecondFactor(subject, body.code);
    if (verified.ok) return;
    throw new HttpError(401, 'MFA_INVALID_CODE', 'The code is invalid or expired.');
  }
  if (body.password && opts.verifyAccountPassword) {
    const ok = await opts.verifyAccountPassword(subject.subjectType, subject.subjectId, body.password);
    if (ok) return;
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'The password is incorrect.');
  }
  throw new HttpError(400, 'MFA_REAUTH_REQUIRED', 'A current code is required to disable 2FA.');
}
