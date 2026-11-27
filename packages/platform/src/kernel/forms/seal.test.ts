import { describe, expect, it } from 'vitest';
import {
  PRESENTATION_OVERRIDES,
  defineAdminForm,
  defineFieldSet,
  hookableAction,
  type FieldOverride,
  type ModuleOrigin,
} from '@endora-commerce/contracts';
import {
  FormCompositionError,
  InvalidFormOverrideGrantError,
  PackageFormOverrideNotGrantedError,
} from './errors.js';
import { sealForms, type FormSealInput } from './seal.js';
import type { FieldSetWriter } from './types.js';

/**
 * `specs/193-admin-form-extensions/` T019 (FR-021, FR-051, D-300.2;
 * `contracts/field-overrides.md` §3, `form-field-declaration.md` §3,
 * `field-rules.md` §2, `input-controls.md` §2 – §3): composition refuses each
 * declaration that would promise a rule nobody enforces or a form nobody can
 * fill, naming the module, the field set, the field and the remedy.
 */

const WIDGET = defineFieldSet({
  id: 'widget',
  ownerModuleId: 'widgets',
  fields: [
    {
      key: 'name',
      type: 'string',
      required: true,
      bounds: { minLength: 1, maxLength: 100 },
      accepts: ['label', 'help', 'placeholder', 'position', 'control', 'behaviour', 'validation', 'readOnly'],
    },
    {
      key: 'code',
      type: 'string',
      required: false,
      bounds: { maxLength: 32 },
      accepts: [...PRESENTATION_OVERRIDES, 'validation', 'requiredWhen', 'writePermission'],
      deprecatedAliases: [{ key: 'oldCode', since: '0.112.0' }],
    },
    { key: 'kind', type: 'enum', options: ['a', 'b', 'c'], required: false, accepts: [...PRESENTATION_OVERRIDES, 'validation', 'requiredWhen'] },
    { key: 'size', type: 'decimal', required: false, bounds: { min: 0, max: 1000 }, accepts: [...PRESENTATION_OVERRIDES, 'validation'] },
    { key: 'parentId', type: 'reference', references: 'widget', required: false, accepts: [...PRESENTATION_OVERRIDES] },
    { key: 'emails', type: 'string[]', required: false, accepts: [...PRESENTATION_OVERRIDES, 'validation', 'requiredWhen', 'writePermission'] },
    { key: 'note', type: 'string', required: false, accepts: ['label'] },
    { key: 'secret', type: 'string', required: false, writePermission: 'widgets:secret', accepts: ['label'] },
    { key: 'attributeValues.*', type: 'string', required: false, accepts: ['label', 'validation'] },
  ],
});

const CREATE = defineAdminForm({
  id: 'widget.create',
  fieldSet: 'widget',
  mode: 'create',
  sections: [
    { key: 'main', keys: ['name', 'code', 'kind', 'size'] },
    { key: 'more', keys: ['parentId', 'emails', 'note', 'secret'] },
  ],
});
const EDIT = defineAdminForm({
  id: 'widget.edit',
  fieldSet: 'widget',
  mode: 'edit',
  sections: [
    { key: 'main', keys: ['name', 'code', 'kind', 'size'] },
    { key: 'extra', keys: ['parentId', 'emails', 'note', 'secret'] },
  ],
});

const WIDGET_CREATE = hookableAction<unknown>('widget.create', 'widget', ['beforeCommit']);
const WIDGET_UPDATE = hookableAction<unknown>('widget.update', 'widget', ['beforeCommit']);
const WIDGET_BULK = hookableAction<unknown>('widget.bulk_update.item', 'widget', ['beforeCommit']);
const ALL_KEYS = ['name', 'code', 'kind', 'size', 'parentId', 'emails', 'note', 'secret', 'attributeValues.*'];

function writer(on: typeof WIDGET_CREATE, extra: Partial<FieldSetWriter> = {}): FieldSetWriter {
  return {
    on,
    mode: on === WIDGET_CREATE ? 'create' : 'update',
    project: () => ({ after: {}, changed: [] }),
    writes: ALL_KEYS,
    ...extra,
  };
}

const ORIGINS: Record<string, ModuleOrigin> = {
  widgets: 'core',
  other_core: 'core',
  acme: 'deployment',
  acme_two: 'deployment',
  vendor_pim: 'package',
  nodeps: 'deployment',
};

function input(extra: Partial<FormSealInput> = {}): FormSealInput {
  return {
    fieldSets: [{ moduleId: 'widgets', set: WIDGET }],
    adminForms: [
      { moduleId: 'widgets', form: CREATE },
      { moduleId: 'widgets', form: EDIT },
    ],
    formOverrides: [],
    inputControls: [{ moduleId: 'acme', control: { id: 'acme.nip', outputType: 'string', format: 'acme.nip' } }],
    hookableActions: [
      { moduleId: 'widgets', action: 'widget.create', objectType: 'widget', phases: ['beforeCommit'] },
      { moduleId: 'widgets', action: 'widget.update', objectType: 'widget', phases: ['beforeCommit'] },
    ],
    moduleDependencies: {
      widgets: [],
      other_core: ['widgets'],
      acme: ['widgets'],
      acme_two: ['widgets'],
      vendor_pim: ['widgets'],
      nodeps: [],
    },
    permissionCodes: ['widgets:secret', 'widgets:code', 'acme:code'],
    formOverrideGrants: {},
    origins: ORIGINS,
    installedPackageNames: { vendor_pim: '@vendor/pim' },
    writers: [{ moduleId: 'widgets', set: WIDGET, writers: [writer(WIDGET_CREATE), writer(WIDGET_UPDATE)] }],
    formats: [{ moduleId: 'acme', id: 'acme.nip', validate: (value) => /^\d{10}$/.test(value) }],
    ...extra,
  };
}

const override = (moduleId: string, value: Omit<FieldOverride, 'reason'> & { reason?: string }) => ({
  moduleId,
  override: { reason: 'Because the deployment says so.', ...value } as FieldOverride,
});

/** The refusal `sealForms` throws for `extra`, or a failure when it does not throw. */
function refusal(extra: Partial<FormSealInput>): FormCompositionError {
  try {
    sealForms(input(extra));
  } catch (error) {
    if (error instanceof FormCompositionError) return error;
    throw error;
  }
  throw new Error('sealForms did not refuse');
}

describe('sealForms — a valid composition (193 T019)', () => {
  it('seals the fixture with no refusal and no warning', () => {
    const sealed = sealForms(input());
    expect(sealed.warnings).toEqual([]);
    expect(sealed.fieldSets.get('widget')?.ownerModuleId).toBe('widgets');
  });

  it('admits a deployment override within accepts, on a granted package too', () => {
    const sealed = sealForms(
      input({
        formOverrides: [
          override('acme', { target: 'widget.code', labelKey: 'widget.code.label', validation: { maxLength: 10, pattern: '^[A-Z]+$' } }),
          override('vendor_pim', { target: 'widget.kind', validation: { options: ['a', 'b'] } }),
        ],
        formOverrideGrants: { widget: [{ moduleId: 'vendor_pim', packageName: '@vendor/pim', reason: 'PIM owns kinds.' }] },
      }),
    );
    expect(sealed.warnings).toEqual([]);
  });

  it('warns, and does not refuse, an override naming a deprecated alias (FR-071)', () => {
    const sealed = sealForms(input({ formOverrides: [override('acme', { target: 'widget.oldCode', labelKey: 'a.b' })] }));
    expect(sealed.warnings).toEqual([expect.objectContaining({ code: 'deprecated-target', moduleId: 'acme', fieldSet: 'widget', field: 'oldCode' })]);
  });
});

describe('sealForms — the owner side (193 T019, form-field-declaration.md §2 – §3, field-rules.md §2)', () => {
  it('duplicate-field-set', () => {
    expect(refusal({ fieldSets: [{ moduleId: 'widgets', set: WIDGET }, { moduleId: 'other_core', set: WIDGET }] }).code).toBe('duplicate-field-set');
  });

  it('duplicate-form', () => {
    expect(refusal({ adminForms: [{ moduleId: 'widgets', form: CREATE }, { moduleId: 'other_core', form: CREATE }] }).code).toBe('duplicate-form');
  });

  it('unknown-field-set: a form over a set nobody declares', () => {
    const form = defineAdminForm({ id: 'gadget.create', fieldSet: 'gadget', mode: 'create', sections: [{ key: 'main', keys: ['name'] }] });
    expect(refusal({ adminForms: [{ moduleId: 'widgets', form }] }).code).toBe('unknown-field-set');
  });

  it('unknown-field: a form showing a key its set does not declare', () => {
    const form = defineAdminForm({ id: 'widget.quick', fieldSet: 'widget', mode: 'create', sections: [{ key: 'main', keys: ['name', 'colour'] }] });
    const error = refusal({ adminForms: [{ moduleId: 'widgets', form }] });
    expect(error).toMatchObject({ code: 'unknown-field', moduleId: 'widgets', fieldSet: 'widget', field: 'colour' });
  });

  it('form-owner-not-a-dependency: a form declared by a module that does not depend on the set owner (FR-083)', () => {
    const form = defineAdminForm({ id: 'widget.quick', fieldSet: 'widget', mode: 'edit', sections: [{ key: 'main', keys: ['name'] }] });
    expect(refusal({ adminForms: [{ moduleId: 'nodeps', form }] }).code).toBe('form-owner-not-a-dependency');
  });

  it('unknown-permission: an owner writePermission outside the vocabulary', () => {
    expect(refusal({ permissionCodes: ['widgets:code'] })).toMatchObject({ code: 'unknown-permission', field: 'secret' });
  });

  it('foreign-field-set-registration: writers registered by a module that does not own the set', () => {
    expect(refusal({ writers: [{ moduleId: 'acme', set: WIDGET, writers: [writer(WIDGET_UPDATE)] }] }).code).toBe('foreign-field-set-registration');
  });

  it('unknown-field-set: writers for a set no manifest declares', () => {
    const set = defineFieldSet({ id: 'gadget', ownerModuleId: 'widgets', fields: [{ key: 'name', type: 'string', required: false, accepts: [] }] });
    expect(refusal({ writers: [...input().writers, { moduleId: 'widgets', set, writers: [] }] }).code).toBe('unknown-field-set');
  });

  it('duplicate-field-set-registration: one set registered twice', () => {
    expect(refusal({ writers: [...input().writers, ...input().writers] }).code).toBe('duplicate-field-set-registration');
  });

  it('unknown-field: a writer writing a key outside the set', () => {
    expect(refusal({ writers: [{ moduleId: 'widgets', set: WIDGET, writers: [writer(WIDGET_UPDATE, { writes: ['name', 'colour'] })] }] }))
      .toMatchObject({ code: 'unknown-field', field: 'colour' });
  });

  it('writer-not-hookable: a writer on an action nobody declares hookable', () => {
    expect(refusal({ writers: [{ moduleId: 'widgets', set: WIDGET, writers: [writer(WIDGET_UPDATE), writer(WIDGET_BULK)] }] }).code).toBe(
      'writer-not-hookable',
    );
  });

  it('writer-not-hookable: a writer on an action that offers no beforeCommit', () => {
    expect(
      refusal({
        hookableActions: [
          { moduleId: 'widgets', action: 'widget.create', objectType: 'widget', phases: ['beforeCommit'] },
          { moduleId: 'widgets', action: 'widget.update', objectType: 'widget', phases: ['afterCommit'] },
        ],
      }).code,
    ).toBe('writer-not-hookable');
  });

  it('rule-check-only-writer-hookable: a rule-check-only writer on a hookable action (FR-113)', () => {
    expect(
      refusal({ writers: [{ moduleId: 'widgets', set: WIDGET, writers: [writer(WIDGET_CREATE), writer(WIDGET_UPDATE, { ruleCheckOnly: true })] }] }).code,
    ).toBe('rule-check-only-writer-hookable');
  });

  it('admits a rule-check-only writer on a non-hookable action', () => {
    expect(() =>
      sealForms(
        input({
          writers: [{ moduleId: 'widgets', set: WIDGET, writers: [writer(WIDGET_CREATE), writer(WIDGET_UPDATE), writer(WIDGET_BULK, { ruleCheckOnly: true })] }],
        }),
      ),
    ).not.toThrow();
  });

  it('accepts-unenforceable: a field accepting a server-enforced kind no writer writes', () => {
    const writes = ALL_KEYS.filter((key) => key !== 'emails');
    expect(
      refusal({ writers: [{ moduleId: 'widgets', set: WIDGET, writers: [writer(WIDGET_CREATE, { writes }), writer(WIDGET_UPDATE, { writes })] }] }),
    ).toMatchObject({ code: 'accepts-unenforceable', field: 'emails' });
  });

  it('accepts-unenforceable: a field set whose owner registered no writers', () => {
    expect(refusal({ writers: [] }).code).toBe('accepts-unenforceable');
  });
});

describe('sealForms — overrides (193 T019, field-overrides.md §3)', () => {
  const refuse = (...overrides: ReturnType<typeof override>[]) => refusal({ formOverrides: overrides });

  it('unknown-field: a target the set does not declare', () => {
    expect(refuse(override('acme', { target: 'widget.colour', labelKey: 'a.b' }))).toMatchObject({ code: 'unknown-field', moduleId: 'acme', field: 'colour' });
  });

  it('unknown-field-set: a target on a set nobody declares', () => {
    expect(refuse(override('acme', { target: 'gadget.name', labelKey: 'a.b' })).code).toBe('unknown-field-set');
  });

  it('unknown-form: a forms narrowing naming no form of the set', () => {
    expect(refuse(override('acme', { target: 'widget.code', forms: ['widget.quick'], labelKey: 'a.b' })).code).toBe('unknown-form');
  });

  it('unknown-section: a position into a section the form does not have', () => {
    expect(refuse(override('acme', { target: 'widget.code', forms: ['widget.create'], position: { section: 'extra' } })).code).toBe('unknown-section');
  });

  it('unknown-field: a position before a key the form does not show', () => {
    expect(refuse(override('acme', { target: 'widget.code', position: { before: 'colour' } }))).toMatchObject({ code: 'unknown-field', field: 'colour' });
  });

  it('override-not-accepted', () => {
    expect(refuse(override('acme', { target: 'widget.note', hidden: true })).code).toBe('override-not-accepted');
  });

  it('hidden-required-field', () => {
    // `accepts-hidden-on-required` refuses the declaration itself; a hand-built
    // declaration that slipped past it is still refused here.
    const unsafe = { ...WIDGET, fields: WIDGET.fields.map((f) => (f.key === 'name' ? { ...f, accepts: [...f.accepts, 'hidden' as const] } : f)) };
    expect(
      refusal({
        fieldSets: [{ moduleId: 'widgets', set: unsafe }],
        writers: [{ moduleId: 'widgets', set: unsafe, writers: [writer(WIDGET_CREATE), writer(WIDGET_UPDATE)] }],
        formOverrides: [override('acme', { target: 'widget.name', hidden: true })],
      }).code,
    ).toBe('hidden-required-field');
  });

  it('default-on-hidden', () => {
    expect(refuse(override('acme', { target: 'widget.code', hidden: true, default: 'X' })).code).toBe('default-on-hidden');
  });

  it('default-type-mismatch: a default the field type cannot hold', () => {
    expect(refuse(override('acme', { target: 'widget.size', default: 'many' })).code).toBe('default-type-mismatch');
    expect(refuse(override('acme', { target: 'widget.kind', default: 'z' })).code).toBe('default-type-mismatch');
  });

  it('leaves read-only on a required create field to check:admin-forms (D-300.12)', () => {
    // Whether a derivation fills it is the admin layer's to see; composition
    // refuses only what is never submitted.
    expect(() => sealForms(input({ formOverrides: [override('acme', { target: 'widget.name', readOnly: true })] }))).not.toThrow();
  });

  it('required-not-fillable: a tightened-required field hidden on a create form', () => {
    expect(refuse(override('acme', { target: 'widget.code', forms: ['widget.create'], hidden: true }), override('acme_two', { target: 'widget.code', validation: { required: true } })).code).toBe(
      'required-not-fillable',
    );
  });

  it('admits read-only on a required field on an edit form only', () => {
    expect(() => sealForms(input({ formOverrides: [override('acme', { target: 'widget.name', forms: ['widget.edit'], readOnly: true })] }))).not.toThrow();
  });

  it('override-loosens-rule: a bound outside the core bounds', () => {
    expect(refuse(override('acme', { target: 'widget.code', validation: { maxLength: 64 } })).code).toBe('override-loosens-rule');
    expect(refuse(override('acme', { target: 'widget.size', validation: { min: -1 } })).code).toBe('override-loosens-rule');
  });

  it('override-loosens-rule: options outside the core enum', () => {
    expect(refuse(override('acme', { target: 'widget.kind', validation: { options: ['a', 'z'] } })).code).toBe('override-loosens-rule');
  });

  it('override-loosens-rule: a rule the field type does not have', () => {
    expect(refuse(override('acme', { target: 'widget.size', validation: { pattern: '^1' } })).code).toBe('override-loosens-rule');
    expect(refuse(override('acme', { target: 'widget.code', validation: { min: 1 } })).code).toBe('override-loosens-rule');
  });

  it('override-loosens-rule: required on a core-required field', () => {
    expect(refuse(override('acme', { target: 'widget.name', validation: { required: true } })).code).toBe('override-loosens-rule');
  });

  it('override-contradiction: two modules’ bounds with no value between them', () => {
    expect(
      refuse(override('acme', { target: 'widget.code', validation: { minLength: 10 } }), override('acme_two', { target: 'widget.code', validation: { maxLength: 5 } })).code,
    ).toBe('override-contradiction');
  });

  it('override-contradiction: disjoint options', () => {
    expect(
      refuse(override('acme', { target: 'widget.kind', validation: { options: ['a'] } }), override('acme_two', { target: 'widget.kind', validation: { options: ['b'] } })).code,
    ).toBe('override-contradiction');
  });

  it('override-contradiction: two different formats on one field', () => {
    expect(
      refuse(override('acme', { target: 'widget.code', validation: { format: 'email' } }), override('acme_two', { target: 'widget.code', validation: { format: 'tel' } })).code,
    ).toBe('override-contradiction');
  });

  it('override-conflict: two modules set one presentation kind on one form', () => {
    expect(
      refuse(override('acme', { target: 'widget.code', labelKey: 'a.b' }), override('acme_two', { target: 'widget.code', forms: ['widget.edit'], labelKey: 'c.d' })).code,
    ).toBe('override-conflict');
  });

  it('admits two modules relabelling one field on different forms, and hiding one field together', () => {
    expect(() =>
      sealForms(
        input({
          formOverrides: [
            override('acme', { target: 'widget.code', forms: ['widget.create'], labelKey: 'a.b', hidden: true }),
            override('acme_two', { target: 'widget.code', forms: ['widget.edit'], labelKey: 'c.d' }),
            override('acme_two', { target: 'widget.note', labelKey: 'c.e' }),
            override('acme', { target: 'widget.emails', hidden: true }),
            override('acme_two', { target: 'widget.emails', hidden: true }),
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('override-conflict: two different writePermissions on one field', () => {
    expect(refuse(override('acme', { target: 'widget.code', writePermission: 'widgets:code' }), override('acme_two', { target: 'widget.code', writePermission: 'acme:code' })).code).toBe(
      'override-conflict',
    );
  });

  it('override-conflict: two modules\u2019 requiredWhen that together exceed the condition caps', () => {
    const deep = { not: { all: [{ any: [{ field: 'kind', op: 'isEmpty' as const }] }] } };
    expect(refuse(override('acme', { target: 'widget.code', requiredWhen: deep }), override('acme_two', { target: 'widget.code', requiredWhen: deep })).code).toBe(
      'override-conflict',
    );
    expect(() =>
      sealForms(
        input({
          formOverrides: [
            override('acme', { target: 'widget.code', requiredWhen: { field: 'kind', op: 'equals', value: 'a' } }),
            override('acme_two', { target: 'widget.code', requiredWhen: { field: 'kind', op: 'equals', value: 'b' } }),
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('unknown-control', () => {
    expect(refuse(override('acme', { target: 'widget.code', control: 'acme.colourWheel' })).code).toBe('unknown-control');
  });

  it('control-type-mismatch: a number control on a string field, and any control on a reference', () => {
    expect(refuse(override('acme', { target: 'widget.code', control: 'platform.number' })).code).toBe('control-type-mismatch');
    expect(refuse(override('acme', { target: 'widget.parentId', control: 'platform.text' })).code).toBe('control-type-mismatch');
  });

  it('control-type-mismatch: a select control on a string field without validation options', () => {
    expect(refuse(override('acme', { target: 'widget.code', control: 'platform.select' })).code).toBe('control-type-mismatch');
    expect(() => sealForms(input({ formOverrides: [override('acme', { target: 'widget.code', control: 'platform.select', validation: { options: ['A', 'B'] } })] }))).not.toThrow();
  });

  it('admits the fit table’s compatible pairs', () => {
    expect(() =>
      sealForms(
        input({
          formOverrides: [
            override('acme', { target: 'widget.code', control: 'acme.nip' }),
            override('acme', { target: 'widget.size', control: 'platform.integer' }),
            override('acme', { target: 'widget.kind', control: 'platform.select' }),
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('format-without-validator: a module control whose format nobody registered', () => {
    expect(refusal({ formats: [], formOverrides: [override('acme', { target: 'widget.code', control: 'acme.nip' })] }).code).toBe('format-without-validator');
  });

  it('format-without-validator: a validation format that is neither a platform format nor registered', () => {
    expect(refuse(override('acme', { target: 'widget.code', validation: { format: 'acme.regon' } })).code).toBe('format-without-validator');
  });

  it('condition-foreign-field: a condition naming another field set’s key or another module’s slot', () => {
    expect(refuse(override('acme', { target: 'widget.code', requiredWhen: { field: 'colour', op: 'isEmpty' } })).code).toBe('condition-foreign-field');
    expect(refuse(override('acme', { target: 'widget.code', visibleWhen: { field: 'other_mod.flag', op: 'isEmpty' } })).code).toBe('condition-foreign-field');
  });

  it('admits a condition on a core key and on the declaring module’s own slot', () => {
    expect(() =>
      sealForms(
        input({
          formOverrides: [
            override('acme', { target: 'widget.code', requiredWhen: { field: 'kind', op: 'equals', value: 'a' } }),
            override('acme', { target: 'widget.emails', visibleWhen: { field: 'acme.flag', op: 'isNotEmpty' } }),
          ],
        }),
      ),
    ).not.toThrow();
  });

  it('unknown-permission: an override writePermission outside the vocabulary', () => {
    expect(refuse(override('acme', { target: 'widget.code', writePermission: 'acme:nothing' })).code).toBe('unknown-permission');
  });

  it('foreign-override: a core module overriding another module’s field set (D-300.2)', () => {
    expect(refuse(override('other_core', { target: 'widget.code', labelKey: 'a.b' })).code).toBe('foreign-override');
  });

  it('override-owner-not-a-dependency', () => {
    expect(refuse(override('nodeps', { target: 'widget.code', labelKey: 'a.b' })).code).toBe('override-owner-not-a-dependency');
  });

  it('PackageFormOverrideNotGrantedError: a package overriding without a grant (D-300.2)', () => {
    const error = refuse(override('vendor_pim', { target: 'widget.code', labelKey: 'a.b' }));
    expect(error).toBeInstanceOf(PackageFormOverrideNotGrantedError);
    expect(error).toMatchObject({ moduleId: 'vendor_pim', fieldSet: 'widget' });
    expect(error.message).toContain('formOverrideGrants');
  });

  it('a family member target is validated against its family (FR-123)', () => {
    expect(() => sealForms(input({ formOverrides: [override('acme', { target: 'widget.attributeValues.color', labelKey: 'a.b' })] }))).not.toThrow();
    expect(refuse(override('acme', { target: 'widget.attributeValues.color', hidden: true })).code).toBe('override-not-accepted');
  });
});

describe('sealForms — grants (193 T019, field-overrides.md §4, 189 module-origin.md §5)', () => {
  const granted = (grant: { moduleId: string; packageName: string; reason?: string }, set = 'widget') => ({
    formOverrideGrants: { [set]: [{ reason: 'Because.', ...grant }] },
  });
  const packageOverride = [override('vendor_pim', { target: 'widget.code', labelKey: 'a.b' })];

  const grantRefusal = (extra: Partial<FormSealInput>): InvalidFormOverrideGrantError => {
    const error = refusal(extra);
    expect(error).toBeInstanceOf(InvalidFormOverrideGrantError);
    return error as InvalidFormOverrideGrantError;
  };

  it('unknown-field-set', () => {
    expect(grantRefusal({ formOverrides: packageOverride, ...granted({ moduleId: 'vendor_pim', packageName: '@vendor/pim' }, 'gadget') }).issue).toBe('unknown-field-set');
  });

  it('unknown-module', () => {
    expect(grantRefusal({ ...granted({ moduleId: 'nobody', packageName: '@x/y' }) }).issue).toBe('unknown-module');
  });

  it('not-a-package: a grant naming a deployment or core module', () => {
    expect(grantRefusal({ ...granted({ moduleId: 'acme', packageName: '@x/y' }) }).issue).toBe('not-a-package');
  });

  it('package-name-mismatch: matched on module id and installed package name', () => {
    expect(grantRefusal({ formOverrides: packageOverride, ...granted({ moduleId: 'vendor_pim', packageName: '@impostor/pim' }) }).issue).toBe(
      'package-name-mismatch',
    );
  });

  it('unused: a grant no override of that package uses', () => {
    expect(grantRefusal({ ...granted({ moduleId: 'vendor_pim', packageName: '@vendor/pim' }) }).issue).toBe('unused');
  });
});

describe('sealForms — formats (193 T019, T023, input-controls.md §1)', () => {
  it('refuses a module format registered outside its own namespace', () => {
    expect(refusal({ formats: [{ moduleId: 'acme', id: 'other.nip', validate: () => true }] }).code).toBe('foreign-field-format');
  });

  it('refuses one format registered twice', () => {
    const format = { moduleId: 'acme', id: 'acme.nip', validate: () => true };
    expect(refusal({ formats: [format, format] }).code).toBe('duplicate-field-format');
  });

  it('names module, field set, field and remedy in every refusal', () => {
    const error = refusal({ formOverrides: [override('acme', { target: 'widget.note', hidden: true })] });
    expect(error.message).toContain("'acme'");
    expect(error.message).toContain("'widget'");
    expect(error.message).toContain("'note'");
    expect(error.remedy.length).toBeGreaterThan(10);
  });
});
