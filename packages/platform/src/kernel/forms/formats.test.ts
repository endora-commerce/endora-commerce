import { describe, expect, it } from 'vitest';
import { FIELD_FORMATS } from '@endora-commerce/contracts';
import { FIELD_FORMAT_VECTORS } from '@endora-commerce/contracts/admin-forms.vectors';
import { EventBus } from '../../events/bus.js';
import { createRootContainer } from '../container.js';
import { createModuleContext, createModuleRegistrationSink } from '../module-context.js';
import { FormCompositionError } from './errors.js';
import { PLATFORM_FORMAT_VALIDATORS, formatValidator } from './formats.js';
import { FormRegistry } from './registry.js';

/**
 * `specs/193-admin-form-extensions/` T023 (FR-033, `contracts/input-controls.md`
 * §1): the platform formats' server validators, held to the vector table the
 * admin-kit's client twins read too; module formats registered through
 * `ctx.fieldFormats`; a format nobody validates refused at composition (the
 * `format-without-validator` cases are in `seal.test.ts`).
 */

const silentLog = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined } as never;

describe('platform format validators (193 T023, SC-002)', () => {
  it('validates every platform format, and nothing else', () => {
    expect(Object.keys(PLATFORM_FORMAT_VALIDATORS).sort()).toEqual([...FIELD_FORMATS].sort());
  });

  for (const format of FIELD_FORMATS) {
    it(`${format}: accepts and refuses the shared vectors`, () => {
      const validate = PLATFORM_FORMAT_VALIDATORS[format];
      for (const value of FIELD_FORMAT_VECTORS[format].accept) expect(validate(value), `accept ${JSON.stringify(value)}`).toBe(true);
      for (const value of FIELD_FORMAT_VECTORS[format].refuse) expect(validate(value), `refuse ${JSON.stringify(value)}`).toBe(false);
    });
  }

  it('answers false for a format nobody validates (fail closed)', () => {
    expect(formatValidator(new Map())('acme.nip', '1234567890')).toBe(false);
  });
});

describe('ctx.fieldFormats (193 T023, input-controls.md §1)', () => {
  function context(moduleId: string, registry: FormRegistry | undefined) {
    return createModuleContext({
      module: { id: moduleId, version: '1.0.0' },
      container: createRootContainer(),
      eventBus: new EventBus(),
      sink: createModuleRegistrationSink(),
      log: silentLog,
      ...(registry ? { formRegistry: registry } : {}),
    });
  }

  it('registers a module format, which the sealed registry then validates', () => {
    const registry = new FormRegistry();
    context('acme', registry).fieldFormats([{ id: 'acme.nip', validate: (value) => /^\d{10}$/.test(value) }]);
    registry.seal({
      fieldSets: [],
      adminForms: [],
      formOverrides: [],
      inputControls: [],
      hookableActions: [],
      moduleDependencies: {},
      permissionCodes: [],
      origins: { acme: 'deployment' },
      installedPackageNames: {},
    });
    expect(registry.validateFormat('acme.nip', '1234567890')).toBe(true);
    expect(registry.validateFormat('acme.nip', '123')).toBe(false);
    expect(registry.validateFormat('email', 'anna@example.com')).toBe(true);
  });

  it('refuses a format outside the module’s namespace at the seal', () => {
    const registry = new FormRegistry();
    context('acme', registry).fieldFormats([{ id: 'other.nip', validate: () => true }]);
    expect(() =>
      registry.seal({
        fieldSets: [],
        adminForms: [],
        formOverrides: [],
        inputControls: [],
        hookableActions: [],
        moduleDependencies: {},
        permissionCodes: [],
        origins: { acme: 'deployment' },
        installedPackageNames: {},
      }),
    ).toThrow(FormCompositionError);
  });

  it('refuses a registration after the seal, and one with no registry mounted', () => {
    const registry = new FormRegistry();
    registry.seal({
      fieldSets: [],
      adminForms: [],
      formOverrides: [],
      inputControls: [],
      hookableActions: [],
      moduleDependencies: {},
      permissionCodes: [],
      origins: {},
      installedPackageNames: {},
    });
    expect(() => context('acme', registry).fieldFormats([{ id: 'acme.nip', validate: () => true }])).toThrow(/sealed/);
    expect(() => context('acme', undefined).fieldFormats([{ id: 'acme.nip', validate: () => true }])).toThrow(/no form registry/);
  });
});
