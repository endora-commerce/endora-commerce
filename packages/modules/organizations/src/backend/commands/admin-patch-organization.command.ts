import type { z } from 'zod';
import type {
  adminPatchOrganizationRequestSchema,
  OrganizationUpdateHookData,
  OrganizationUpdateOutbox,
} from '@endora-commerce/contracts';
import type { Command } from '@endora-commerce/platform/commands';
import type { Organization } from '../entities/organization.entity.js';
import { organizationPatchAuditState, organizationPatchBaseline } from '../services/organization-audit-state.js';
import { toOrganizationRecord } from '../services/organization-details-port.js';
import {
  applyCustomFieldMerge,
  loadLiveOrganization,
  type OrganizationCustomFieldMerge,
} from './set-custom-field-values.command.js';

/** The plain columns the admin PATCH may set; the bag and the version token travel separately. */
export type AdminOrganizationPatch = Omit<
  z.infer<typeof adminPatchOrganizationRequestSchema>,
  'customFieldValues' | 'expectedUpdatedAt'
>;

/**
 * `organization.admin_patch` — the operator's edit of an Organization
 * (`PATCH /api/v1/admin/organizations/:id`) as **one** Command (Principle XIII).
 *
 * It used to mutate the entity on the request's `em`, flush, and record the
 * audit row afterwards, outside the write. Now the version check, the column
 * changes and the custom-field merge run on the bus's one transaction, and the
 * entry commits with them or not at all.
 *
 * **The entry names, it does not quote** (`specs/conventions/audit-state.md`,
 * D-288, issue #470 ruling O-2): the status, VAT and fulfilment-strategy codes
 * before and after, and the sorted names of the columns (`changedFields`) and
 * custom fields (`changedCustomFields`) whose value differs — never the name,
 * the order e-mails or a custom-field value ({@link organizationPatchAuditState}).
 *
 * **The custom-field step is the port's.** It runs through
 * {@link applyCustomFieldMerge}, the step `organization.set_custom_field_values`
 * (`organizationCustomFieldWritePort`) runs, rather than as a child Command:
 * a child records its own entry, and a PATCH that changes a name and a value
 * would then leave two entries where an operator has always seen one.
 *
 * `assertCurrent` is the route's optimistic check on `expectedUpdatedAt`,
 * asked here so it reads the row the transaction writes. `mergeCustomFieldValues`
 * is absent when the request carries no values (or `custom_fields` is not
 * wired); when present it validates inside, and its refusal rolls back the
 * whole PATCH — the other columns included.
 */
export function makeAdminPatchOrganizationCommand(input: {
  organizationId: string;
  changes: AdminOrganizationPatch;
  assertCurrent: (org: Organization) => void;
  mergeCustomFieldValues?: OrganizationCustomFieldMerge | undefined;
  /** Extension input for the hook modules on this action, keyed by module id (176 FR-018). */
  extensions?: Readonly<Record<string, unknown>> | undefined;
}): Command<Organization> {
  // The names the audit state computes, kept for the hook data: a hook is
  // handed what changed exactly as the entry will name it.
  let changed: { changedFields: string[]; changedCustomFields: string[] } = { changedFields: [], changedCustomFields: [] };
  return {
    action: 'organization.admin_patch',
    objectType: 'organization',
    objectId: input.organizationId,
    // Hookable (176 FR-024, `ORGANIZATION_HOOKABLE_ACTIONS.adminPatch`).
    ...(input.extensions ? { extensions: input.extensions } : {}),
    hookData: (org): OrganizationUpdateHookData => ({ organization: toOrganizationRecord(org), ...changed }),
    outboxData: (org): OrganizationUpdateOutbox => ({ organizationId: org.id, ...changed }),
    run: async ({ em }) => {
      const org = await loadLiveOrganization(em, input.organizationId);
      input.assertCurrent(org);
      const baseline = organizationPatchBaseline(org);
      const { changes } = input;
      if (changes.name !== undefined) org.name = changes.name;
      if (changes.vatStatus !== undefined) org.vatStatus = changes.vatStatus;
      if (changes.status !== undefined) org.status = changes.status;
      if (changes.orderConfirmationEmails !== undefined) org.orderConfirmationEmails = changes.orderConfirmationEmails;
      if (changes.fulfilmentStrategy !== undefined) org.fulfilmentStrategy = changes.fulfilmentStrategy;
      if (changes.fulfilmentStrategyWarehouseOrder !== undefined) {
        org.fulfilmentStrategyWarehouseOrder = changes.fulfilmentStrategyWarehouseOrder;
      }
      if (input.mergeCustomFieldValues) await applyCustomFieldMerge(org, input.mergeCustomFieldValues);
      await em.flush();
      const state = organizationPatchAuditState(baseline, org);
      changed = {
        changedFields: state.after['changedFields'] as string[],
        changedCustomFields: state.after['changedCustomFields'] as string[],
      };
      return { result: org, ...state };
    },
  };
}
