import { describe, expect, expectTypeOf, it } from 'vitest';
import {
  AdminFieldBehaviourSchema,
  AdminFieldContributionSchema,
  AdminFormDeclarationSchema,
  EffectiveFieldSchema,
  EffectiveFormsResponseSchema,
  EffectiveTextSchema,
  FIELD_FORMATS,
  FIELD_OVERRIDE_KINDS,
  FIELD_RULE_CODES,
  FIELD_VALUE_TYPES,
  FORM_LAYOUT_CHANGED_CHANNEL,
  FieldOverrideSchema,
  FieldSetDeclarationSchema,
  FieldValidationTighteningSchema,
  InputControlDeclarationSchema,
  OPERATOR_KINDS,
  PLATFORM_INPUT_CONTROLS,
  PRESENTATION_OVERRIDES,
  SERVER_ENFORCED_OVERRIDES,
  defineAdminForm,
  fieldOverrideKinds,
  defineFieldSet,
  type AdminFieldBehaviour,
  type AdminFieldContribution,
  type AdminInputControlContribution,
  type FieldKeyOf,
  type FieldOverrideKind,
  type FieldValueType,
  type FormLayoutOverrideRow,
  type FormLayoutOverrideSource,
  type SectionKeyOf,
} from './admin-forms.js';
import type { AdminContributions } from './admin-contributions.js';
import { MODULE_ORIGINS } from './modules.js';

/**
 * `specs/193-admin-form-extensions/` T011 and T013 — the declaration types and
 * their Zod twins (`contracts/form-field-declaration.md` §1 – §3), the override,
 * tightening and control vocabularies (`field-overrides.md` §1, `field-rules.md`
 * §1, `input-controls.md` §1), the slot contribution (`field-slots.md` §1) and
 * the effective-forms response (`field-overrides.md` §2).
 */

const SET = defineFieldSet({
  id: 'widget',
  ownerModuleId: 'widgets',
  fields: [
    { key: 'name', type: 'string', required: true, bounds: { maxLength: 255 }, accepts: ['label', 'validation'] },
    { key: 'kind', type: 'enum', options: ['a', 'b'], required: false, accepts: [...PRESENTATION_OVERRIDES] },
    { key: 'address', type: 'composite', required: false, accepts: ['label', 'position'] },
  ],
});

const FORM = defineAdminForm({
  id: 'widget.edit',
  fieldSet: 'widget',
  mode: 'edit',
  sections: [
    { key: 'identity', keys: ['name', 'kind'] },
    { key: 'where', keys: ['address'] },
  ],
});

describe('defineFieldSet / defineAdminForm (193 T011, FR-001)', () => {
  it('returns the declaration it was given', () => {
    expect(SET.fields.map((f) => f.key)).toEqual(['name', 'kind', 'address']);
    expect(FORM.id).toBe('widget.edit');
  });

  it('keeps the field keys and section keys as literal unions', () => {
    expectTypeOf<FieldKeyOf<typeof SET>>().toEqualTypeOf<'name' | 'kind' | 'address'>();
    expectTypeOf<FieldKeyOf<typeof FORM>>().toEqualTypeOf<'name' | 'kind' | 'address'>();
    expectTypeOf<SectionKeyOf<typeof FORM>>().toEqualTypeOf<'identity' | 'where'>();
    expectTypeOf(SET.id).toEqualTypeOf<'widget'>();
    expectTypeOf(FORM.mode).toEqualTypeOf<'edit'>();
  });

  it('refuses an unknown value type or override kind at the type level', () => {
    // Never called: these are `tsc`'s cases, and each would also throw at run time.
    const typeCases = () => {
      // @ts-expect-error — 'money' is not a FieldValueType
      defineFieldSet({ id: 'w', ownerModuleId: 'w', fields: [{ key: 'a', type: 'money', required: false, accepts: [] }] });
      // @ts-expect-error — 'colour' is not a FieldOverrideKind
      defineFieldSet({ id: 'w', ownerModuleId: 'w', fields: [{ key: 'a', type: 'string', required: false, accepts: ['colour'] }] });
      // @ts-expect-error — mode is create or edit
      defineAdminForm({ id: 'w.view', fieldSet: 'w', mode: 'view', sections: [] });
    };
    expect(typeof typeCases).toBe('function');
  });

  it('refuses at definition time what the Zod twin refuses, naming the rule', () => {
    expect(() =>
      defineFieldSet({
        id: 'widget',
        ownerModuleId: 'widgets',
        fields: [
          { key: 'name', type: 'string', required: true, accepts: [] },
          { key: 'name', type: 'string', required: false, accepts: [] },
        ],
      }),
    ).toThrow(/widget.*duplicate-field-key.*name/);
    expect(() =>
      defineAdminForm({ id: 'widget.edit', fieldSet: 'widget', mode: 'edit', sections: [{ key: 's', keys: ['a', 'a'] }] }),
    ).toThrow(/widget\.edit.*duplicate-form-key/);
  });
});

describe('vocabularies (193 T011, T013)', () => {
  it('pins the value types', () => {
    expect(FIELD_VALUE_TYPES).toEqual([
      'string', 'integer', 'decimal', 'boolean', 'date', 'datetime',
      'enum', 'string[]', 'enum[]', 'reference', 'reference[]', 'composite',
    ]);
    expectTypeOf<FieldValueType>().toEqualTypeOf<(typeof FIELD_VALUE_TYPES)[number]>();
  });

  it('splits the override kinds into the ten presentation kinds and the three server-enforced ones', () => {
    expect(FIELD_OVERRIDE_KINDS).toEqual([
      'label', 'help', 'placeholder', 'position', 'default', 'readOnly', 'hidden',
      'control', 'behaviour', 'visibleWhen', 'validation', 'requiredWhen', 'writePermission',
    ]);
    expect(PRESENTATION_OVERRIDES).toEqual(FIELD_OVERRIDE_KINDS.slice(0, 10));
    expect(SERVER_ENFORCED_OVERRIDES).toEqual(['validation', 'requiredWhen', 'writePermission']);
    expectTypeOf<(typeof PRESENTATION_OVERRIDES)[number]>().toExtend<FieldOverrideKind>();
  });

  it('pins the operator kinds, each a presentation kind', () => {
    expect(OPERATOR_KINDS).toEqual(['label', 'help', 'placeholder', 'position', 'hidden', 'readOnly']);
    for (const kind of OPERATOR_KINDS) expect(PRESENTATION_OVERRIDES).toContain(kind);
  });

  it('pins the field-rule codes (additive-only)', () => {
    expect(FIELD_RULE_CODES).toEqual([
      'required', 'too_short', 'too_long', 'below_min', 'above_max', 'not_an_option', 'pattern', 'format',
    ]);
  });

  it('pins the platform formats and the change channel', () => {
    expect(FIELD_FORMATS).toEqual(['email', 'tel', 'url', 'country', 'color']);
    expect(FORM_LAYOUT_CHANGED_CHANNEL).toBe('b2b:form-layout:changed');
  });
});

describe('FieldSetDeclarationSchema (193 T011, form-field-declaration.md §1, §3)', () => {
  const field = { key: 'name', type: 'string', required: false, accepts: ['label'] };
  const set = (fields: unknown[]) => ({ id: 'widget', ownerModuleId: 'widgets', fields });
  const refusal = (value: unknown) => JSON.stringify(FieldSetDeclarationSchema.safeParse(value).error?.issues ?? []);

  it('accepts the example shapes', () => {
    expect(FieldSetDeclarationSchema.safeParse(SET).success).toBe(true);
    expect(
      FieldSetDeclarationSchema.safeParse(
        set([
          { ...field, bounds: { minLength: 1, maxLength: 3 }, writePermission: 'widgets:manage' },
          { key: 'parentId', type: 'reference', references: 'widget', required: false, accepts: [] },
          { key: 'attributeValues.*', type: 'string', required: false, accepts: ['label'] },
          { key: 'vatNumber', type: 'string', required: false, accepts: [], deprecatedAliases: [{ key: 'taxId', since: '0.113.0' }] },
        ]),
      ).success,
    ).toBe(true);
  });

  it.each([
    ['an unknown type', set([{ ...field, type: 'money' }])],
    ['an unknown accepted kind', set([{ ...field, accepts: ['colour'] }])],
    ['a missing required flag', set([{ key: 'name', type: 'string', accepts: [] }])],
    ['a key that is not camelCase', set([{ ...field, key: 'Name' }])],
    ['a key with a hyphen', set([{ ...field, key: 'tax-id' }])],
    ['an upper-case set id', { ...set([field]), id: 'Widget' }],
    ['a malformed owner module id', { ...set([field]), ownerModuleId: 'Widgets' }],
    ['a negative bound', set([{ ...field, bounds: { minLength: -1 } }])],
    ['an extra key on a field', set([{ ...field, colour: 'red' }])],
    ['an empty field list', set([])],
  ])('refuses %s', (_name, value) => {
    expect(FieldSetDeclarationSchema.safeParse(value).success).toBe(false);
  });

  it('refuses a duplicate key, and an alias equal to a live key (duplicate-field-key)', () => {
    expect(refusal(set([field, field]))).toMatch(/duplicate-field-key/);
    expect(
      refusal(set([field, { key: 'vatNumber', type: 'string', required: false, accepts: [], deprecatedAliases: [{ key: 'name', since: '0.113.0' }] }])),
    ).toMatch(/duplicate-field-key/);
  });

  it('refuses options on a non-enum and an enum without options (options-type-mismatch)', () => {
    expect(refusal(set([{ ...field, options: ['a'] }]))).toMatch(/options-type-mismatch/);
    expect(refusal(set([{ ...field, type: 'enum' }]))).toMatch(/options-type-mismatch/);
    expect(refusal(set([{ ...field, type: 'enum[]' }]))).toMatch(/options-type-mismatch/);
    expect(FieldSetDeclarationSchema.safeParse(set([{ ...field, type: 'enum[]', options: ['a'] }])).success).toBe(true);
  });

  it('refuses hidden accepted on a required field (accepts-hidden-on-required)', () => {
    expect(refusal(set([{ ...field, required: true, accepts: ['hidden'] }]))).toMatch(/accepts-hidden-on-required/);
  });

  it('refuses control accepted on a composite field (accepts-control-on-composite)', () => {
    expect(refusal(set([{ ...field, type: 'composite', accepts: ['control'] }]))).toMatch(/accepts-control-on-composite/);
  });
});

describe('AdminFormDeclarationSchema (193 T011, form-field-declaration.md §1, §3)', () => {
  const form = { id: 'widget.create', fieldSet: 'widget', mode: 'create', sections: [{ key: 'main', keys: ['name'] }] };
  const refusal = (value: unknown) => JSON.stringify(AdminFormDeclarationSchema.safeParse(value).error?.issues ?? []);

  it('accepts the example shape', () => {
    expect(AdminFormDeclarationSchema.safeParse(form).success).toBe(true);
    expect(AdminFormDeclarationSchema.safeParse(FORM).success).toBe(true);
  });

  it.each([
    ['an unknown mode', { ...form, mode: 'view' }],
    ['an id outside its field set', { ...form, id: 'gadget.create' }],
    ['an id without a form part', { ...form, id: 'widget' }],
    ['a section with no key list', { ...form, sections: [{ key: 'main' }] }],
    ['a section key that is not camelCase', { ...form, sections: [{ key: 'Main', keys: ['name'] }] }],
  ])('refuses %s', (_name, value) => {
    expect(AdminFormDeclarationSchema.safeParse(value).success).toBe(false);
  });

  it('refuses a key shown twice, in one section or two (duplicate-form-key)', () => {
    expect(refusal({ ...form, sections: [{ key: 'main', keys: ['name', 'name'] }] })).toMatch(/duplicate-form-key/);
    expect(
      refusal({ ...form, sections: [{ key: 'main', keys: ['name'] }, { key: 'more', keys: ['name'] }] }),
    ).toMatch(/duplicate-form-key/);
  });

  it('refuses a section key declared twice', () => {
    expect(
      refusal({ ...form, sections: [{ key: 'main', keys: ['a'] }, { key: 'main', keys: ['b'] }] }),
    ).toMatch(/duplicate-section/);
  });
});

describe('FieldValidationTighteningSchema (193 T013, field-rules.md §1)', () => {
  it('accepts every member of the vocabulary', () => {
    expect(
      FieldValidationTighteningSchema.safeParse({
        required: true, minLength: 0, maxLength: 10, min: -1.5, max: 2, pattern: '^[A-Z]{2}\\d+$',
        options: ['a'], format: 'tel', messageKey: 'forms.taxId.pattern',
      }).success,
    ).toBe(true);
  });

  it.each([
    ['required: false (a tightening cannot loosen)', { required: false }],
    ['a fractional minLength', { minLength: 1.5 }],
    ['a zero maxLength', { maxLength: 0 }],
    ['an empty options list', { options: [] }],
    ['a pattern over 256 characters', { pattern: 'a'.repeat(257) }],
    ['a pattern that does not compile with the u flag', { pattern: '\\p{Nope}' }],
    ['a message key that is not a bundle key', { messageKey: 'Forms Tax' }],
    ['an unknown key', { minimum: 1 }],
  ])('refuses %s', (_name, value) => {
    expect(FieldValidationTighteningSchema.safeParse(value).success).toBe(false);
  });
});

describe('FieldOverrideSchema (193 T013, field-overrides.md §1)', () => {
  const override = { target: 'organization.emails', reason: 'Our sales team needs one address.' };

  it('accepts every kind', () => {
    expect(
      FieldOverrideSchema.safeParse({
        ...override,
        forms: ['organization.create'],
        labelKey: 'forms.emails.label',
        helpKey: 'forms.emails.help',
        placeholderKey: 'forms.emails.placeholder',
        position: { section: 'contact', after: 'name' },
        default: ['a@example.com'],
        readOnly: true,
        control: 'platform.email',
        visibleWhen: { field: 'kind', op: 'equals', value: 'company' },
        validation: { required: true },
        requiredWhen: { field: 'kind', op: 'equals', value: 'company' },
        writePermission: 'organizations:manage',
        maskEnforced: true,
      }).success,
    ).toBe(true);
    expect(FieldOverrideSchema.safeParse({ ...override, hidden: true }).success).toBe(true);
    expect(FieldOverrideSchema.safeParse({ ...override, target: 'product.attributeValues.color', labelKey: 'a.b' }).success).toBe(true);
    expect(FieldOverrideSchema.safeParse({ ...override, target: 'organization.acme_erp.code', hidden: true }).success).toBe(true);
  });

  it.each([
    ['no reason', { target: override.target, hidden: true }],
    ['an empty reason', { ...override, reason: '', hidden: true }],
    ['a reason over 280 characters', { ...override, reason: 'a'.repeat(281), hidden: true }],
    ['a target with no field', { ...override, target: 'organization', hidden: true }],
    ['hidden: false (nothing to override)', { ...override, hidden: false }],
    ['both before and after', { ...override, position: { before: 'a', after: 'b' } }],
    ['an empty forms list', { ...override, forms: [], hidden: true }],
    ['an unknown key (a typo is refused, not stripped)', { ...override, lable: 'x' }],
    ['a label that is not a bundle key', { ...override, labelKey: 'Label text' }],
    ['no override kind at all', override],
    ['an invalid condition', { ...override, visibleWhen: { field: 'kind', op: 'like', value: 'a' } }],
    ['an invalid tightening', { ...override, validation: { minimum: 1 } }],
  ])('refuses %s', (_name, value) => {
    expect(FieldOverrideSchema.safeParse(value).success).toBe(false);
  });
});

describe('fieldOverrideKinds (193 T013, field-overrides.md §1)', () => {
  it('maps each property to its kind, in FIELD_OVERRIDE_KINDS order', () => {
    expect(
      fieldOverrideKinds({
        target: 'organization.emails',
        reason: 'r',
        writePermission: 'organizations:manage',
        maskEnforced: true,
        placeholderKey: 'a.b',
        helpKey: 'a.c',
        labelKey: 'a.d',
        default: null,
      }),
    ).toEqual(['label', 'help', 'placeholder', 'default', 'behaviour', 'writePermission']);
    expect(fieldOverrideKinds({ target: 'organization.emails', reason: 'r' })).toEqual([]);
  });
});

describe('InputControlDeclarationSchema and PLATFORM_INPUT_CONTROLS (193 T013, input-controls.md §1)', () => {
  it('accepts a module control', () => {
    expect(InputControlDeclarationSchema.safeParse({ id: 'acme_erp.nip', outputType: 'string', format: 'acme_erp.nip' }).success).toBe(true);
    expect(InputControlDeclarationSchema.safeParse({ id: 'acme_erp.region', outputType: 'enum', optionsFromField: true }).success).toBe(true);
  });

  it('accepts a control of a `_`-prefixed module, as moduleIdRe does (D-300.16, #2020)', () => {
    expect(InputControlDeclarationSchema.safeParse({ id: '_lifecycle.x', outputType: 'string' }).success).toBe(true);
  });

  it.each([
    ['an id without a module part', { id: 'nip', outputType: 'string' }],
    ['an upper-case module part', { id: 'Acme.nip', outputType: 'string' }],
    ['an unknown output type', { id: 'acme_erp.nip', outputType: 'money' }],
    ['a format that is neither a platform format nor a module format', { id: 'acme_erp.nip', outputType: 'string', format: 'phone' }],
    ['an unknown key', { id: 'acme_erp.nip', outputType: 'string', mask: '999' }],
  ])('refuses %s', (_name, value) => {
    expect(InputControlDeclarationSchema.safeParse(value).success).toBe(false);
  });

  it('pins the platform controls, each valid, each a platform.* id, each format a platform format', () => {
    expect(PLATFORM_INPUT_CONTROLS.map((c) => [c.id, c.outputType])).toEqual([
      ['platform.text', 'string'],
      ['platform.textarea', 'string'],
      ['platform.email', 'string'],
      ['platform.tel', 'string'],
      ['platform.url', 'string'],
      ['platform.number', 'decimal'],
      ['platform.integer', 'integer'],
      ['platform.decimal', 'decimal'],
      ['platform.switch', 'boolean'],
      ['platform.select', 'enum'],
      ['platform.multiselect', 'enum[]'],
      ['platform.date', 'date'],
      ['platform.country', 'string'],
      ['platform.color', 'string'],
    ]);
    for (const control of PLATFORM_INPUT_CONTROLS) {
      expect(InputControlDeclarationSchema.safeParse(control).success, control.id).toBe(true);
      expect(control.id.startsWith('platform.')).toBe(true);
      if ('format' in control) expect(FIELD_FORMATS as readonly string[]).toContain(control.format);
    }
    const withFormat = PLATFORM_INPUT_CONTROLS.filter((c) => 'format' in c).map((c) => ('format' in c ? c.format : null));
    expect([...withFormat].sort()).toEqual([...FIELD_FORMATS].sort());
  });
});

describe('AdminFieldContributionSchema (193 T013, field-slots.md §1)', () => {
  const slot = {
    fieldSet: 'organization',
    key: 'erpCode',
    type: 'string',
    anchor: { field: 'taxId', position: 'after' },
    weight: 10,
    labelKey: 'forms.erpCode.label',
  };

  it('accepts a slot anchored on a field and one anchored on a section', () => {
    expect(AdminFieldContributionSchema.safeParse(slot).success).toBe(true);
    expect(
      AdminFieldContributionSchema.safeParse({
        ...slot,
        forms: ['organization.edit'],
        anchor: { section: 'identity', position: 'end' },
        helpKey: 'forms.erpCode.help',
        requiredPermission: ['acme_erp:read', 'acme_erp:manage'],
        writePermission: 'acme_erp:manage',
        visibleWhen: { field: 'kind', op: 'equals', value: 'company' },
      }).success,
    ).toBe(true);
  });

  it.each([
    ['a field anchor with a section position', { ...slot, anchor: { field: 'taxId', position: 'end' } }],
    ['a section anchor with a field position', { ...slot, anchor: { section: 'identity', position: 'after' } }],
    ['an anchor naming both', { ...slot, anchor: { field: 'taxId', section: 'identity', position: 'after' } }],
    ['a key with a module prefix (the module id is never declared)', { ...slot, key: 'acme_erp.erpCode' }],
    ['a key over 48 characters', { ...slot, key: `a${'b'.repeat(48)}` }],
    ['a fractional weight', { ...slot, weight: 1.5 }],
    ['a missing label', { ...slot, labelKey: undefined }],
    ['an empty forms list', { ...slot, forms: [] }],
  ])('refuses %s', (_name, value) => {
    expect(AdminFieldContributionSchema.safeParse(value).success).toBe(false);
  });

  it('is the data half of AdminFieldContribution, which adds the component factory', () => {
    const contribution: AdminFieldContribution = {
      fieldSet: 'organization',
      key: 'erpCode',
      type: 'string',
      anchor: { field: 'taxId', position: 'after' },
      weight: 10,
      labelKey: 'forms.erpCode.label',
      component: () => Promise.resolve({ default: null }),
    };
    expect(contribution.key).toBe('erpCode');
  });
});

describe('AdminFieldBehaviour (193 T013, field-rules.md §4)', () => {
  it('accepts a core target and an own-slot target', () => {
    expect(AdminFieldBehaviourSchema.safeParse({ target: 'organization.taxId' }).success).toBe(true);
    expect(AdminFieldBehaviourSchema.safeParse({ target: 'organization.acme_erp.erpCode', forms: ['organization.create'] }).success).toBe(true);
  });

  it('refuses a target with no field and an empty forms list', () => {
    expect(AdminFieldBehaviourSchema.safeParse({ target: 'organization' }).success).toBe(false);
    expect(AdminFieldBehaviourSchema.safeParse({ target: 'organization.taxId', forms: [] }).success).toBe(false);
  });

  it('joins AdminContributions as fields, controls and fieldBehaviours', () => {
    const behaviour: AdminFieldBehaviour = { target: 'organization.taxId', behaviour: () => Promise.resolve({ default: {} }) };
    const control: AdminInputControlContribution = { id: 'acme_erp.nip', component: () => Promise.resolve({ default: null }) };
    const contributions: AdminContributions = { fieldBehaviours: [behaviour], controls: [control], fields: [] };
    expect(contributions.fieldBehaviours).toHaveLength(1);
    expectTypeOf<NonNullable<AdminContributions['fields']>[number]>().toEqualTypeOf<AdminFieldContribution>();
  });
});

describe('EffectiveFormsResponseSchema (193 T013, field-overrides.md §2)', () => {
  const field = {
    key: 'emails',
    label: { source: 'code', module: 'acme', key: 'forms.emails.label' },
    help: { source: 'operator', text: { en: 'Where invoices go', pl: 'Dokąd idą faktury' } },
    section: 'contact',
    order: 2,
    readOnly: false,
    hidden: false,
    control: null,
    validation: { required: true },
    overriddenBy: [{ module: 'acme', origin: 'deployment', kinds: ['label', 'validation'] }],
    operatorKinds: ['help'],
  };

  it('accepts a response', () => {
    expect(EffectiveFormsResponseSchema.safeParse({ forms: [{ id: 'organization.edit', fieldSet: 'organization', fields: [field] }] }).success).toBe(true);
    expect(EffectiveFormsResponseSchema.safeParse({ forms: [] }).success).toBe(true);
  });

  it('refuses an unknown origin, a fractional order and an undefined control', () => {
    expect(EffectiveFieldSchema.safeParse({ ...field, overriddenBy: [{ module: 'acme', origin: 'overlay', kinds: [] }] }).success).toBe(false);
    expect(EffectiveFieldSchema.safeParse({ ...field, order: 1.5 }).success).toBe(false);
    expect(EffectiveFieldSchema.safeParse({ ...field, control: undefined }).success).toBe(false);
  });

  it('carries exactly the module origins', () => {
    for (const origin of MODULE_ORIGINS) {
      expect(EffectiveFieldSchema.safeParse({ ...field, overriddenBy: [{ module: 'a', origin, kinds: [] }] }).success, origin).toBe(true);
    }
  });

  it('EffectiveTextSchema is a code key or per-language operator text', () => {
    expect(EffectiveTextSchema.safeParse({ source: 'code', module: 'acme', key: 'a.b' }).success).toBe(true);
    expect(EffectiveTextSchema.safeParse({ source: 'operator', text: { en: 'A', pl: 'B' } }).success).toBe(true);
    expect(EffectiveTextSchema.safeParse({ source: 'operator', key: 'a.b' }).success).toBe(false);
    expect(EffectiveTextSchema.safeParse({ source: 'bundle', key: 'a.b' }).success).toBe(false);
  });
});

describe('FormLayoutOverrideSource (193 T015, operator-form-layout.md §4)', () => {
  it('lists every stored row', () => {
    expectTypeOf<FormLayoutOverrideSource['listAll']>().returns.toEqualTypeOf<Promise<readonly FormLayoutOverrideRow[]>>();
    expectTypeOf<FormLayoutOverrideRow['labels']>().toEqualTypeOf<Readonly<Record<string, string>> | null>();
  });
});
