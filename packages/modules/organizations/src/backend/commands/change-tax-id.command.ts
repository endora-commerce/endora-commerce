import { randomUUID } from 'node:crypto';
import {
  ERROR_CODES,
  normalizeTaxId,
  type OrganizationChangeTaxIdInput,
  type OrganizationTaxIdChangedEvent,
  type OrganizationTaxIdChangeHookData,
  type OrganizationTaxIdChangeOutbox,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import { HttpError } from '@endora-commerce/platform/http';
import { Organization } from '../entities/organization.entity.js';
import { taxIdConflictOf } from '../services/tax-id-conflict.js';
import { TaxIdScopeService } from '../services/tax-id-scope-service.js';
import { taxIdExistsRefusal } from '../services/organization-write.js';
import { taxIdAvailableFor } from './create-organization.command.js';

/** The event name, as `OrganizationEvents` declares it. */
export const ORGANIZATION_TAX_ID_CHANGED = 'organization.tax_id_changed.v1';

export type TaxIdChangeRefusal = 'not_company' | 'deleted';

const REFUSAL_MESSAGES: Readonly<Record<TaxIdChangeRefusal, string>> = {
  not_company: 'A personal organization has no tax ID to change. Convert it to a company instead.',
  deleted: "A deleted organization's tax ID cannot be changed.",
};

export function taxIdChangeRefusal(code: TaxIdChangeRefusal): HttpError {
  return new HttpError(409, ERROR_CODES.ORGANIZATION_TAX_ID_CHANGE_REFUSED, REFUSAL_MESSAGES[code], { code });
}

export interface ChangeTaxIdResult {
  readonly organization: Organization;
  /** `false` for the same value after normalisation: nothing written, audited or emitted. */
  readonly changed: boolean;
}

/**
 * `organization.tax_id.change` (issue #1040, follow-up to
 * `specs/177-tax-id-scope/`): an operator corrects a live company
 * organization's tax ID **in place** — its id, members, roles and orders stay.
 *
 * One transaction, the bus's, in the order every tax-ID writer keeps:
 *
 * 1. the row is locked (`for update`), so two corrections of one organization
 *    serialise and the second sees the first's value;
 * 2. a personal organization is refused `not_company` (it has no tax ID: the
 *    way to give it one is the conversion), a soft-deleted one `deleted`;
 * 3. the value is normalised (`normalizeTaxId`; the entity hook stores the
 *    same form) — equal to the stored one, nothing changes: no write, no
 *    audit entry, no event;
 * 4. the scope is read inside this transaction (FR-026) and the value checked
 *    against it, for this organization's tree, exactly as creation checks it
 *    (FR-019) — in `global` soft-deleted holders count too (D-290 / OD-8);
 * 5. the write: `taxId`, and the VAT validation summary back to never-validated
 *    (`vatValidatedAt`, `vatValidationProvider`, `vatValidationOutcome` null) —
 *    a validation of the old value says nothing about the new one. The
 *    `vatStatus` classification (payer, exempt, reverse charge) is the
 *    company's and is kept. The update of `tax_id` fires M3's
 *    `organizations_tax_id_write_lock` trigger, so this writer takes the tax-ID
 *    advisory lock before the reach governor's, like every other.
 *
 * The flush's `23505` / `23P01` is mapped here; the deferred `23P01` at commit
 * by `runOrganizationWrite` around the bus (FR-021) — every call site uses it
 * (`tax-id-write-paths.test.ts`).
 *
 * The audit carries names only (`audit-state.md`, ruling O-2): which field
 * changed, that the VAT validation was reset, the scope — never the old or new
 * tax ID. Historic documents are not rewritten: an order's billing tax ID, an
 * invoice and a quote document keep what they were issued with (FR-007).
 * No VAT validation runs here; a network call does not belong inside the
 * transaction (D-290 / OD-2).
 *
 * Hookable (issue #1057, `ORGANIZATION_HOOKABLE_ACTIONS.changeTaxId`): a hook
 * is handed the id and `changedFields` — never the old or the new tax ID. The
 * same-value no-op runs the hooks too, with `changedFields: []`; it records no
 * entry unless a hook noted a write, and then the bus records one naming only
 * the hook's fields (`contracts/command-hooks-api.md` §4.5).
 */
export function makeChangeTaxIdCommand(params: {
  organizationId: string;
  input: OrganizationChangeTaxIdInput;
  /** Extension input for the hook modules on this action, keyed by module id (176 FR-018). */
  extensions?: Readonly<Record<string, unknown>>;
}): Command<ChangeTaxIdResult> {
  const { organizationId, input } = params;
  let changedAt: Date | null = null;
  const changedFieldsOf = (changed: boolean): string[] => (changed ? ['taxId'] : []);
  return {
    action: 'organization.tax_id.change',
    objectType: 'organization',
    objectId: organizationId,
    ...(params.extensions ? { extensions: params.extensions } : {}),
    hookData: ({ organization, changed }): OrganizationTaxIdChangeHookData => ({
      organizationId: organization.id,
      changedFields: changedFieldsOf(changed),
      vatValidationReset: changed,
    }),
    outboxData: ({ organization, changed }): OrganizationTaxIdChangeOutbox => ({
      organizationId: organization.id,
      changedFields: changedFieldsOf(changed),
    }),
    run: async ({ em }) => {
      const locked = (await em.execute('select "id" from "organizations" where "id" = ? for update', [
        organizationId,
      ])) as unknown[];
      const org = locked.length > 0 ? await em.findOne(Organization, { id: organizationId }) : null;
      if (!org) throw new HttpError(404, ERROR_CODES.NOT_FOUND, 'Organization not found.');
      if (org.isPersonal) throw taxIdChangeRefusal('not_company');
      if (org.deletedAt) throw taxIdChangeRefusal('deleted');

      const taxId = normalizeTaxId(input.taxId);
      if (taxId === org.taxId) {
        return { result: { organization: org, changed: false }, skipAudit: true };
      }

      const rootId = org.path.split('/').filter(Boolean)[0] ?? org.id;
      if (!(await taxIdAvailableFor(em, taxId, rootId))) throw taxIdExistsRefusal();

      org.taxId = taxId;
      org.vatValidatedAt = null;
      org.vatValidationProvider = null;
      org.vatValidationOutcome = null;
      try {
        await em.flush();
      } catch (err) {
        if (taxIdConflictOf(err) !== null) throw taxIdExistsRefusal();
        throw err;
      }
      changedAt = new Date();

      return {
        result: { organization: org, changed: true },
        before: null,
        after: {
          changedFields: ['taxId'],
          vatStatusReset: true,
          taxIdScope: await new TaxIdScopeService(() => em).scope(em),
        },
      };
    },
    event: ({ organization, changed }) => {
      if (!changed) return undefined;
      const payload: OrganizationTaxIdChangedEvent = {
        eventId: randomUUID(),
        occurredAt: new Date().toISOString(),
        organizationId: organization.id,
        changedAt: (changedAt ?? new Date()).toISOString(),
      };
      return { eventName: ORGANIZATION_TAX_ID_CHANGED, payload };
    },
  };
}
