import type { EntityManager } from '@mikro-orm/postgresql';
import { MfaOrganizationPolicy } from '../entities/mfa-organization-policy.entity.js';
import { recordAuditFromContext } from '../../../commands/index.js';
import type { AuditLogService } from '../../../kernel/audit/audit-log-service.js';

/**
 * Per-organization 2FA enforcement (feature 042, US3, FR-014). Owned by the
 * `mfa` module; consulted additively by `MfaPolicyResolver`.
 */
export class MfaOrgPolicyService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog?: AuditLogService,
  ) {}

  async setEnforcement(
    organizationId: string,
    enforceTotp: boolean,
    actor: string,
  ): Promise<{ enforceTotp: boolean }> {
    const em = this.emFactory();
    let policy = await em.findOne(MfaOrganizationPolicy, { organizationId });
    if (!policy) {
      policy = em.create(MfaOrganizationPolicy, { organizationId, enforceTotp, updatedByActor: actor });
      em.persist(policy);
    } else {
      policy.enforceTotp = enforceTotp;
      policy.updatedByActor = actor;
    }
    if (this.auditLog) {
      recordAuditFromContext(this.auditLog, em, {
        action: 'mfa.set_org_enforcement',
        objectType: 'mfa_organization_policy',
        objectId: organizationId,
        stateBefore: null,
        stateAfter: { enforceTotp },
      });
    }
    await em.flush();
    return { enforceTotp };
  }

  async getEnforcement(organizationId: string): Promise<boolean> {
    const em = this.emFactory();
    const policy = await em.findOne(MfaOrganizationPolicy, { organizationId });
    return policy?.enforceTotp ?? false;
  }
}
