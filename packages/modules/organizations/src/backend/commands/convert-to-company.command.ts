import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  normalizeTaxId,
  type CustomerAccountReadPort,
  type OrganizationConvertedToCompanyEvent,
  type OrganizationConvertToCompanyHookData,
  type OrganizationConvertToCompanyInput,
  type OrganizationConvertToCompanyOutbox,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { Organization } from '../entities/organization.entity.js';
import { predefinedRoleIdOn } from '../services/organization-role-store.js';
import { taxIdConflictOf } from '../services/tax-id-conflict.js';
import { TaxIdScopeService } from '../services/tax-id-scope-service.js';
import { taxIdExistsRefusal } from '../services/organization-write.js';
import { taxIdAvailableFor } from './create-organization.command.js';

/** The event name, as `OrganizationEvents` declares it. */
export const ORGANIZATION_CONVERTED_TO_COMPANY = 'organization.converted_to_company.v1';

export type ConversionRefusal = 'not_personal' | 'deleted' | 'owner_not_administrator';

const REFUSAL_MESSAGES: Readonly<Record<ConversionRefusal, string>> = {
  not_personal: 'This organization is already a company.',
  deleted: 'A deleted organization cannot be converted.',
  owner_not_administrator:
    "The organization's member is not its Administrator, so it cannot be converted.",
};

export function conversionRefusal(code: ConversionRefusal): HttpError {
  return new HttpError(409, ERROR_CODES.ORGANIZATION_CONVERSION_REFUSED, REFUSAL_MESSAGES[code], { code });
}

export interface ConvertToCompanyCommandDeps {
  accounts: Pick<CustomerAccountReadPort, 'listByOrganization'>;
}

/** The fields a conversion may change, in the order `changedFields` lists them (sorted). */
const CONVERTED_FIELDS = ['isPersonal', 'legalName', 'name', 'registeredAddress', 'taxId', 'vatStatus'] as const;

/**
 * `organization.convert_to_company` (`specs/177-tax-id-scope/` FR-030 …
 * FR-039; `contracts/convert-to-company.md` §1, research R-11).
 *
 * A personal organization becomes a company **in place**, in one transaction:
 * its id, orders, carts, addresses and channel bindings stay; it gets the
 * company data, loses the account link, and records when it converted. Its
 * status is kept and, if it was never approved, the operator's approval is
 * stamped — moderation governs self-registration, not an operator's write
 * (D-290 / OD-7).
 *
 * Its member already holds the *Administrator* role (feature 170, FR-070a);
 * that is asserted, not written — the account's role column is
 * `customer_accounts'`. Both predefined roles are ensured with the creating
 * trigger's own statement, as a guard.
 *
 * The tax ID is checked against the scope read inside this transaction, for
 * this organization's tree; the database refusal at the flush is mapped here
 * and the deferred one at commit by `runOrganizationWrite` around the bus.
 *
 * The audit carries names only (`audit-state.md`): the fields that changed,
 * whether the approval was stamped, the scope. No VAT validation runs here —
 * a network call does not belong inside the transaction (D-290 / OD-2).
 *
 * Hookable (issue #1057, `ORGANIZATION_HOOKABLE_ACTIONS.convertToCompany`): a
 * hook is handed the id, the kept status, the VAT classification, the names of
 * the converted fields and whether the approval was stamped — never the tax ID,
 * the name or the address.
 */
export function makeConvertToCompanyCommand(
  deps: ConvertToCompanyCommandDeps,
  params: {
    organizationId: string;
    input: OrganizationConvertToCompanyInput;
    /** Extension input for the hook modules on this action, keyed by module id (176 FR-018). */
    extensions?: Readonly<Record<string, unknown>>;
  },
): Command<Organization> {
  const { organizationId, input } = params;
  // What `run` changed, for the hook and outbox data — set before the hooks run.
  let changedFields: string[] = [];
  let approvalStamped = false;
  return {
    action: 'organization.convert_to_company',
    objectType: 'organization',
    objectId: organizationId,
    ...(params.extensions ? { extensions: params.extensions } : {}),
    hookData: (org): OrganizationConvertToCompanyHookData => ({
      organizationId: org.id,
      status: org.status,
      vatStatus: org.vatStatus,
      changedFields,
      approvalStamped,
    }),
    outboxData: (org): OrganizationConvertToCompanyOutbox => ({
      organizationId: org.id,
      status: org.status,
      changedFields,
    }),
    run: async ({ em, actor }) => {
      const locked = (await em.execute('select "id" from "organizations" where "id" = ? for update', [
        organizationId,
      ])) as unknown[];
      const org = locked.length > 0 ? await em.findOne(Organization, { id: organizationId }) : null;
      if (!org) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      if (!org.isPersonal) throw conversionRefusal('not_personal');
      if (org.deletedAt) throw conversionRefusal('deleted');

      const taxId = normalizeTaxId(input.taxId);
      const rootId = org.path.split('/').filter(Boolean)[0] ?? org.id;
      if (!(await taxIdAvailableFor(em, taxId, rootId))) throw taxIdExistsRefusal();

      await em.execute(
        `insert into "organization_roles"
           ("id", "organization_id", "kind", "permissions", "member_defaults_offered", "version", "created_at", "updated_at")
         values (gen_random_uuid(), ?, 'administrator', '{}', '{}', 1, now(), now()),
                (gen_random_uuid(), ?, 'member', '{}', '{}', 1, now(), now())
         on conflict do nothing`,
        [org.id, org.id],
      );
      const administratorRoleId = await predefinedRoleIdOn(em, org.id, 'administrator');
      const members = await deps.accounts.listByOrganization(org.id, { activeOnly: true });
      if (members.some((member) => member.organizationRoleId !== administratorRoleId)) {
        throw conversionRefusal('owner_not_administrator');
      }

      const before = {
        isPersonal: org.isPersonal,
        legalName: org.legalName ?? null,
        name: org.name,
        registeredAddress: JSON.stringify(org.registeredAddress),
        taxId: org.taxId ?? null,
        vatStatus: org.vatStatus,
      };
      const now = new Date();
      approvalStamped = !org.approvedAt;
      org.isPersonal = false;
      org.taxId = taxId;
      org.name = input.name;
      org.legalName = input.legalName ?? null;
      org.registeredAddress = {
        street: input.registeredAddress.street,
        city: input.registeredAddress.city,
        postalCode: input.registeredAddress.postalCode,
        country: input.registeredAddress.country,
      };
      org.vatStatus = input.vatStatus;
      org.personalAccountId = null;
      org.convertedToCompanyAt = now;
      if (approvalStamped) {
        org.approvedAt = now;
        org.approvedByAdminUserId = actor.actorAdminUserId;
      }
      try {
        await em.flush();
      } catch (err) {
        if (taxIdConflictOf(err) !== null) throw taxIdExistsRefusal();
        throw err;
      }

      const after: Record<(typeof CONVERTED_FIELDS)[number], unknown> = {
        isPersonal: org.isPersonal,
        legalName: org.legalName ?? null,
        name: org.name,
        registeredAddress: JSON.stringify(org.registeredAddress),
        taxId: org.taxId,
        vatStatus: org.vatStatus,
      };
      changedFields = CONVERTED_FIELDS.filter((field) => before[field] !== after[field]);
      return {
        result: org,
        before: { isPersonal: true },
        after: {
          isPersonal: false,
          changedFields: [...changedFields],
          approvalStamped,
          taxIdScope: await new TaxIdScopeService(() => em).scope(em),
        },
      };
    },
    event: (org) => {
      const payload: OrganizationConvertedToCompanyEvent = {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        organizationId: org.id,
        convertedAt: (org.convertedToCompanyAt ?? new Date()).toISOString(),
      };
      return { eventName: ORGANIZATION_CONVERTED_TO_COMPANY, payload };
    },
  };
}
