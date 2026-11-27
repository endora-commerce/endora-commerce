import { describe, expect, it } from 'vitest';
import { PRESENTATION_OVERRIDES, defineFieldSet, hookableAction, type FieldOverride } from '@endora-commerce/contracts';
import { CommandHookRegistry } from '../commands/hooks/registry.js';
import { EventBus } from '../events/index.js';
import { composeModules, type ModuleEntry } from './compose.js';
import { createRootContainer } from './container.js';
import { FormCompositionError } from './forms/errors.js';
import { FormRegistry } from './forms/registry.js';
import type { FormDeclarationsInput } from './forms/seal.js';

/**
 * `specs/193-admin-form-extensions/` T025 (FR-021, FR-041): `composeModules`
 * hands every module context the form registry, seals it after the
 * command-hook registry — with the origin map and the installed package
 * names, which only the composer has — and attaches it to the hook registry
 * as the field-rule check source. A refusal stops the composition before any
 * boot hook runs.
 */

const quiet = { info: () => {}, warn: () => {}, error: () => {} };

const SET = defineFieldSet({
  id: 'widget',
  ownerModuleId: 'widgets',
  fields: [{ key: 'code', type: 'string', required: false, bounds: { maxLength: 32 }, accepts: [...PRESENTATION_OVERRIDES, 'validation'] }],
});
const UPDATE = hookableAction<{ code: string }>('widget.update', 'widget', ['beforeCommit']);

function declarations(overrides: FieldOverride[] = [], moduleId = 'acme'): FormDeclarationsInput {
  return {
    fieldSets: [{ moduleId: 'widgets', set: SET }],
    adminForms: [],
    formOverrides: overrides.map((override) => ({ moduleId, override })),
    inputControls: [],
    hookableActions: [{ moduleId: 'widgets', action: 'widget.update', objectType: 'widget', phases: ['beforeCommit'] }],
    moduleDependencies: { widgets: [], acme: ['widgets'], vendor: ['widgets'] },
    permissionCodes: [],
  };
}

const owner: ModuleEntry = {
  id: 'widgets',
  version: '1.0.0',
  registerModule: (ctx) =>
    ctx.fieldSets([{ set: SET, writers: [{ on: UPDATE, mode: 'update', writes: ['code'], project: (data) => ({ after: data as Record<string, unknown>, changed: ['code'] }) }] }]),
};

function compose(entries: readonly ModuleEntry[], forms: FormDeclarationsInput) {
  const commandHookRegistry = new CommandHookRegistry();
  const formRegistry = new FormRegistry();
  const composed = composeModules(entries, {
    container: createRootContainer(),
    eventBus: new EventBus(),
    log: quiet,
    commandHookRegistry,
    commandHooks: { hookableActions: forms.hookableActions, moduleDependencies: forms.moduleDependencies },
    formRegistry,
    forms,
  });
  return { composed, commandHookRegistry, formRegistry };
}

describe('composeModules — the form registry (193 T025)', () => {
  it('seals it, and attaches it to the hook registry as the field-rule check source', () => {
    const { commandHookRegistry, formRegistry } = compose(
      [owner, { id: 'acme', version: '1.0.0', overlay: true, registerModule: () => undefined }],
      declarations([{ target: 'widget.code', validation: { maxLength: 4 }, reason: 'Short codes.' }]),
    );
    expect(formRegistry.isSealed).toBe(true);
    expect(commandHookRegistry.fieldRuleCheck('widget.update')).toBeDefined();
    expect(commandHookRegistry.fieldRuleCheck('widget.create')).toBeUndefined();
  });

  it('hands it the origins it derives: an installed package overriding without a grant is refused', () => {
    expect(() =>
      compose(
        [owner, { id: 'vendor', version: '1.0.0', installedPackage: true, installedPackageName: '@vendor/pkg', registerModule: () => undefined }],
        declarations([{ target: 'widget.code', labelKey: 'a.b', reason: 'Vendor label.' }], 'vendor'),
      ),
    ).toThrow(/package-form-override-not-granted/);
  });

  it('refuses before the boot phase', async () => {
    let booted = false;
    let error: unknown;
    try {
      const { composed } = compose(
        [{ ...owner, registerModule: (ctx) => (owner.registerModule(ctx), ctx.onBoot(() => void (booted = true))) }, { id: 'acme', version: '1.0.0', overlay: true, registerModule: () => undefined }],
        declarations([{ target: 'widget.code', validation: { maxLength: 64 }, reason: 'Longer codes.' }]),
      );
      await composed.runBootHooks();
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(FormCompositionError);
    expect(booted).toBe(false);
  });

  it('a context built after composition refuses a registration', () => {
    const { composed } = compose([owner], declarations());
    expect(() => composed.contextFor('widgets').fieldFormats([{ id: 'widgets.code', validate: () => true }])).toThrow(/sealed/);
  });
});
