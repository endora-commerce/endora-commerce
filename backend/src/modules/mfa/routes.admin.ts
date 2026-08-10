import type { FastifyInstance, FastifyRequest } from 'fastify';
import { mfaResetBulkRequestSchema, mfaOrgPolicyRequestSchema } from '@b2b/contracts';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import type { MfaEnrolmentService } from './services/mfa-enrolment-service.js';
import type { MfaOrgPolicyService } from './services/mfa-org-policy-service.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';

/**
 * Admin MFA management endpoints (feature 042). 2FA reset is a Platform-Admin
 * capability (`mfa:reset`, US6); per-organization enforcement is `mfa:manage`
 * (US3). Every mutation is audited.
 */
export interface MfaAdminDeps {
  enrolmentService: MfaEnrolmentService;
  orgPolicyService: MfaOrgPolicyService;
  auditLogService: AuditLogService;
  requireAdmin: RequireAdminFactory;
  resolveAdminActor: (req: FastifyRequest) => { adminUserId: string };
  /** Lists the customer-account ids belonging to an organization (US6 bulk). */
  resolveOrganizationCustomerIds: (organizationId: string) => Promise<string[]>;
}

export async function registerMfaAdminRoutes(
  app: FastifyInstance,
  deps: MfaAdminDeps,
): Promise<void> {
  const { enrolmentService, auditLogService, requireAdmin, resolveAdminActor } = deps;

  // Single-account reset (FR-025).
  app.post<{ Params: { customerId: string } }>(
    '/api/v1/admin/customers/:customerId/mfa/reset',
    { preHandler: requireAdmin('mfa:reset') },
    async (request) => {
      const { customerId } = request.params;
      const affected = await enrolmentService.reset({
        subjectType: 'customer',
        subjectId: customerId,
      });
      await auditLogService.record({
        actorAdminUserId: resolveAdminActor(request).adminUserId,
        action: 'mfa.reset',
        objectType: 'customer_account',
        objectId: customerId,
        stateAfter: { affected },
        ...(request.ip ? { ipAddress: request.ip } : {}),
      });
      return { data: { affected } };
    },
  );

  // Bulk reset by explicit ids or by organization (FR-026/028).
  app.post(
    '/api/v1/admin/mfa/reset-bulk',
    { preHandler: requireAdmin('mfa:reset'), schema: { body: mfaResetBulkRequestSchema } },
    async (request) => {
      const body = mfaResetBulkRequestSchema.parse(request.body);
      const actorAdminUserId = resolveAdminActor(request).adminUserId;
      const customerIds =
        'customerIds' in body
          ? body.customerIds
          : await deps.resolveOrganizationCustomerIds(body.organizationId);

      let affected = 0;
      for (const customerId of customerIds) {
        const did = await enrolmentService.reset({
          subjectType: 'customer',
          subjectId: customerId,
        });
        if (did) {
          affected += 1;
          await auditLogService.record({
            actorAdminUserId,
            action: 'mfa.reset',
            objectType: 'customer_account',
            objectId: customerId,
            ...(request.ip ? { ipAddress: request.ip } : {}),
          });
        }
      }
      const requested = customerIds.length;
      await auditLogService.record({
        actorAdminUserId,
        action: 'mfa.reset_bulk',
        objectType: 'customer_account',
        objectId: 'organizationId' in body ? body.organizationId : 'selection',
        stateAfter: { requested, affected, skipped: requested - affected },
        ...(request.ip ? { ipAddress: request.ip } : {}),
      });
      return { data: { requested, affected, skipped: requested - affected } };
    },
  );

  // Per-organization enforcement (FR-014, US3).
  app.post<{ Params: { organizationId: string } }>(
    '/api/v1/admin/organizations/:organizationId/mfa-policy',
    { preHandler: requireAdmin('mfa:manage'), schema: { body: mfaOrgPolicyRequestSchema } },
    async (request) => {
      const body = mfaOrgPolicyRequestSchema.parse(request.body);
      const { organizationId } = request.params;
      const actor = resolveAdminActor(request).adminUserId;
      const res = await deps.orgPolicyService.setEnforcement(organizationId, body.enforceTotp, actor);
      await auditLogService.record({
        actorAdminUserId: actor,
        action: 'mfa.org_enforced',
        objectType: 'organization',
        objectId: organizationId,
        stateAfter: { enforceTotp: body.enforceTotp },
        ...(request.ip ? { ipAddress: request.ip } : {}),
      });
      return { data: res };
    },
  );
}
