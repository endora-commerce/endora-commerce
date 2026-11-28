/**
 * `@endora-commerce/test-kit/module` — one module composed over supplied
 * values, with no server and no database (issue #1072).
 *
 * The cases are the shapes the module packages' own unit tests need: resolve a
 * name the module registered over ports the test fakes, drive a subscription
 * through the bus the module subscribed to, and switch the module's presence
 * per test.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { defineFieldSet, hookableAction } from '@endora-commerce/contracts';
import { FormRegistry } from '@endora-commerce/platform/composition';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { composeModuleForTest, type ComposedModule } from './index.js';

const disposals: ComposedModule[] = [];
const composed = (handle: ComposedModule): ComposedModule => {
  disposals.push(handle);
  return handle;
};

const settle = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  for (const handle of disposals.splice(0)) handle.dispose();
});

describe('composeModuleForTest', () => {
  it('runs the module over the supplied values and resolves what it registered', () => {
    const registerModule = (ctx: ModuleContext): void => {
      ctx.di.register({
        greeter: ctx
          .asFunction(({ greeting }: { greeting: string }) => ({ greet: () => `${greeting}!` }))
          .singleton(),
      });
    };
    const { container, context } = composed(
      composeModuleForTest({ module: { id: 'greetings', registerModule }, values: { greeting: 'hi' } }),
    );

    expect(context.module).toEqual({ id: 'greetings', version: '1.0.0' });
    expect(container.hasRegistration('greeter')).toBe(true);
    expect((container.cradle.greeter as { greet(): string }).greet()).toBe('hi!');
  });

  it('hands the module the bus it returns, so a test emits where the module subscribed', async () => {
    const seen: unknown[] = [];
    const registerModule = (ctx: ModuleContext): void => {
      ctx.subscribe('probe.happened.v1', (payload) => {
        seen.push(payload);
      });
    };
    const handle = composed(composeModuleForTest({ module: { id: 'probe', registerModule } }));
    handle.registryCache.setEnabled(['probe']);

    handle.eventBus.emit('probe.happened.v1' as never, { n: 1 } as never);
    await settle();

    expect(seen).toEqual([{ n: 1 }]);
    expect(handle.container.cradle.eventBus).toBe(handle.eventBus);
  });

  it('gates the module on the presence the handle sets, as a composed platform does', async () => {
    const seen: string[] = [];
    const registerModule = (ctx: ModuleContext): void => {
      ctx.subscribe('probe.happened.v1', () => {
        seen.push('handled');
      });
    };
    const handle = composed(composeModuleForTest({ module: { id: 'probe', registerModule } }));

    handle.registryCache.setEnabled([]);
    handle.eventBus.emit('probe.happened.v1' as never, {} as never);
    await settle();
    expect(seen).toEqual([]);

    handle.registryCache.setEnabled(['probe']);
    handle.eventBus.emit('probe.happened.v1' as never, {} as never);
    await settle();
    expect(seen).toEqual(['handled']);
  });

  it('releases the module\'s subscriptions and its presence on dispose', async () => {
    let calls = 0;
    const registerModule = (ctx: ModuleContext): void => {
      ctx.subscribe('probe.happened.v1', () => {
        calls += 1;
      });
    };
    const handle = composeModuleForTest({ module: { id: 'probe', registerModule } });
    handle.registryCache.setEnabled(['probe']);
    expect(handle.registrations.unsubscribes).toHaveLength(1);

    handle.dispose();
    handle.eventBus.emit('probe.happened.v1' as never, {} as never);
    await settle();

    expect(calls).toBe(0);
    expect(handle.registryCache.isEnabled('probe')).toBe(false);
  });
});

describe('composeModuleForTest — the form registry (193 D-300.30)', () => {
  const SET = defineFieldSet({
    id: 'widget',
    ownerModuleId: 'widgets',
    fields: [{ key: 'code', type: 'string', required: false, bounds: { maxLength: 32 }, accepts: ['validation'] }],
  });
  const UPDATE = hookableAction<{ code: string }>('widget.update', 'widget', ['beforeCommit']);
  const registerModule = (ctx: ModuleContext): void =>
    ctx.fieldSets([
      { set: SET, writers: [{ on: UPDATE, mode: 'update', writes: ['code'], project: (data) => ({ after: data as Record<string, unknown>, changed: ['code'] }) }] },
    ]);

  it('mounts an unsealed form registry by default, so a module registering its field set composes', () => {
    const { formRegistry } = composed(composeModuleForTest({ module: { id: 'widgets', registerModule } }));
    expect(formRegistry).toBeInstanceOf(FormRegistry);
    expect(formRegistry.isSealed).toBe(false);
    // What the module registered is the test's to seal and read.
    formRegistry.seal({
      fieldSets: [{ moduleId: 'widgets', set: SET }],
      adminForms: [],
      formOverrides: [{ moduleId: 'acme', override: { target: 'widget.code', validation: { maxLength: 4 }, reason: 'Short codes.' } }],
      inputControls: [],
      hookableActions: [{ moduleId: 'widgets', action: 'widget.update', objectType: 'widget', phases: ['beforeCommit'] }],
      moduleDependencies: { widgets: [], acme: ['widgets'] },
      permissionCodes: [],
      origins: { widgets: 'core', acme: 'deployment' },
      installedPackageNames: {},
    });
    expect(formRegistry.fieldRuleCheck('widget.update')).toBeTypeOf('function');
  });

  it('uses the registry it is given', () => {
    const given = new FormRegistry();
    expect(composed(composeModuleForTest({ module: { id: 'widgets', registerModule }, formRegistry: given })).formRegistry).toBe(given);
  });
});
