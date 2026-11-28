import {
  ORGANIZATION_FIELD_SET,
  ORGANIZATION_HOOKABLE_ACTIONS,
  hookableAction,
  type FieldKeyOf,
  type OrganizationConvertToCompanyHookData,
  type OrganizationCreateHookData,
  type OrganizationMergeStartHookData,
  type OrganizationRecord,
  type OrganizationRegisterHookData,
  type OrganizationUpdateHookData,
} from '@endora-commerce/contracts';
import type { FieldSetRegistration } from '@endora-commerce/platform/kernel';
import { MERGE_FIELD_SET_WRITES } from '../merge/organization-merge-rules.js';
import {
  ORGANIZATION_PERSONAL_PROVISION_RULE_CHECK,
  type PersonalOrganizationProvisionHookData,
} from '../commands/provision-personal-organization.command.js';

/**
 * The writers of the organization field set (`specs/193-admin-form-extensions/`
 * WP-E1, FR-041, FR-081; `contracts/field-rules.md` §2) — every Command that
 * changes a field of `ORGANIZATION_FIELD_SET`, with a pure projection from its
 * hook data to the field values. The platform's field-rule check runs first in
 * each writer's `beforeCommit` phase over that projection, so a deployment's
 * tightened rule binds the admin form, the admin API, the integration port and
 * a worker alike.
 *
 * `writes` lists only what the projection returns (I-5). The conversion
 * (`organization.convert_to_company`) projects the name, the address and the VAT
 * status from its hook data's after-state (D-300.26), but not the tax ID, which
 * `organization.tax_id.change` cannot project either: `taxId` invites
 * presentation kinds only.
 *
 * What is deliberately **not** a writer, and why:
 *
 * - `organization.tax_id.change` — its hook data never carries the tax ID;
 *   `taxId` invites presentation kinds only.
 * - the hierarchy moves and moderation — `parentId` and `status` invite
 *   presentation kinds only.
 * - anonymisation — an erasure (D-300.32). It runs outside the Command Bus and
 *   is held to no rule, so it can never be refused; a scrubbed row that breaks
 *   a rule added later is a stored value, tolerated as any is (D-300.4). That
 *   rests on a standing Principle XIII deviation — the scrub writes and audits
 *   outside the bus — tracked in #2039.
 *
 * The merge and personal-organisation provisioning **are** writers: the merge
 * at start (the outcome it fixes) and at finalize (the backstop), and every
 * provisioning path through `organization.personal.provision` (D-300.28,
 * D-300.31).
 */

/** The keys of the organization field set. */
type OrganizationFieldKey = FieldKeyOf<typeof ORGANIZATION_FIELD_SET>;

/**
 * `organization.update` — `organizationCommandPort.update`, the integration
 * write (issue #1029). It is not a declared hookable action, so no module may
 * hook it and no slot rides on it; it is a **rule-check-only** writer (FR-113),
 * whose Command supplies hook data for the field-rule check alone. Module-local:
 * a hook registered on it is refused at composition.
 */
export const ORGANIZATION_UPDATE_RULE_CHECK = hookableAction<OrganizationUpdateHookData>(
  'organization.update',
  'organization',
  ['beforeCommit'],
);

/** The field values an Organization record holds. */
function recordValues(organization: OrganizationRecord): Record<OrganizationFieldKey, unknown> & Record<string, unknown> {
  return {
    name: organization.name,
    taxId: organization.taxId,
    parentId: organization.parentId,
    registeredAddress: organization.registeredAddress,
    status: organization.status,
    // Not a column: the create's hook data carries it beside the record.
    salesChannelIds: undefined,
    vatStatus: organization.vatStatus,
    orderConfirmationEmails: organization.orderConfirmationEmails,
    fulfilmentStrategy: organization.fulfilmentStrategy,
    fulfilmentStrategyWarehouseOrder: organization.fulfilmentStrategyWarehouseOrder,
  };
}

/** Only the keys `writes` names: a writer projects nothing it does not list. */
function pick(values: Readonly<Record<string, unknown>>, writes: readonly string[]): Record<string, unknown> {
  return Object.fromEntries(writes.map((key) => [key, values[key]]));
}

/** The names of what changed that this writer writes (`changedFields` may name columns outside the set). */
function changedOf(changedFields: readonly string[], writes: readonly string[]): string[] {
  return changedFields.filter((field) => writes.includes(field));
}

const CREATE_WRITES = [
  'name',
  'taxId',
  'parentId',
  'registeredAddress',
  'status',
  'salesChannelIds',
  'vatStatus',
] as const satisfies readonly OrganizationFieldKey[];
const REGISTER_WRITES = ['name', 'taxId', 'registeredAddress', 'status', 'vatStatus'] as const satisfies readonly OrganizationFieldKey[];
const ADMIN_PATCH_WRITES = [
  'name',
  'vatStatus',
  'orderConfirmationEmails',
  'fulfilmentStrategy',
  'fulfilmentStrategyWarehouseOrder',
] as const satisfies readonly OrganizationFieldKey[];
const CONVERT_WRITES = ['name', 'registeredAddress', 'vatStatus'] as const satisfies readonly OrganizationFieldKey[];
const UPDATE_WRITES = ['name', 'vatStatus', 'registeredAddress', 'orderConfirmationEmails'] as const satisfies readonly OrganizationFieldKey[];
/**
 * What a personal organisation is provisioned with (D-300.31). Narrow on
 * purpose: a field provisioning leaves empty (`orderConfirmationEmails`,
 * `fulfilmentStrategy`) is never held, so a tightened `required` there cannot
 * refuse it.
 */
const PROVISION_WRITES = ['name', 'status', 'vatStatus', 'registeredAddress', 'taxId'] as const satisfies readonly OrganizationFieldKey[];

/**
 * `organization.merge.finalize` (D-300.28) — not hookable; a rule-check-only
 * writer, the backstop for a rule deployed while a merge is in flight. It runs
 * in the merge runner's system scope, so it is held to validation alone; the
 * operator's `writePermission` was decided once, at start. Module-local.
 */
export const ORGANIZATION_MERGE_FINALIZE_RULE_CHECK = hookableAction<OrganizationUpdateHookData>(
  'organization.merge.finalize',
  'organization',
  ['beforeCommit'],
);

/** The merge's writes on the survivor: the offered fields the field set holds, and the e-mail union. */
const MERGE_WRITES = MERGE_FIELD_SET_WRITES satisfies readonly OrganizationFieldKey[];

/** What `registerModule` hands `ctx.fieldSets`. */
export const organizationFieldSetRegistration: FieldSetRegistration = {
  set: ORGANIZATION_FIELD_SET,
  writers: [
    {
      on: ORGANIZATION_HOOKABLE_ACTIONS.create,
      mode: 'create',
      writes: CREATE_WRITES,
      project: (data) => {
        const { organization, salesChannelIds } = data as OrganizationCreateHookData;
        return { before: null, after: pick({ ...recordValues(organization), salesChannelIds }, CREATE_WRITES) };
      },
    },
    {
      // The storefront self-registration. A writer like the others; the
      // field-rule check skips it because the Command declares
      // `buyerSelfService` (D-300.3, D-300.10).
      on: ORGANIZATION_HOOKABLE_ACTIONS.register,
      mode: 'create',
      writes: REGISTER_WRITES,
      project: (data) => ({ before: null, after: pick(recordValues((data as OrganizationRegisterHookData).organization), REGISTER_WRITES) }),
    },
    {
      on: ORGANIZATION_HOOKABLE_ACTIONS.adminPatch,
      mode: 'update',
      writes: ADMIN_PATCH_WRITES,
      project: (data) => {
        const { organization, changedFields } = data as OrganizationUpdateHookData;
        return { after: pick(recordValues(organization), ADMIN_PATCH_WRITES), changed: changedOf(changedFields, ADMIN_PATCH_WRITES) };
      },
    },
    {
      // Writes the custom-field bag only, which is not a field of the set: no
      // field is held here, and a slot module may still ride on the action.
      on: ORGANIZATION_HOOKABLE_ACTIONS.setCustomFieldValues,
      mode: 'update',
      writes: [],
      project: () => ({ after: {}, changed: [] }),
    },
    {
      on: ORGANIZATION_HOOKABLE_ACTIONS.convertToCompany,
      mode: 'update',
      writes: CONVERT_WRITES,
      project: (data) => {
        const { organization, changedFields } = data as OrganizationConvertToCompanyHookData;
        return { after: pick(recordValues(organization), CONVERT_WRITES), changed: changedOf(changedFields, CONVERT_WRITES) };
      },
    },
    {
      // D-300.28 — the outcome the start fixes on the survivor: a chosen value
      // that breaks a tightened rule is refused before anything moves, and a
      // changed field whose `writePermission` the admin lacks is forbidden. The
      // e-mail union is held like any changed field.
      on: ORGANIZATION_HOOKABLE_ACTIONS.mergeStart,
      mode: 'update',
      writes: MERGE_WRITES,
      project: (data) => {
        const { survivor } = data as OrganizationMergeStartHookData;
        return { after: pick(survivor.after, MERGE_WRITES), changed: changedOf(survivor.changed, MERGE_WRITES) };
      },
    },
    {
      on: ORGANIZATION_MERGE_FINALIZE_RULE_CHECK,
      ruleCheckOnly: true,
      mode: 'update',
      writes: MERGE_WRITES,
      project: (data) => {
        const { organization, changedFields } = data as OrganizationUpdateHookData;
        return { after: pick(recordValues(organization), MERGE_WRITES), changed: changedOf(changedFields, MERGE_WRITES) };
      },
    },
    {
      // D-300.31 — every provisioning path. On a create every written key is
      // held to validation; `changed` feeds `writePermission` alone, and names
      // only the derived `name`: an operator's detach is never refused for the
      // fixed `vat_exempt` it did not choose. A re-found organisation wrote
      // nothing and holds nothing.
      on: ORGANIZATION_PERSONAL_PROVISION_RULE_CHECK,
      ruleCheckOnly: true,
      mode: 'create',
      writes: PROVISION_WRITES,
      project: (data) => {
        const { organization, created } = data as PersonalOrganizationProvisionHookData;
        if (!created) return { after: {}, changed: [] };
        return { after: pick(recordValues(organization), PROVISION_WRITES), changed: ['name'] };
      },
    },
    {
      on: ORGANIZATION_UPDATE_RULE_CHECK,
      ruleCheckOnly: true,
      mode: 'update',
      writes: UPDATE_WRITES,
      project: (data) => {
        const { organization, changedFields } = data as OrganizationUpdateHookData;
        return { after: pick(recordValues(organization), UPDATE_WRITES), changed: changedOf(changedFields, UPDATE_WRITES) };
      },
    },
  ],
};
