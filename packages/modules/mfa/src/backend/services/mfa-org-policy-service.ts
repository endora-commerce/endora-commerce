import type { EntityManager } from '@mikro-orm/postgresql';
import { MfaOrganizationPolicy } from '../entities/mfa-organization-policy.entity.js';
import type { Command, CommandBus } from '@endora-commerce/platform/commands';
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
    /**
     * Issue #983 — the write runs through the Command Bus (Constitution XIII),
     * which records its one `mfa.org_enforced` audit entry co-transactionally.
     * Optional only for a hand-built service (a test); the module always
     * composes it with the bus.
     */
    private readonly commandBus?: CommandBus,
    /**
     * Issue #947 — whether this composition can enrol a second factor (it was
     * given an encryption key). Defaults to `true`, which refuses nothing.
     */
    private readonly canEnrolSecondFactor: boolean = true,
  ) {}

  /**
   * Set whether the organization requires its members to use a second factor.
   * Both writers reach it — the storefront organization administrator's
   * `PUT /api/v1/account/organization/mfa-policy` and the Admin UI's
   * `POST /api/v1/admin/organizations/:organizationId/mfa-policy` — so neither
   * route records an audit entry of its own.
   *
   * Issue #947 — without a key, requiring a second factor of the members is
   * refused (`409 MFA_ENFORCEMENT_UNAVAILABLE`), off → on only: lifting the
   * policy, and writing `true` over `true`, are never refused.
   */
  async setEnforcement(
    organizationId: string,
    enforceTotp: boolean,
    actor: string,
  ): Promise<{ enforceTotp: boolean }> {
    if (this.commandBus) {
      return this.commandBus.run(this.#setEnforcementCommand(organizationId, enforceTotp, actor));
    }
    const em = this.emFactory();
    await this.#applyEnforcement(em, organizationId, enforceTotp, actor);
    await em.flush();
    return { enforceTotp };
  }

  #setEnforcementCommand(
    organizationId: string,
    enforceTotp: boolean,
    actor: string,
  ): Command<{ enforceTotp: boolean }> {
    return {
      action: 'mfa.org_enforced',
      objectType: 'organization',
      objectId: organizationId,
      run: async ({ em }) => {
        const before = await this.#applyEnforcement(em, organizationId, enforceTotp, actor);
        return { result: { enforceTotp }, before, after: { enforceTotp } };
      },
    };
  }

  /** The write itself, on `em`; answers the replaced value (`null` for a first policy). */
  async #applyEnforcement(
    em: EntityManager,
    organizationId: string,
    enforceTotp: boolean,
    actor: string,
  ): Promise<{ enforceTotp: boolean } | null> {
    const policy = await em.findOne(MfaOrganizationPolicy, { organizationId });
    if (enforceTotp && !this.canEnrolSecondFactor && policy?.enforceTotp !== true) {
      throw customerEnforcementUnavailable();
    }
    if (!policy) {
      em.persist(em.create(MfaOrganizationPolicy, { organizationId, enforceTotp, updatedByActor: actor }));
      return null;
    }
    const before = { enforceTotp: policy.enforceTotp };
    policy.enforceTotp = enforceTotp;
    policy.updatedByActor = actor;
    return before;
  }

  async getEnforcement(organizationId: string): Promise<boolean> {
    const em = this.emFactory();
    const policy = await em.findOne(MfaOrganizationPolicy, { organizationId });
    return policy?.enforceTotp ?? false;
  }
}
