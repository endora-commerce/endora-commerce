import { describe, expect, it } from 'vitest';
import { defineModuleManifest, type ModuleManifest } from '@endora-commerce/contracts';
import { hookableActionsFrom, moduleDependencyClosureFrom } from './command-hook-inputs.js';

/**
 * `specs/176-command-hooks-outbox/` T034 (FR-012, FR-013): the two facts the
 * composer seals the command-hook registry against, derived by a root from the
 * manifests it resolved — the composer itself never reads one.
 */

function manifest(id: string, extra: Partial<ModuleManifest> = {}): ModuleManifest {
  return defineModuleManifest({ id, name: id, version: '1.0.0', dependencies: [], ...extra } as ModuleManifest);
}

describe('hookableActionsFrom (176 T034)', () => {
  it("lists every manifest's declarations with the module that owns them", () => {
    const manifests = [
      manifest('widgets', {
        hookableActions: [{ action: 'widget.create', objectType: 'widget', phases: ['beforeCommit'] }],
      }),
      manifest('notes'),
      manifest('gadgets', {
        hookableActions: [{ action: 'gadget.create', objectType: 'gadget', phases: ['beforeCommit', 'afterCommit'] }],
      }),
    ];
    expect(hookableActionsFrom(manifests)).toEqual([
      { moduleId: 'widgets', action: 'widget.create', objectType: 'widget', phases: ['beforeCommit'] },
      { moduleId: 'gadgets', action: 'gadget.create', objectType: 'gadget', phases: ['beforeCommit', 'afterCommit'] },
    ]);
  });
});

describe('moduleDependencyClosureFrom (176 T034)', () => {
  it('closes each module over its dependencies, transitively and sorted', () => {
    const manifests = [
      manifest('auth'),
      manifest('organizations', { dependencies: ['auth'] }),
      manifest('acme_erp', { dependencies: ['organizations'] }),
      manifest('acme_crm', { dependencies: ['acme_erp', 'auth'] }),
    ];
    expect(moduleDependencyClosureFrom(manifests)).toEqual({
      auth: [],
      organizations: ['auth'],
      acme_erp: ['auth', 'organizations'],
      acme_crm: ['acme_erp', 'auth', 'organizations'],
    });
  });

  it('follows an edge to a module the composition does not ship, and terminates on a cycle', () => {
    const manifests = [
      manifest('a_mod', { dependencies: ['b_mod', 'missing'] }),
      manifest('b_mod', { dependencies: ['a_mod'] }),
    ];
    expect(moduleDependencyClosureFrom(manifests)).toEqual({
      a_mod: ['b_mod', 'missing'],
      b_mod: ['a_mod', 'missing'],
    });
  });
});
