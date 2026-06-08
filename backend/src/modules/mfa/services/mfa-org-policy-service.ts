import type { EntityManager } from '@mikro-orm/postgresql';
import { MfaOrganizationPolicy } from '../entities/mfa-organization-policy.entity.js';

/**
 * Per-organization 2FA enforcement (feature 042, US3, FR-014). Owned by the
 * `mfa` module; consulted additively by `MfaPolicyResolver`.
 */
export class MfaOrgPolicyService {
  constructor(private readonly emFactory: () => EntityManager) {}

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
    await em.flush();
    return { enforceTotp };
  }

  async getEnforcement(organizationId: string): Promise<boolean> {
    const em = this.emFactory();
    const policy = await em.findOne(MfaOrganizationPolicy, { organizationId });
    return policy?.enforceTotp ?? false;
  }
}
