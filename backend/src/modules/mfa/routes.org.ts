import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { mfaOrgPolicyRequestSchema } from '@b2b/contracts';
import type { AuditPort } from '../../kernel/ports/audit.js';
import type { MfaOrgPolicyService } from './services/mfa-org-policy-service.js';

/**
 * Storefront org-admin 2FA enforcement (feature 042, US3, FR-014). An
 * Organization Administrator (customer role `organization_admin`) can require
 * 2FA for their own organization's members. The guard + organization id are
 * resolved by an injected port so the module stays decoupled.
 */
export interface MfaOrgRoutesDeps {
  orgPolicyService: MfaOrgPolicyService;
  auditLogService: AuditPort;
  requireCustomer: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  /** Resolves the caller's org and asserts they are an org admin (throws 403). */
  resolveOrgAdmin: (req: FastifyRequest) => Promise<{ organizationId: string; actor: string }>;
}

export async function registerMfaOrgRoutes(
  app: FastifyInstance,
  deps: MfaOrgRoutesDeps,
): Promise<void> {
  app.put(
    '/api/v1/account/organization/mfa-policy',
    { preHandler: deps.requireCustomer, schema: { body: mfaOrgPolicyRequestSchema } },
    async (request) => {
      const body = mfaOrgPolicyRequestSchema.parse(request.body);
      const { organizationId, actor } = await deps.resolveOrgAdmin(request);
      const res = await deps.orgPolicyService.setEnforcement(organizationId, body.enforceTotp, actor);
      await deps.auditLogService.record({
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
