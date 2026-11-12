import { describe, expect, it } from 'vitest';
import { hookableAction } from '@endora-commerce/contracts';
import {
  CommandHookOrderContradictionError,
  DuplicateCommandHookError,
  DuplicateHookableActionError,
  HookOwnerNotDependedOnError,
  HookPhaseNotOfferedError,
  UndeclaredHookableActionError,
  UnorderedCommandHooksError,
} from './errors.js';
import { CommandHookRegistry, type CommandHookCompositionInput } from './registry.js';

/**
 * `specs/176-command-hooks-outbox/` T022 (FR-012): one test per composition
 * refusal. Each one is thrown while the registry is sealed — after the last
 * module registered, before any boot hook — and each message names the
 * modules, the hook id and the action, because an operator reading a refused
 * boot has a deployment of sixty modules and nothing else to go on.
 */

const CREATE = hookableAction<{ id: string }>('widget.create', 'widget', ['beforeCommit', 'afterCommit']);
const ARCHIVE = hookableAction<{ id: string }>('widget.archive', 'widget', ['afterCommit']);

function input(overrides: Partial<CommandHookCompositionInput> = {}): CommandHookCompositionInput {
  return {
    hookableActions: [
      { moduleId: 'widgets', action: 'widget.create', objectType: 'widget', phases: ['beforeCommit', 'afterCommit'] },
      { moduleId: 'widgets', action: 'widget.archive', objectType: 'widget', phases: ['afterCommit'] },
    ],
    moduleDependencies: { widgets: [], acme_a: ['widgets'], acme_b: ['widgets'], acme_c: ['acme_a', 'widgets'] },
    commandHookOrder: {},
    ...overrides,
  };
}

function refusal(run: () => void): Error {
  try {
    run();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected a refusal, and composition succeeded');
}

const noop = (): void => undefined;

describe('CommandHookRegistry — composition refusals (176 T022)', () => {
  it('refuses a hook on an action no composed module declares', () => {
    const registry = new CommandHookRegistry();
    const undeclared = hookableAction<unknown>('gadget.create', 'gadget', ['beforeCommit']);
    registry.register('acme_a', [{ id: 'check-gadget', on: undeclared, phase: 'beforeCommit', handler: noop }]);
    const err = refusal(() => registry.seal(input()));
    expect(err).toBeInstanceOf(UndeclaredHookableActionError);
    expect(err.message).toContain('acme_a');
    expect(err.message).toContain('check-gadget');
    expect(err.message).toContain('gadget.create');
  });

  it('refuses a hook for a phase the owner does not offer', () => {
    const registry = new CommandHookRegistry();
    registry.register('acme_a', [{ id: 'veto-archive', on: ARCHIVE, phase: 'beforeCommit', handler: noop }]);
    const err = refusal(() => registry.seal(input()));
    expect(err).toBeInstanceOf(HookPhaseNotOfferedError);
    expect(err.message).toContain('acme_a');
    expect(err.message).toContain('veto-archive');
    expect(err.message).toContain('widget.archive');
    expect(err.message).toContain('widgets');
    expect(err.message).toContain('beforeCommit');
  });

  it('refuses one action declared hookable by two modules', () => {
    const registry = new CommandHookRegistry();
    registry.register('acme_a', [{ id: 'check', on: CREATE, phase: 'beforeCommit', handler: noop }]);
    const err = refusal(() =>
      registry.seal(
        input({
          hookableActions: [
            { moduleId: 'widgets', action: 'widget.create', objectType: 'widget', phases: ['beforeCommit'] },
            { moduleId: 'gadgets', action: 'widget.create', objectType: 'widget', phases: ['beforeCommit'] },
          ],
        }),
      ),
    );
    expect(err).toBeInstanceOf(DuplicateHookableActionError);
    expect(err.message).toContain('widgets');
    expect(err.message).toContain('gadgets');
    expect(err.message).toContain('widget.create');
    expect(err.message).toContain('acme_a#check');
  });

  it('refuses a duplicate (module, id) at the registration that repeats it', () => {
    const registry = new CommandHookRegistry();
    registry.register('acme_a', [{ id: 'check', on: CREATE, phase: 'beforeCommit', handler: noop }]);
    const err = refusal(() =>
      registry.register('acme_a', [{ id: 'check', on: CREATE, phase: 'beforeCommit', handler: noop }]),
    );
    expect(err).toBeInstanceOf(DuplicateCommandHookError);
    expect(err.message).toContain('acme_a');
    expect(err.message).toContain('check');
    expect(err.message).toContain('widget.create');
  });

  it('refuses a hook module whose dependencies do not reach the owner', () => {
    const registry = new CommandHookRegistry();
    registry.register('acme_lone', [{ id: 'check', on: CREATE, phase: 'beforeCommit', handler: noop }]);
    const err = refusal(() =>
      registry.seal(input({ moduleDependencies: { widgets: [], acme_lone: ['auth'] } })),
    );
    expect(err).toBeInstanceOf(HookOwnerNotDependedOnError);
    expect(err.message).toContain('acme_lone');
    expect(err.message).toContain('check');
    expect(err.message).toContain('widget.create');
    expect(err.message).toContain('widgets');
  });

  it('refuses two hook modules on one action and phase that nothing orders', () => {
    const registry = new CommandHookRegistry();
    registry.register('acme_a', [{ id: 'first', on: CREATE, phase: 'beforeCommit', handler: noop }]);
    registry.register('acme_b', [{ id: 'second', on: CREATE, phase: 'beforeCommit', handler: noop }]);
    const err = refusal(() => registry.seal(input()));
    expect(err).toBeInstanceOf(UnorderedCommandHooksError);
    for (const fact of ['acme_a', 'acme_b', 'first', 'second', 'widget.create']) {
      expect(err.message).toContain(fact);
    }
  });

  it('accepts the same pair once the deployment orders it', () => {
    const registry = new CommandHookRegistry();
    registry.register('acme_a', [{ id: 'first', on: CREATE, phase: 'beforeCommit', handler: noop }]);
    registry.register('acme_b', [{ id: 'second', on: CREATE, phase: 'beforeCommit', handler: noop }]);
    registry.seal(input({ commandHookOrder: { 'widget.create': ['acme_b', 'acme_a'] } }));
    expect(registry.beforeCommit('widget.create').map((hook) => hook.moduleId)).toEqual(['acme_b', 'acme_a']);
  });

  it('refuses a deployment order that contradicts the dependency graph', () => {
    const registry = new CommandHookRegistry();
    registry.register('acme_a', [{ id: 'first', on: CREATE, phase: 'beforeCommit', handler: noop }]);
    registry.register('acme_c', [{ id: 'later', on: CREATE, phase: 'beforeCommit', handler: noop }]);
    const err = refusal(() => registry.seal(input({ commandHookOrder: { 'widget.create': ['acme_c', 'acme_a'] } })));
    expect(err).toBeInstanceOf(CommandHookOrderContradictionError);
    for (const fact of ['acme_a', 'acme_c', 'widget.create']) expect(err.message).toContain(fact);
  });
});

describe('CommandHookRegistry — what it serves once sealed', () => {
  it('refuses a registration after sealing', () => {
    const registry = new CommandHookRegistry();
    registry.seal(input());
    expect(() =>
      registry.register('acme_a', [{ id: 'late', on: CREATE, phase: 'beforeCommit', handler: noop }]),
    ).toThrow(/sealed[\s\S]*acme_a[\s\S]*late/);
  });

  it('accepts an afterCommit handler and serves it by action and by (module, id) (176 P3)', () => {
    const registry = new CommandHookRegistry();
    const notify = async (): Promise<void> => undefined;
    registry.register('acme_a', [{ id: 'notify', on: CREATE, phase: 'afterCommit', handler: notify }]);
    registry.seal(input());
    expect(registry.afterCommit('widget.create').map((hook) => [hook.moduleId, hook.id])).toEqual([['acme_a', 'notify']]);
    expect(registry.afterCommitHandler('acme_a', 'notify')).toMatchObject({ action: 'widget.create', handler: notify });
    expect(registry.afterCommitHandler('acme_a', 'gone')).toBeUndefined();
    // A beforeCommit hook is not a handler the drain may deliver to.
    expect(registry.beforeCommit('widget.create')).toEqual([]);
    expect(registry.claimants('widget.create')).toEqual(new Set(['acme_a']));
  });

  it('does not ask two unrelated modules to order their afterCommit handlers: rows are delivered unordered', () => {
    const registry = new CommandHookRegistry();
    registry.register('acme_b', [{ id: 'notify-b', on: CREATE, phase: 'afterCommit', handler: async () => undefined }]);
    registry.register('acme_a', [{ id: 'notify-a', on: CREATE, phase: 'afterCommit', handler: async () => undefined }]);
    registry.seal(input());
    // Deterministic, by module id then registration order — and refused by nothing.
    expect(registry.afterCommit('widget.create').map((hook) => hook.id)).toEqual(['notify-a', 'notify-b']);
  });

  it('still refuses an afterCommit handler on an action that does not offer the phase', () => {
    const registry = new CommandHookRegistry();
    const NOTE = hookableAction<{ id: string }>('widget.note', 'widget', ['beforeCommit']);
    registry.register('acme_a', [{ id: 'notify', on: NOTE, phase: 'afterCommit', handler: async () => undefined }]);
    const err = refusal(() =>
      registry.seal(
        input({
          hookableActions: [
            ...input().hookableActions,
            { moduleId: 'widgets', action: 'widget.note', objectType: 'widget', phases: ['beforeCommit'] },
          ],
        }),
      ),
    );
    expect(err).toBeInstanceOf(HookPhaseNotOfferedError);
    expect(err.message).toContain('afterCommit');
  });

  it('answers the owner of a declared action, and nothing for another', () => {
    const registry = new CommandHookRegistry();
    registry.seal(input());
    expect(registry.declaration('widget.create')).toMatchObject({ moduleId: 'widgets' });
    expect(registry.declaration('gadget.create')).toBeUndefined();
  });

  it('lists the plan with beforeCommit positions, unpositioned afterCommit handlers and live presence', () => {
    const present = new Set(['acme_a']);
    const registry = new CommandHookRegistry({ isPresent: (moduleId) => present.has(moduleId) });
    // acme_c registers its handler first: afterCommit handlers are listed by
    // module id, then registration order, and carry no position — the outbox
    // promises no order across rows (176 P4 architect ruling).
    registry.register('acme_c', [{ id: 'audit-archive', on: ARCHIVE, phase: 'afterCommit', handler: async () => undefined }]);
    registry.register('acme_a', [
      { id: 'first', on: CREATE, phase: 'beforeCommit', handler: noop },
      { id: 'second', on: CREATE, phase: 'beforeCommit', handler: noop },
    ]);
    registry.register('acme_c', [{ id: 'third', on: CREATE, phase: 'beforeCommit', handler: noop }]);
    registry.register('acme_a', [{ id: 'notify-erp', on: ARCHIVE, phase: 'afterCommit', handler: async () => undefined }]);
    registry.seal(input());
    expect(registry.plan()).toEqual({
      actions: [
        { action: 'widget.archive', objectType: 'widget', owner: 'widgets', phases: ['afterCommit'] },
        { action: 'widget.create', objectType: 'widget', owner: 'widgets', phases: ['beforeCommit', 'afterCommit'] },
      ],
      items: [
        { action: 'widget.archive', phase: 'afterCommit', position: null, module: 'acme_a', id: 'notify-erp', moduleEnabled: true },
        { action: 'widget.archive', phase: 'afterCommit', position: null, module: 'acme_c', id: 'audit-archive', moduleEnabled: false },
        { action: 'widget.create', phase: 'beforeCommit', position: 1, module: 'acme_a', id: 'first', moduleEnabled: true },
        { action: 'widget.create', phase: 'beforeCommit', position: 2, module: 'acme_a', id: 'second', moduleEnabled: true },
        { action: 'widget.create', phase: 'beforeCommit', position: 3, module: 'acme_c', id: 'third', moduleEnabled: false },
      ],
    });
  });
});
