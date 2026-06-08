import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import {
  mfaActivateRequestSchema,
  mfaDisableRequestSchema,
  mfaRegenerateRequestSchema,
} from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { MfaSubjectRef } from '../auth/services/mfa-login-port.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import type { MfaEnrolmentService } from './services/mfa-enrolment-service.js';
import type { MfaPolicyResolver } from './services/mfa-policy-resolver.js';

/**
 * Storefront self-service 2FA endpoints (feature 042, US1). The customer must
 * be authenticated; the enforced-but-unenrolled setup-ticket path arrives in
 * US3. Audit entries are written for enable/disable/regenerate.
 */
export interface MfaAccountDeps {
  enrolmentService: MfaEnrolmentService;
  policyResolver: MfaPolicyResolver;
  auditLogService: AuditLogService;
  requireCustomer: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  resolveCustomerActor: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string | null;
  };
  /** Resolves the account's email for the authenticator label (optional). */
  resolveAccountEmail?: (
    subjectType: 'customer' | 'admin',
    subjectId: string,
  ) => Promise<string | null>;
  /** Verifies an account password for re-auth on disable (optional). */
  verifyAccountPassword?: (
    subjectType: 'customer' | 'admin',
    subjectId: string,
    password: string,
  ) => Promise<boolean>;
}

export async function registerMfaAccountRoutes(
  app: FastifyInstance,
  deps: MfaAccountDeps,
): Promise<void> {
  const {
    enrolmentService,
    policyResolver,
    auditLogService,
    requireCustomer,
    resolveCustomerActor,
  } = deps;

  const subjectOf = (req: FastifyRequest): MfaSubjectRef => ({
    subjectType: 'customer',
    subjectId: resolveCustomerActor(req).customerAccountId,
  });

  app.post(
    '/api/v1/account/mfa/setup',
    { preHandler: requireCustomer },
    async (request) => {
      const subject = subjectOf(request);
      const label =
        (await deps.resolveAccountEmail?.('customer', subject.subjectId)) ??
        subject.subjectId;
      const res = await enrolmentService.setup(subject, label);
      return { data: res };
    },
  );

  app.post(
    '/api/v1/account/mfa/activate',
    { preHandler: requireCustomer, schema: { body: mfaActivateRequestSchema } },
    async (request) => {
      const body = mfaActivateRequestSchema.parse(request.body);
      const subject = subjectOf(request);
      const res = await enrolmentService.activate(subject, body.code);
      await auditLogService.record({
        action: 'mfa.enabled',
        objectType: 'customer_account',
        objectId: subject.subjectId,
        ...(request.ip ? { ipAddress: request.ip } : {}),
      });
      return { data: res };
    },
  );

  app.post(
    '/api/v1/account/mfa/disable',
    { preHandler: requireCustomer, schema: { body: mfaDisableRequestSchema } },
    async (request) => {
      const body = mfaDisableRequestSchema.parse(request.body);
      const subject = subjectOf(request);
      await reauthenticate(deps, subject, body);
      await enrolmentService.disable(subject);
      await auditLogService.record({
        action: 'mfa.disabled',
        objectType: 'customer_account',
        objectId: subject.subjectId,
        ...(request.ip ? { ipAddress: request.ip } : {}),
      });
      return { data: { status: 'disabled' } };
    },
  );

  app.post(
    '/api/v1/account/mfa/recovery-codes/regenerate',
    { preHandler: requireCustomer, schema: { body: mfaRegenerateRequestSchema } },
    async (request) => {
      const body = mfaRegenerateRequestSchema.parse(request.body);
      const subject = subjectOf(request);
      const ok = await enrolmentService.verifySecondFactor(subject, body.code);
      if (!ok) throw new HttpError(401, 'MFA_INVALID_CODE', 'The code is invalid or expired.');
      const res = await enrolmentService.regenerateRecoveryCodes(subject);
      await auditLogService.record({
        action: 'mfa.recovery_codes_regenerated',
        objectType: 'customer_account',
        objectId: subject.subjectId,
        ...(request.ip ? { ipAddress: request.ip } : {}),
      });
      return { data: res };
    },
  );

  app.get(
    '/api/v1/account/mfa/status',
    { preHandler: requireCustomer },
    async (request) => {
      const actor = resolveCustomerActor(request);
      const subject: MfaSubjectRef = {
        subjectType: 'customer',
        subjectId: actor.customerAccountId,
      };
      const status = await enrolmentService.status(subject);
      const policy = await policyResolver.resolve(subject, {
        salesChannelId:
          (request as { salesChannel?: { id: string } }).salesChannel?.id ?? null,
        organizationId: actor.organizationId,
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
    },
  );
}

/** Re-auth on self-disable: a current TOTP/recovery code or the password. */
async function reauthenticate(
  deps: MfaAccountDeps,
  subject: MfaSubjectRef,
  body: { code?: string | undefined; password?: string | undefined },
): Promise<void> {
  if (body.code) {
    const ok = await deps.enrolmentService.verifySecondFactor(subject, body.code);
    if (ok) return;
    throw new HttpError(401, 'MFA_INVALID_CODE', 'The code is invalid or expired.');
  }
  if (body.password && deps.verifyAccountPassword) {
    const ok = await deps.verifyAccountPassword('customer', subject.subjectId, body.password);
    if (ok) return;
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'The password is incorrect.');
  }
  throw new HttpError(400, 'MFA_REAUTH_REQUIRED', 'A current code is required to disable 2FA.');
}
