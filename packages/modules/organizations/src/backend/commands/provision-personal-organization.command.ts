import { hookableAction, type OrganizationRecord } from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { Organization } from '../entities/organization.entity.js';
import { ORGANIZATION_CREATED_FIELDS, presentFields } from '../services/organization-audit-state.js';
import { toOrganizationRecord } from '../services/organization-details-port.js';

/**
 * `organization.personal.provision` (`specs/193-admin-form-extensions/`
 * D-300.31, T103) — find-or-create an account's personal organisation, as
 * **one** Command every provisioning path runs:
 *
 * - inside the standalone registration and the federated sign-in, as a
 *   **child** of the caller's Command (`ctx.run`), on its transaction. The
 *   child answers `skipAudit`: the caller's entry already records the account
 *   and its organisation, so registration's audit is unchanged;
 * - on the repair (`ensureForCustomerAccountId`) and the detach-to-personal
 *   (`provisionPersonalOrganizationFor`), as a **root** Command under the
 *   caller's actor, recording one names-only entry.
 *
 * It is a rule-check-only writer of the organization field set (D-300.27):
 * not hookable, so no module hook runs on it, but the platform's field-rule
 * check holds it. Its hook data is module-local. Re-finding an existing
 * organisation writes nothing, so it says so (`created: false`) and the
 * projection holds no field.
 */

/** The hook data the field-rule check projects; module-local, never published. */
export interface PersonalOrganizationProvisionHookData {
  readonly organization: OrganizationRecord;
  /** `false` when the account's organisation already existed and nothing was written. */
  readonly created: boolean;
}

/** The rule-check-only ref the writer registers on (never declared hookable). */
export const ORGANIZATION_PERSONAL_PROVISION_RULE_CHECK = hookableAction<PersonalOrganizationProvisionHookData>(
  'organization.personal.provision',
  'organization',
  ['beforeCommit'],
);

export interface ProvisionPersonalOrganizationInput {
  readonly customerAccountId: string;
  readonly email: string;
  readonly firstName?: string | null;
  readonly lastName?: string | null;
  /** The store the account registers on; `null` or absent binds the system default. */
  readonly salesChannelId?: string | null;
}

/** What the write needs besides the input. */
export interface ProvisionPersonalOrganizationDeps {
  /** How a personal organisation is named from the person: `PersonalOrganizationService.personalName`. */
  readonly name: (person: { readonly firstName: string; readonly lastName: string; readonly email: string }) => string;
  /**
   * Feature 154 — the kernel's audited channel-membership writer: a created
   * organisation is bound to the registering store's channel, the system
   * default without one, on this Command's `em`.
   */
  readonly channelMembership?: Pick<SalesChannelMembershipPort, 'bindToDefaultIfEmpty' | 'replaceChannelsForEntity'>;
}

export function makeProvisionPersonalOrganizationCommand(
  deps: ProvisionPersonalOrganizationDeps,
  input: ProvisionPersonalOrganizationInput,
  options: {
    /** Run through a caller's `ctx.run`: the caller's entry records the write, and its lineage decides who is bound. */
    readonly child: boolean;
  },
): Command<Organization> {
  // Set by `run`, which the bus calls before the field-rule check.
  let created = true;
  return {
    action: ORGANIZATION_PERSONAL_PROVISION_RULE_CHECK.action,
    objectType: 'organization',
    // The account the organisation belongs to: the row's id does not exist yet.
    objectId: input.customerAccountId,
    hookData: (organization): PersonalOrganizationProvisionHookData => ({
      organization: toOrganizationRecord(organization),
      created,
    }),
    run: async ({ em }) => {
      // Idempotent by the account link (`personalAccountId`, `specs/177-tax-id-scope/`
      // FR-003): a retry after a rolled-back attempt re-finds the row, and the
      // partial unique index refuses a concurrent second insert.
      const existing = await em.findOne(Organization, { personalAccountId: input.customerAccountId });
      if (existing) {
        await deps.channelMembership?.bindToDefaultIfEmpty('organization', existing.id, { em });
        created = false;
        return { result: existing, skipAudit: true };
      }
      const organization = em.create(Organization, {
        name: deps.name({ firstName: input.firstName ?? '', lastName: input.lastName ?? '', email: input.email }),
        taxId: null,
        personalAccountId: input.customerAccountId,
        status: 'active',
        vatStatus: 'vat_exempt',
        isPersonal: true,
        registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
      });
      // Flushed here rather than left pending: the caller's next statement
      // inserts a row whose `organization_id` points at this one, on this
      // transaction, so a rollback takes this row with it.
      await em.persist(organization).flush();
      // Feature 154 — on this `em`, so the bridge row shares the transaction.
      if (input.salesChannelId) {
        await deps.channelMembership?.replaceChannelsForEntity('organization', organization.id, [input.salesChannelId], { em });
      } else {
        await deps.channelMembership?.bindToDefaultIfEmpty('organization', organization.id, { em });
      }
      created = true;
      if (options.child) return { result: organization, skipAudit: true };
      return {
        result: organization,
        before: null,
        // Names, codes and ids only (`specs/conventions/audit-state.md`): the
        // name is the person's.
        after: {
          status: organization.status,
          vatStatus: organization.vatStatus,
          isPersonal: true,
          customerAccountId: input.customerAccountId,
          changedFields: presentFields(organization, ORGANIZATION_CREATED_FIELDS),
        },
      };
    },
  };
}
