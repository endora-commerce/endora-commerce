import { describe, expect, expectTypeOf, it } from 'vitest';
import { hookableAction } from '@endora-commerce/contracts';
import { CommandHookRegistry } from '../commands/hooks/registry.js';
import { EventBus } from '../events/index.js';
import { composeModules } from './compose.js';
import { createRootContainer } from './container.js';
import { createModuleContext, createModuleRegistrationSink } from './module-context.js';

/**
 * `specs/176-command-hooks-outbox/` T024 (FR-011): `ctx.commandHooks` stamps
 * the registering module's id, refuses once composition is sealed, and
 * resolves nothing — a hook is a declaration, run later by the bus.
 */

const log = { info: () => {}, warn: () => {}, error: () => {} };
const WIDGET_CREATE = hookableAction<{ id: string }>('widget.create', 'widget', ['beforeCommit']);
const DECLARED = {
  hookableActions: [{ moduleId: 'widgets', action: 'widget.create', objectType: 'widget', phases: ['beforeCommit' as const] }],
  moduleDependencies: { widgets: [], acme_erp: ['widgets'] },
  commandHookOrder: {},
};

describe('ModuleContext.commandHooks (176 T024)', () => {
  it("stamps the registering module's id, never one the entry names", () => {
    const registry = new CommandHookRegistry();
    const ctx = createModuleContext({
      module: { id: 'acme_erp', version: '1.0.0' },
      container: createRootContainer(),
      eventBus: new EventBus(),
      sink: createModuleRegistrationSink(),
      log,
      commandHookRegistry: registry,
    });
    ctx.commandHooks([
      // A module cannot answer for itself: an extra `moduleId` is ignored.
      { id: 'check', on: WIDGET_CREATE, phase: 'beforeCommit', handler: () => undefined, moduleId: 'widgets' } as never,
    ]);
    registry.seal(DECLARED);
    expect(registry.beforeCommit('widget.create').map((hook) => `${hook.moduleId}#${hook.id}`)).toEqual([
      'acme_erp#check',
    ]);
  });

  it('refuses a registration once composition has sealed the registry', () => {
    const registry = new CommandHookRegistry();
    const container = createRootContainer();
    const composed = composeModules(
      [
        { id: 'widgets', version: '1.0.0', registerModule: () => undefined },
        { id: 'acme_erp', version: '1.0.0', registerModule: () => undefined },
      ],
      { container, eventBus: new EventBus(), log, commandHookRegistry: registry, commandHooks: DECLARED },
    );
    expect(registry.isSealed).toBe(true);
    const late = composed.contextFor('acme_erp');
    expect(() =>
      late.commandHooks([{ id: 'late', on: WIDGET_CREATE, phase: 'beforeCommit', handler: () => undefined }]),
    ).toThrow(/sealed/);
  });

  it('resolves nothing while registering: the handler and the cradle are untouched', () => {
    const registry = new CommandHookRegistry();
    let handlerCalls = 0;
    composeModules(
      [
        { id: 'widgets', version: '1.0.0', registerModule: () => undefined },
        {
          id: 'acme_erp',
          version: '1.0.0',
          registerModule: (ctx) => {
            ctx.commandHooks([
              {
                id: 'check',
                on: WIDGET_CREATE,
                phase: 'beforeCommit',
                handler: () => {
                  handlerCalls += 1;
                },
              },
            ]);
          },
        },
      ],
      { container: createRootContainer(), eventBus: new EventBus(), log, commandHookRegistry: registry, commandHooks: DECLARED },
    );
    expect(handlerCalls).toBe(0);
    expect(registry.beforeCommit('widget.create')).toHaveLength(1);
  });

  it('fails composition, naming the module, when the registry refuses at sealing', () => {
    expect(() =>
      composeModules(
        [
          {
            id: 'acme_lone',
            version: '1.0.0',
            registerModule: (ctx) =>
              ctx.commandHooks([{ id: 'check', on: WIDGET_CREATE, phase: 'beforeCommit', handler: () => undefined }]),
          },
        ],
        {
          container: createRootContainer(),
          eventBus: new EventBus(),
          log,
          commandHookRegistry: new CommandHookRegistry(),
          commandHooks: { ...DECLARED, moduleDependencies: { widgets: [], acme_lone: [] } },
        },
      ),
    ).toThrow(/acme_lone[\s\S]*check[\s\S]*widget\.create/);
  });

  it("types each entry's data by its own ref", () => {
    const NOTE_CREATE = hookableAction<{ noteId: number }>('note.create', 'note', ['beforeCommit']);
    const registry = new CommandHookRegistry();
    const ctx = createModuleContext({
      module: { id: 'acme_erp', version: '1.0.0' },
      container: createRootContainer(),
      eventBus: new EventBus(),
      sink: createModuleRegistrationSink(),
      log,
      commandHookRegistry: registry,
    });
    ctx.commandHooks([
      {
        id: 'widget',
        on: WIDGET_CREATE,
        phase: 'beforeCommit',
        handler: ({ data }) => {
          expectTypeOf(data).toEqualTypeOf<{ id: string }>();
        },
      },
      {
        id: 'note',
        on: NOTE_CREATE,
        phase: 'beforeCommit',
        handler: ({ data }) => {
          expectTypeOf(data).toEqualTypeOf<{ noteId: number }>();
        },
      },
    ]);
    expect(registry.isSealed).toBe(false);
  });

  it('refuses outright in a composition that mounts no registry', () => {
    const ctx = createModuleContext({
      module: { id: 'acme_erp', version: '1.0.0' },
      container: createRootContainer(),
      eventBus: new EventBus(),
      sink: createModuleRegistrationSink(),
      log,
    });
    expect(() =>
      ctx.commandHooks([{ id: 'check', on: WIDGET_CREATE, phase: 'beforeCommit', handler: () => undefined }]),
    ).toThrow(/acme_erp[\s\S]*command-hook registry/);
  });
});
