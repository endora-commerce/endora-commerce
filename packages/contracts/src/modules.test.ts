import { describe, expect, expectTypeOf, it } from 'vitest';
import { CAPABILITY_KEYS } from './capabilities.js';
import {
  DeploymentDivergenceDeclarationSchema,
  EntityExtensionDeclarationSchema,
  GUARD_SEAM_REGISTRATIONS,
  MODULE_ORIGINS,
  ORGANIZATION_PERMISSION_CODE,
  defineModuleManifest,
  guardSeamReplacementFor,
  isGuardSeamRegistration,
  moduleOrganizationPermissionDeclarationSchema,
  type DivergenceDetail,
  type DivergenceKind,
  type GuardSeamRegistration,
  type ModuleManifest,
  type ModuleOrigin,
} from './modules.js';

/**
 * `specs/132-connector-family-discovery/contracts/module-capabilities.md` R4 —
 * the four cross-field rules `defineModuleManifest` can decide from **one**
 * manifest, on the author's own machine, at import time, with no database.
 *
 * R3.4 ("exactly one owner per key") and R3.6 ("a member of an exclusive key may
 * not default to activated") are deliberately **not** here: both need to see a
 * family, and this function sees one manifest. They are the derivation's
 * refusals (`capabilityRegistryFrom`).
 *
 * Every proof hands `defineModuleManifest` a whole manifest — the top of the
 * analysis, which is where a red proof has to enter. And every one asserts the
 * refusal **names the module and the key**, not merely that it throws: the
 * author reading it has sixty-odd manifests and a message that names neither
 * sends them hunting.
 */
function manifest(overrides: Partial<ModuleManifest> & { id: string }): ModuleManifest {
  return defineModuleManifest({
    name: 'Fixture module',
    version: '1.0.0',
    dependencies: [],
    ...overrides,
  } as ModuleManifest);
}

/** The activation control must sit in the declaring module's own namespace, so it is derived. */
function activation(id: string): { settingCode: string; default: boolean } {
  return { settingCode: `${id}.activation`, default: false };
}

describe('defineModuleManifest — capability declarations (feature 132, contract R4)', () => {
  describe('what it accepts', () => {
    it('accepts a member: `capabilities` beside an activation control', () => {
      const parsed = manifest({
        id: 'fixture_capabilities',
        capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR],
        activation: activation('fixture_capabilities'),
      });
      expect(parsed.capabilities).toEqual(['pim-connector']);
    });

    it('accepts an owner: `exclusiveCapabilities` with the code it mints', () => {
      const parsed = manifest({
        id: 'fixture_owner',
        activation: { nonDeactivatable: true, reason: 'The family owner is always present.' },
        exclusiveCapabilities: [
          { key: CAPABILITY_KEYS.PIM_CONNECTOR, errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE' },
        ],
      });
      expect(parsed.exclusiveCapabilities).toEqual([
        { key: 'pim-connector', errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE' },
      ]);
    });

    it('accepts a manifest that declares neither — absent is most modules and is not a finding', () => {
      const parsed = manifest({ id: 'fixture_silent' });
      expect(parsed.capabilities).toBeUndefined();
      expect(parsed.exclusiveCapabilities).toBeUndefined();
    });

    it('accepts an owner declaring membership of a DIFFERENT key — two keys never exclude each other', () => {
      const parsed = manifest({
        id: 'fixture_both_keys',
        activation: activation('fixture_both_keys'),
        capabilities: [CAPABILITY_KEYS.ERP_CONNECTOR],
        exclusiveCapabilities: [
          { key: CAPABILITY_KEYS.PIM_CONNECTOR, errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE' },
        ],
      });
      expect(parsed.capabilities).toEqual(['erp-connector']);
    });

    it('refuses a key that is not kebab-case — the schema shape, R1.2', () => {
      expect(() =>
        manifest({
          id: 'fixture_capabilities',
          activation: activation('fixture_capabilities'),
          capabilities: ['pim_connector'],
        }),
      ).toThrow();
    });
  });

  describe('R4.1 — a member MUST declare `activation`', () => {
    it('refuses, naming the module and the key it declared', () => {
      let message = '';
      try {
        manifest({
          id: 'fixture_no_activation',
          capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR],
        });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain('fixture_no_activation');
      expect(message).toContain('pim-connector');
      expect(message).toContain('activation');
    });

    it('does not ask it of an OWNER that declares no membership', () => {
      // An owner needs no activation control for this rule's sake: it is not
      // resolved on the activation axis, its members are. (In this tree all
      // three owners are `nonDeactivatable`, which is a separate decision.)
      expect(() =>
        manifest({
          id: 'fixture_owner_no_activation',
          exclusiveCapabilities: [
            { key: CAPABILITY_KEYS.PIM_CONNECTOR, errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE' },
          ],
        }),
      ).not.toThrow();
    });
  });

  describe('R4.2 — `capabilities` MUST NOT contain a duplicate key', () => {
    it('refuses, naming the module and the key', () => {
      let message = '';
      try {
        manifest({
          id: 'fixture_dup_member',
          activation: activation('fixture_dup_member'),
          capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR, CAPABILITY_KEYS.PIM_CONNECTOR],
        });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain('fixture_dup_member');
      expect(message).toContain('pim-connector');
    });
  });

  describe('R4.3 — `exclusiveCapabilities` MUST NOT carry two entries for one key', () => {
    it('refuses, naming the module and the key', () => {
      let message = '';
      try {
        manifest({
          id: 'fixture_dup_owner',
          activation: activation('fixture_dup_owner'),
          exclusiveCapabilities: [
            { key: CAPABILITY_KEYS.PIM_CONNECTOR, errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE' },
            { key: CAPABILITY_KEYS.PIM_CONNECTOR, errorCode: 'ERP_CONNECTOR_ALREADY_ACTIVE' },
          ],
        });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain('fixture_dup_owner');
      expect(message).toContain('pim-connector');
    });
  });

  describe('R4.4 — one key MUST NOT appear in both arrays of one manifest (R3.3)', () => {
    it('refuses, naming the module and the key', () => {
      let message = '';
      try {
        manifest({
          id: 'fixture_self_family',
          activation: activation('fixture_self_family'),
          capabilities: [CAPABILITY_KEYS.PIM_CONNECTOR],
          exclusiveCapabilities: [
            { key: CAPABILITY_KEYS.PIM_CONNECTOR, errorCode: 'PIM_CONNECTOR_ALREADY_ACTIVE' },
          ],
        });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toContain('fixture_self_family');
      expect(message).toContain('pim-connector');
    });
  });
});

/**
 * `specs/170-organization-roles/` WP-01 (T008) — the `organizationPermissions`
 * manifest field (`contracts/organization-permissions-manifest.md` §1; FR-020,
 * research R-2). The vocabulary a buyer's role is built from is declared by the
 * module whose action each code gates, in that module's own namespace.
 */
describe('defineModuleManifest — organization permission declarations (feature 170)', () => {
  const declaration = (code: string) => ({
    code,
    label: 'Create and edit carts',
    description: 'Add products to a cart and change it.',
    memberDefault: true,
  });

  it('accepts a declaration in the module\'s own namespace', () => {
    const parsed = manifest({
      id: 'fixture_carts',
      organizationPermissions: [declaration('fixture_carts.create'), { ...declaration('fixture_carts.approve'), memberDefault: false }],
    });
    expect(parsed.organizationPermissions?.map((d) => d.code)).toEqual([
      'fixture_carts.create',
      'fixture_carts.approve',
    ]);
  });

  it('accepts a manifest that declares none — absent is most modules and is not a finding', () => {
    expect(manifest({ id: 'fixture_silent' }).organizationPermissions).toBeUndefined();
  });

  it('spells a code `<module>.<action>` in lower snake case, never the operator `area:action` shape', () => {
    expect(ORGANIZATION_PERMISSION_CODE.test('carts.order_without_approval')).toBe(true);
    expect(ORGANIZATION_PERMISSION_CODE.test('carts:create')).toBe(false);
    expect(ORGANIZATION_PERMISSION_CODE.test('Carts.create')).toBe(false);
    expect(ORGANIZATION_PERMISSION_CODE.test('carts.create.extra')).toBe(false);
    expect(ORGANIZATION_PERMISSION_CODE.test('carts')).toBe(false);
  });

  it('refuses a code that does not match ORGANIZATION_PERMISSION_CODE, naming module and code', () => {
    let message = '';
    try {
      manifest({ id: 'fixture_carts', organizationPermissions: [declaration('fixture_carts:create')] });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('fixture_carts');
    expect(message).toContain('fixture_carts:create');
  });

  it('refuses a code whose prefix is not the manifest id (R-2), naming module and code', () => {
    let message = '';
    try {
      manifest({ id: 'fixture_carts', organizationPermissions: [declaration('orders.view_organization')] });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('fixture_carts');
    expect(message).toContain('orders.view_organization');
  });

  it('refuses a prefix that merely starts with the manifest id', () => {
    expect(() =>
      manifest({ id: 'fixture_carts', organizationPermissions: [declaration('fixture_carts_extra.create')] }),
    ).toThrow(/fixture_carts_extra\.create/);
  });

  it('refuses a duplicate code inside one manifest, naming module and code', () => {
    let message = '';
    try {
      manifest({
        id: 'fixture_carts',
        organizationPermissions: [declaration('fixture_carts.create'), declaration('fixture_carts.create')],
      });
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('fixture_carts');
    expect(message).toContain('fixture_carts.create');
  });

  it('refuses an unknown key on a declaration, and an empty label or description', () => {
    const valid = declaration('carts.create');
    expect(moduleOrganizationPermissionDeclarationSchema.safeParse(valid).success).toBe(true);
    expect(moduleOrganizationPermissionDeclarationSchema.safeParse({ ...valid, requires: [] }).success).toBe(false);
    expect(moduleOrganizationPermissionDeclarationSchema.safeParse({ ...valid, label: '' }).success).toBe(false);
    expect(moduleOrganizationPermissionDeclarationSchema.safeParse({ ...valid, description: '' }).success).toBe(false);
    const { memberDefault: _omitted, ...withoutDefault } = valid;
    expect(moduleOrganizationPermissionDeclarationSchema.safeParse(withoutDefault).success).toBe(false);
  });
});

describe('defineModuleManifest — buyer self-service actions (193 D-300.10, #2027)', () => {
  it('accepts a list of actions and keeps it', () => {
    const m = manifest({ id: 'widgets', buyerSelfServiceActions: ['widget.register'] });
    expect(m.buyerSelfServiceActions).toEqual(['widget.register']);
  });

  it('refuses a malformed action through the schema', () => {
    expect(() => manifest({ id: 'widgets', buyerSelfServiceActions: ['register'] })).toThrow();
  });

  it('refuses one action listed twice, naming the module and the action', () => {
    expect(() => manifest({ id: 'widgets', buyerSelfServiceActions: ['widget.register', 'widget.register'] })).toThrow(/widgets.*widget\.register/);
  });
});

describe('defineModuleManifest — hookable actions (176 T020, FR-010)', () => {
  const declaration = { action: 'widget.create', objectType: 'widget', phases: ['beforeCommit' as const] };

  it('accepts a list of declarations and keeps it', () => {
    const m = manifest({ id: 'widgets', hookableActions: [declaration] });
    expect(m.hookableActions).toEqual([declaration]);
  });

  it('refuses one action declared twice in one manifest, naming the module and the action', () => {
    expect(() => manifest({ id: 'widgets', hookableActions: [declaration, declaration] })).toThrow(
      /widgets.*widget\.create/,
    );
  });

  it('refuses a malformed action through the schema', () => {
    expect(() =>
      manifest({
        id: 'widgets',
        hookableActions: [{ action: 'widget', objectType: 'widget', phases: ['beforeCommit'] }],
      }),
    ).toThrow();
  });
});

describe('DeploymentDivergenceDeclarationSchema — commandHookOrder (176 T020, FR-014, OD-1)', () => {
  it('is optional, so an existing declaration still parses and types', () => {
    expect(DeploymentDivergenceDeclarationSchema.parse({}).commandHookOrder).toBeUndefined();
  });

  it('accepts an order of two or more modules per action', () => {
    const parsed = DeploymentDivergenceDeclarationSchema.parse({
      commandHookOrder: { 'organization.create': ['acme_erp', 'acme_crm'] },
    });
    expect(parsed.commandHookOrder).toEqual({ 'organization.create': ['acme_erp', 'acme_crm'] });
  });

  it('refuses an entry naming one module, which orders nothing', () => {
    expect(() =>
      DeploymentDivergenceDeclarationSchema.parse({ commandHookOrder: { 'organization.create': ['acme_erp'] } }),
    ).toThrow();
  });
});

/**
 * `specs/187-side-table-extensions/contracts/entity-extension-declaration.md`
 * §1 — the `extends` manifest field (FR-001): E1 is the schema, E5 the
 * duplicate-table refusal `defineModuleManifest` can decide from one manifest.
 * E2 – E4 need the whole composition and are the platform's.
 */
describe('defineModuleManifest — entity extensions (187 T004, FR-001, E1, E5)', () => {
  const entry = { entity: 'organizations.Organization', table: 'acme_erp_organization_links' };

  it('accepts a declaration on a host and keeps it', () => {
    const m = manifest({ id: 'acme_erp', dependencies: ['organizations'], extends: [entry] });
    expect(m.extends).toEqual([entry]);
  });

  it('leaves the field absent when nothing is declared — most modules extend nothing', () => {
    expect(manifest({ id: 'acme_erp' }).extends).toBeUndefined();
  });

  it('accepts an underscore-prefixed owner module id', () => {
    expect(EntityExtensionDeclarationSchema.safeParse({ entity: '_lifecycle.Thing', table: 'acme_x' }).success).toBe(
      true,
    );
  });

  it.each([
    ['no class name', 'organizations'],
    ['a lower-case class name', 'organizations.organization'],
    ['an upper-case module id', 'Organizations.Organization'],
    ['two dots', 'organizations.Organization.Extra'],
    ['a table name instead of a class', 'organizations.organizations'],
  ])('refuses an entity reference with %s', (_label, entity) => {
    expect(EntityExtensionDeclarationSchema.safeParse({ entity, table: 'acme_links' }).success).toBe(false);
    expect(() => manifest({ id: 'acme_erp', extends: [{ entity, table: 'acme_links' }] })).toThrow();
  });

  it('refuses an upper-case table, a leading digit and a 64-byte table', () => {
    for (const table of ['Acme_links', '1acme', `a${'b'.repeat(63)}`]) {
      expect(EntityExtensionDeclarationSchema.safeParse({ entity: entry.entity, table }).success, table).toBe(false);
    }
    expect(EntityExtensionDeclarationSchema.safeParse({ entity: entry.entity, table: `a${'b'.repeat(62)}` }).success).toBe(
      true,
    );
  });

  it('refuses an extra key on an entry', () => {
    expect(EntityExtensionDeclarationSchema.safeParse({ ...entry, columns: [] }).success).toBe(false);
    expect(() => manifest({ id: 'acme_erp', extends: [{ ...entry, columns: [] } as never] })).toThrow();
  });

  it('accepts 16 entries and refuses a 17th', () => {
    const entries = (n: number) => Array.from({ length: n }, (_, i) => ({ entity: entry.entity, table: `acme_t${i}` }));
    expect(manifest({ id: 'acme_erp', extends: entries(16) }).extends).toHaveLength(16);
    expect(() => manifest({ id: 'acme_erp', extends: entries(17) })).toThrow();
  });

  it('refuses one table declared twice in one manifest, naming the module, the table and the rule (E5)', () => {
    expect(() =>
      manifest({
        id: 'acme_erp',
        extends: [entry, { entity: 'orders.Order', table: entry.table }],
      }),
    ).toThrow(/acme_erp.*duplicate-table.*acme_erp_organization_links|acme_erp.*acme_erp_organization_links.*duplicate-table/);
  });
});

describe('ModuleOrigin (189 T001, contracts/module-origin.md §1)', () => {
  it('is exactly core, deployment and package', () => {
    expect(MODULE_ORIGINS).toEqual(['core', 'deployment', 'package']);
    expectTypeOf<ModuleOrigin>().toEqualTypeOf<'core' | 'deployment' | 'package'>();
  });
});

describe('defineModuleManifest — command middleware (189 T004, FR-001, FR-003, FR-004)', () => {
  it('accepts a list of declarations and keeps it', () => {
    const declarations = [
      { id: 'legal-hold', phase: 'admit' as const, actions: ['organization.'] },
      { id: 'timing', phase: 'observe' as const, actions: '*' as const },
    ];
    expect(manifest({ id: 'acme_hold', commandMiddleware: declarations }).commandMiddleware).toEqual(declarations);
  });

  it('applies assertCommandMiddlewareRules, naming the module', () => {
    expect(() =>
      manifest({
        id: 'acme_hold',
        commandMiddleware: [
          { id: 'hold', phase: 'admit', actions: '*' },
          { id: 'hold', phase: 'admit', actions: '*' },
        ],
      }),
    ).toThrow(/acme_hold/);
    expect(() =>
      manifest({ id: 'acme_hold', commandMiddleware: [{ id: 'hold', phase: 'admit', actions: '*', timeoutMs: 501 }] }),
    ).toThrow(/acme_hold/);
  });

  it('refuses a malformed declaration through the schema', () => {
    expect(() =>
      manifest({
        id: 'acme_hold',
        commandMiddleware: [{ id: 'hold', phase: 'transform', actions: '*' } as never],
      }),
    ).toThrow();
  });

  it('refuses an authored `origin` key, pointing to the module-origin contract', () => {
    expect(() => manifest({ id: 'acme_hold', origin: 'core' } as never)).toThrow(
      /acme_hold.*origin.*module-origin\.md/,
    );
  });
});

describe('DeploymentDivergenceDeclarationSchema — commandMiddlewareOrder (189 T005, FR-031)', () => {
  it('is optional, so an existing declaration still parses and types', () => {
    expect(DeploymentDivergenceDeclarationSchema.parse({}).commandMiddlewareOrder).toBeUndefined();
  });

  it('accepts two or more module ids, first runs first', () => {
    expect(
      DeploymentDivergenceDeclarationSchema.parse({ commandMiddlewareOrder: ['acme_hold', 'acme_rate'] })
        .commandMiddlewareOrder,
    ).toEqual(['acme_hold', 'acme_rate']);
  });

  it('refuses a list of one module and a malformed id', () => {
    expect(() => DeploymentDivergenceDeclarationSchema.parse({ commandMiddlewareOrder: ['acme_hold'] })).toThrow();
    expect(() =>
      DeploymentDivergenceDeclarationSchema.parse({ commandMiddlewareOrder: ['acme_hold', 'Acme-Rate'] }),
    ).toThrow();
  });
});

describe('DivergenceDetail — command-middleware (189 T005, FR-034)', () => {
  it('carries the phase, id and filter', () => {
    const detail: DivergenceDetail = { kind: 'command-middleware', phase: 'observe', id: 'timing', actions: '*' };
    const kind: DivergenceKind = detail.kind;
    expect(kind).toBe('command-middleware');
  });
});

/**
 * The guard seams (189 T068, FR-055, `contracts/guard-seam-narrowing.md` §1 and §2).
 *
 * The list is pinned to its exact content on purpose. Adding, removing or renaming a guard seam is
 * not a refactor: it is a ruling that amends D-296 (D-296.5 as amended narrows D-156.4 to these four
 * names and no others), so this test fails until whoever changes the list changes it too, citing the
 * ruling. `backend/test/contract/kernel/harness-parity.test.ts` holds the other side: both
 * composition roots register every name here as root-supplied.
 */
describe('GUARD_SEAM_REGISTRATIONS (189 T068, FR-055)', () => {
  it('is exactly the four guard seams D-296 names', () => {
    expect(GUARD_SEAM_REGISTRATIONS).toEqual(['commandBus', 'auditLogService', 'eventBus', 'emFactory']);
    expectTypeOf<GuardSeamRegistration>().toEqualTypeOf<
      'commandBus' | 'auditLogService' | 'eventBus' | 'emFactory'
    >();
  });

  it('tells a guard seam from other root plumbing', () => {
    for (const name of GUARD_SEAM_REGISTRATIONS) expect(isGuardSeamRegistration(name)).toBe(true);
    expect(isGuardSeamRegistration('redis')).toBe(false);
    expect(isGuardSeamRegistration('orm')).toBe(false);
    expect(isGuardSeamRegistration('requireAdmin')).toBe(false);
  });

  it('names a non-empty replacement for each of the four', () => {
    for (const name of GUARD_SEAM_REGISTRATIONS) {
      expect(guardSeamReplacementFor(name).trim()).not.toBe('');
    }
    // Total over the four names, and typed so that it takes nothing else.
    expectTypeOf(guardSeamReplacementFor).parameter(0).toEqualTypeOf<GuardSeamRegistration>();
  });
});

/**
 * `specs/193-admin-form-extensions/` T014 — the four manifest fields
 * (`contracts/form-field-declaration.md` §2, `field-overrides.md` §1,
 * `input-controls.md` §1), the deployment's `formOverrideGrants`
 * (`field-overrides.md` §4) and the two divergence kinds (§5, FR-070). Every
 * field is optional, so a manifest that declares none of them is unchanged.
 */
describe('defineModuleManifest — admin form extensions (193 T014)', () => {
  const fieldSet = {
    id: 'widget',
    ownerModuleId: 'widgets',
    fields: [{ key: 'name', type: 'string' as const, required: true, accepts: ['label' as const] }],
  };
  const form = {
    id: 'widget.edit',
    fieldSet: 'widget',
    mode: 'edit' as const,
    sections: [{ key: 'main', keys: ['name'] }],
  };
  const override = { target: 'widget.name', labelKey: 'forms.name.label', reason: 'Our customers call it a title.' };
  const control = { id: 'widgets.code', outputType: 'string' as const, format: 'widgets.code' };

  it('leaves all four fields absent when nothing is declared', () => {
    const m = manifest({ id: 'widgets' });
    expect(m.fieldSets).toBeUndefined();
    expect(m.adminForms).toBeUndefined();
    expect(m.formOverrides).toBeUndefined();
    expect(m.inputControls).toBeUndefined();
  });

  it('accepts and keeps each field', () => {
    const m = manifest({ id: 'widgets', fieldSets: [fieldSet], adminForms: [form], inputControls: [control] });
    expect(m.fieldSets).toEqual([fieldSet]);
    expect(m.adminForms).toEqual([form]);
    expect(m.inputControls).toEqual([control]);
    expect(manifest({ id: 'acme', dependencies: ['widgets'], formOverrides: [override] }).formOverrides).toEqual([override]);
  });

  it('refuses a field set owned by another module, naming both', () => {
    expect(() => manifest({ id: 'acme', fieldSets: [fieldSet] })).toThrow(/acme.*widget.*widgets/);
  });

  it('refuses one field set or one form declared twice in one manifest', () => {
    expect(() => manifest({ id: 'widgets', fieldSets: [fieldSet, fieldSet] })).toThrow(/widgets.*duplicate-field-set.*widget/);
    expect(() => manifest({ id: 'widgets', adminForms: [form, form] })).toThrow(/widgets.*duplicate-form.*widget\.edit/);
  });

  it('accepts a form over another module\'s field set (FR-083)', () => {
    const m = manifest({ id: 'widget_screens', dependencies: ['widgets'], adminForms: [form] });
    expect(m.adminForms).toEqual([form]);
  });

  it('refuses an input control outside the declaring module\'s namespace, and one declared twice', () => {
    expect(() => manifest({ id: 'acme', inputControls: [control] })).toThrow(/acme.*widgets\.code/);
    expect(() => manifest({ id: 'widgets', inputControls: [{ id: 'platform.text', outputType: 'string' }] })).toThrow(/widgets.*platform\.text/);
    expect(() => manifest({ id: 'widgets', inputControls: [control, control] })).toThrow(/widgets.*widgets\.code.*twice/);
  });

  it('refuses malformed declarations through the schemas', () => {
    expect(() => manifest({ id: 'widgets', fieldSets: [{ ...fieldSet, fields: [] }] })).toThrow();
    expect(() => manifest({ id: 'widgets', adminForms: [{ ...form, mode: 'view' } as never] })).toThrow();
    expect(() => manifest({ id: 'acme', formOverrides: [{ target: 'widget.name', reason: 'x' } as never] })).toThrow();
    expect(() => manifest({ id: 'widgets', inputControls: [{ id: 'code', outputType: 'string' }] })).toThrow();
  });

  it('caps formOverrides at 200', () => {
    const overrides = (n: number) => Array.from({ length: n }, () => override);
    expect(manifest({ id: 'acme', formOverrides: overrides(200) }).formOverrides).toHaveLength(200);
    expect(() => manifest({ id: 'acme', formOverrides: overrides(201) })).toThrow();
  });
});

describe('DeploymentDivergenceDeclarationSchema — formOverrideGrants (193 T014, field-overrides.md §4)', () => {
  const grant = { moduleId: 'acme_forms', packageName: '@acme/forms', reason: 'Vendor-supplied labels for our tax forms.' };

  it('is optional, so an existing declaration still parses and types', () => {
    expect(DeploymentDivergenceDeclarationSchema.parse({}).formOverrideGrants).toBeUndefined();
  });

  it('accepts grants per field set', () => {
    expect(DeploymentDivergenceDeclarationSchema.parse({ formOverrideGrants: { organization: [grant] } }).formOverrideGrants).toEqual({
      organization: [grant],
    });
  });

  it.each([
    ['an empty grant list', { organization: [] }],
    ['a grant without a reason', { organization: [{ moduleId: 'acme_forms', packageName: '@acme/forms' }] }],
    ['an empty reason', { organization: [{ ...grant, reason: '' }] }],
    ['a malformed module id', { organization: [{ ...grant, moduleId: 'Acme' }] }],
    ['an empty package name', { organization: [{ ...grant, packageName: '' }] }],
  ])('refuses %s', (_name, formOverrideGrants) => {
    expect(() => DeploymentDivergenceDeclarationSchema.parse({ formOverrideGrants })).toThrow();
  });
});
