import type { EntityManager } from '@mikro-orm/postgresql';
import { MfaOrganizationPolicy } from '../entities/mfa-organization-policy.entity.js';
import { recordAuditFromContext } from '@endora-commerce/platform/commands';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { customerEnforcementUnavailable } from './customer-enforcement-without-key.js';

/**
 * Per-organization 2FA enforcement (feature 042, US3, FR-014). Owned by the
 * `mfa` module; consulted additively by `MfaPolicyResolver`.
 *
 * Issue #947 — any future admin or storefront screen that shows an
 * organization's MFA policy must show the same "not in force: no encryption
 * key" notice the Settings screen shows for `mfa.storefront.totp_enforced`
 * while no second factor can be enrolled.
 */
export class MfaOrgPolicyService {
  constructor(
    private readonly emFactory: () => EntityManager,
    private readonly auditLog?: AuditPort,
    /**
     * Issue #947 — whether this composition can enrol a second factor (it was
     * given an encryption key). Defaults to `true`, which refuses nothing.
     */
    private readonly canEnrolSecondFactor: boolean = true,
  ) {}

  /**
   * Issue #947 — without a key, requiring a second factor of the members is
   * refused (`409 MFA_ENFORCEMENT_UNAVAILABLE`), off → on only: lifting the
   * policy, and writing `true` over `true`, are never refused. Both writes —
   * the storefront administrator's and the Admin UI's — come through here.
   */

  async setEnforcement(
    organizationId: string,
    enforceTotp: boolean,
    actor: string,
  ): Promise<{ enforceTotp: boolean }> {
    const em = this.emFactory();
    let policy = await em.findOne(MfaOrganizationPolicy, { organizationId });
    if (enforceTotp && !this.canEnrolSecondFactor && policy?.enforceTotp !== true) {
      throw customerEnforcementUnavailable();
    }
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
