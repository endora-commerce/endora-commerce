// The organization field set and its admin forms — `specs/193-admin-form-extensions/`
// WP-E1 (FR-001, FR-080; `contracts/form-field-declaration.md` §4).
//
// The first adopter. The keys are the admin write contract's, field by field:
// `AdminOrganizationCreateBodySchema` and `adminPatchOrganizationRequestSchema`,
// which `organizations`' tests hold this declaration to
// (`expectFieldSetMatchesSchemas`). Custom-field values are not here: they are
// operator-defined fields, a mechanism of their own (D0).
//
// Field-set and form ids are frozen identities; keys and section keys are
// stable; `accepts` may widen (contract-surface rows, §5).

import { PRESENTATION_OVERRIDES, defineAdminForm, defineFieldSet } from './admin-forms.js';
import { fulfilmentStrategySchema } from './inventory.js';
import { vatStatusSchema } from './organizations.js';

/**
 * The presentation kinds of the identity fields. A server-enforced kind
 * (`validation`, `requiredWhen`, `writePermission`) is invited only on a field
 * **every** writer of it projects (`contracts/field-rules.md` §2, I-5;
 * D-300.26):
 *
 * - `name` adds `validation`: every writer of it — the create, the
 *   registration, the admin PATCH, the conversion and the integration port —
 *   projects it;
 * - `taxId` stays presentation only, because `organization.tax_id.change`
 *   carries no tax ID (R-9);
 * - `registeredAddress` is a composite, which admits no tightening;
 * - `parentId` is also written by the hierarchy moves (`organization.set_parent`,
 *   `organization.move`), and `status` by moderation, neither of which is a
 *   declared hookable action.
 */
const IDENTITY_ACCEPTS = ['label', 'help', 'placeholder', 'position', 'behaviour'] as const;

/** The organization field set (owner: `organizations`). */
export const ORGANIZATION_FIELD_SET = defineFieldSet({
  id: 'organization',
  ownerModuleId: 'organizations',
  fields: [
    {
      key: 'name',
      type: 'string',
      required: true,
      bounds: { minLength: 1, maxLength: 255 },
      accepts: [...IDENTITY_ACCEPTS, 'validation'],
    },
    // The tax ID is normalised before its 8 – 32 bound is applied, so the body
    // schema bounds the normalised value and not the input; no core bound is
    // declared on the input here. A tightening is not invited either.
    { key: 'taxId', type: 'string', required: true, accepts: IDENTITY_ACCEPTS },
    {
      key: 'parentId',
      type: 'reference',
      references: 'organization',
      required: false,
      // No `default`: naming a parent is an unscoped administrator's alone
      // (D-260), so a default parent would refuse every scoped operator's create.
      accepts: ['label', 'help', 'placeholder', 'position', 'hidden', 'readOnly', 'visibleWhen', 'behaviour'],
    },
    { key: 'registeredAddress', type: 'composite', required: true, accepts: ['label', 'help', 'position'] },
    {
      key: 'status',
      type: 'enum',
      options: ['active', 'pending_verification'],
      required: false,
      accepts: ['label', 'help', 'position', 'default', 'hidden', 'readOnly'],
    },
    {
      key: 'salesChannelIds',
      type: 'reference[]',
      references: 'sales_channel',
      required: true,
      accepts: ['label', 'help', 'position'],
    },
    // Written by the create, the registration, the admin PATCH (the "Change VAT
    // status…" dialog), the conversion and the integration port — all of which
    // project it. Shown on no form.
    {
      key: 'vatStatus',
      type: 'enum',
      options: vatStatusSchema.options,
      required: false,
      accepts: ['label', 'help', 'position', 'validation', 'writePermission'],
    },
    {
      key: 'orderConfirmationEmails',
      type: 'string[]',
      required: false,
      accepts: [...PRESENTATION_OVERRIDES, 'validation', 'requiredWhen', 'writePermission'],
    },
    {
      key: 'fulfilmentStrategy',
      type: 'enum',
      options: fulfilmentStrategySchema.options,
      required: false,
      accepts: ['label', 'help', 'position', 'hidden', 'readOnly', 'validation', 'writePermission'],
    },
    // The warehouse walk of the `defined_order` strategy, edited inside the
    // strategy's own control; not a field of any form on its own.
    { key: 'fulfilmentStrategyWarehouseOrder', type: 'reference[]', references: 'warehouse', required: false, accepts: [] },
  ],
});

/**
 * The two admin forms `organizations` renders: *New organization* and the
 * fields the Organization page's one Save writes.
 */
export const ORGANIZATION_FORMS = {
  create: defineAdminForm({
    id: 'organization.create',
    fieldSet: 'organization',
    mode: 'create',
    sections: [
      { key: 'identity', keys: ['name', 'taxId'] },
      { key: 'parent', keys: ['parentId'] },
      { key: 'address', keys: ['registeredAddress'] },
      { key: 'access', keys: ['status', 'salesChannelIds'] },
    ],
  }),
  edit: defineAdminForm({
    id: 'organization.edit',
    fieldSet: 'organization',
    mode: 'edit',
    sections: [
      { key: 'notifications', keys: ['orderConfirmationEmails'] },
      { key: 'fulfilment', keys: ['fulfilmentStrategy'] },
    ],
  }),
} as const;
