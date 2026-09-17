import { afterEach, describe, expect, it } from 'vitest';
import type { Redis } from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import { InProcessCacheRegistry, inProcessCaches } from '../cache/in-process-cache-registry.js';
import {
  ModuleRegistryCache,
  STATE_CHANGED_CHANNEL,
} from './registry-cache.js';
import { ModuleRegistration } from './module-registration.entity.js';
import { Setting } from '../settings/setting.entity.js';
import { ModuleEffectiveState } from './effective-state.js';
import { capabilityRegistryFrom } from './capability-registry.js';
import type { ModuleManifest } from '@endora-commerce/contracts';

/**
 * D-174 — the cross-process invalidation a module needs, through the seam that
 * already exists.
 *
 * A module whose snapshot is derived from inputs an install rewrites —
 * `module_actions` rows, another module's translation bundles — cannot see
 * those inputs move: `presenceVersion()` is a hash of the two presence axes and
 * of nothing else. The notification that *does* announce them is the
 * `b2b:module:state-changed` Redis channel, and a module may not name it: the
 * channel is a transport detail of the kernel's registry cache.
 *
 * So the kernel's own subscriber drives {@link InProcessCacheRegistry}, and a
 * module registers a layer that opts in. The opt-in is the whole design: the
 * two layers already registered (`settings`, `sales_channels`) clear a Redis
 * key space with SCAN+DEL, and doing that in every process on every operator
 * flip is a storm nobody asked for.
 */

describe('InProcessCacheRegistry — module-state invalidation', () => {
  it('drops the layers that opted in and leaves the others alone', async () => {
    const registry = new InProcessCacheRegistry();
    const dropped: string[] = [];

    registry.register(
      'follows_state',
      {
        invalidateAll: async (): Promise<number> => {
          dropped.push('follows_state');
          return 0;
        },
      },
      { invalidateOnModuleStateChange: true },
    );
    registry.register('redis_only', {
      invalidateAll: async (): Promise<number> => {
        dropped.push('redis_only');
        return 7;
      },
    });

    await registry.invalidateForModuleStateChange();

    expect(dropped).toEqual(['follows_state']);
  });

  it('starts every opted-in layer synchronously, so the drop lands on receipt', async () => {
    const registry = new InProcessCacheRegistry();
    let dropped = false;

    registry.register(
      'follows_state',
      {
        invalidateAll: async (): Promise<number> => {
          dropped = true;
          return 0;
        },
      },
      { invalidateOnModuleStateChange: true },
    );

    // Not awaited: this is how the pub/sub handler calls it, and a snapshot
    // that survives into the same tick is a snapshot a request can still be
    // served from.
    void registry.invalidateForModuleStateChange();
    expect(dropped).toBe(true);
  });

  it('contains a throwing layer — one bad consumer must not stop the others', async () => {
    const registry = new InProcessCacheRegistry();
    const dropped: string[] = [];

    registry.register(
      'throws',
      {
        invalidateAll: async (): Promise<number> => {
          throw new Error('boom');
        },
      },
      { invalidateOnModuleStateChange: true },
    );
    registry.register(
      'follows_state',
      {
        invalidateAll: async (): Promise<number> => {
          dropped.push('follows_state');
          return 0;
        },
      },
      { invalidateOnModuleStateChange: true },
    );

    await expect(registry.invalidateForModuleStateChange()).resolves.toBeUndefined();
    expect(dropped).toEqual(['follows_state']);
  });

  it('an unregistered layer stops being dropped', async () => {
    const registry = new InProcessCacheRegistry();
    let drops = 0;
    const unregister = registry.register(
      'follows_state',
      {
        invalidateAll: async (): Promise<number> => {
          drops += 1;
          return 0;
        },
      },
      { invalidateOnModuleStateChange: true },
    );

    await registry.invalidateForModuleStateChange();
    unregister();
    await registry.invalidateForModuleStateChange();

    expect(drops).toBe(1);
  });
});

/**
 * A fake ioredis subscriber: `watch` only ever calls `on` and `subscribe`, and
 * `emit` delivers a message the way the real client does — a synchronous
 * callback with no caller of its own.
 */
class FakeSubscriber {
  private readonly handlers = new Map<string, ((...args: unknown[]) => void)[]>();

  on(event: string, handler: (...args: unknown[]) => void): this {
    const existing = this.handlers.get(event) ?? [];
    existing.push(handler);
    this.handlers.set(event, existing);
    return this;
  }

  async subscribe(): Promise<void> {}

  emit(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) handler(...args);
  }
}

describe('the state-changed subscriber drives the registry', () => {
  const registered: (() => void)[] = [];

  afterEach(() => {
    for (const dispose of registered.splice(0)) dispose();
  });

  async function armedCache(): Promise<{
    cache: ModuleRegistryCache;
    subscriber: FakeSubscriber;
  }> {
    const cache = new ModuleRegistryCache();
    const subscriber = new FakeSubscriber();
    const em = (): EntityManager =>
      ({ find: async (): Promise<unknown[]> => [] }) as unknown as EntityManager;
    await cache.watch({ redisSubscriber: subscriber as unknown as Redis, em });
    return { cache, subscriber };
  }

  it('invalidates an opted-in layer of the process singleton on a message', async () => {
    let drops = 0;
    registered.push(
      inProcessCaches.register(
        'fixture_d174',
        {
          invalidateAll: async (): Promise<number> => {
            drops += 1;
            return 0;
          },
        },
        { invalidateOnModuleStateChange: true },
      ),
    );

    const { cache, subscriber } = await armedCache();
    subscriber.emit('message', STATE_CHANGED_CHANNEL, '{"moduleId":"x","newState":"installed"}');

    // Synchronously, in the handler — before the PostgreSQL round-trip the
    // refresh is still waiting on.
    expect(drops).toBe(1);
    cache.stopFallbackRefresh();
  });

  it('ignores a message on another channel', async () => {
    let drops = 0;
    registered.push(
      inProcessCaches.register(
        'fixture_d174',
        {
          invalidateAll: async (): Promise<number> => {
            drops += 1;
            return 0;
          },
        },
        { invalidateOnModuleStateChange: true },
      ),
    );

    const { cache, subscriber } = await armedCache();
    subscriber.emit('message', 'some:other:channel', '{}');

    expect(drops).toBe(0);
    cache.stopFallbackRefresh();
  });
});

/**
 * Feature 132 (T014) — the derived capability family is refreshed by the **same**
 * `b2b:module:state-changed` message that re-resolves activation, because it is
 * installed into the same cache by the same `registryCache.load` call
 * (`data-model.md` §2.2).
 *
 * This is the load-bearing half of that placement rather than a nicety. A family
 * read against a *different* refresh path would be stale for exactly the window
 * in which an operator is flipping a connector — the only window a mutual
 * exclusion has to be right in — and the two answers would disagree while the
 * refusal was being computed from both.
 */
describe('a state-changed refresh re-answers membersOfCapability with the activation it moved', () => {
  const manifest = (overrides: Partial<ModuleManifest> & { id: string }): ModuleManifest =>
    ({ version: '1.0.0', dependencies: [], ...overrides }) as unknown as ModuleManifest;

  const member = (id: string): ModuleManifest =>
    manifest({
      id,
      capabilities: ['pim-connector'],
      activation: { settingCode: `${id}.activation`, default: false },
    });

  const MEMBERS = ['fixture_pim_a', 'fixture_pim_b'] as const;

  it('one message, both facts — the family follows the flip it was read against', async () => {
    // The operator's recorded choice, as the `settings` rows hold it. Mutated
    // between the two refreshes to stand for the flip an operator just made on
    // `/platform/modules`.
    const activated = new Map<string, boolean>([
      ['fixture_pim_a.activation', true],
      ['fixture_pim_b.activation', false],
    ]);

    const em = (): EntityManager =>
      ({
        find: async (entity: unknown): Promise<unknown[]> => {
          if (entity === ModuleRegistration) {
            return MEMBERS.map((moduleId) => ({ moduleId, state: 'installed' }));
          }
          if (entity === Setting) {
            return [...activated].map(([code, globalValue]) => ({
              code,
              globalValue,
              defaultValue: false,
            }));
          }
          return [];
        },
      }) as unknown as EntityManager;

    const cache = new ModuleRegistryCache();
    const state = new ModuleEffectiveState(cache);
    const subscriber = new FakeSubscriber();

    await cache.load({
      em,
      activationDeclarations: MEMBERS.map((moduleId) => ({
        moduleId,
        settingCode: `${moduleId}.activation`,
        default: false,
        nonDeactivatableReason: null,
      })),
      capabilityRegistry: capabilityRegistryFrom(MEMBERS.map(member)),
    });
    await cache.watch({ redisSubscriber: subscriber as unknown as Redis, em });

    expect(state.membersOfCapability('pim-connector')).toEqual(['fixture_pim_a']);

    // The operator switches one connector off and the other on.
    activated.set('fixture_pim_a.activation', false);
    activated.set('fixture_pim_b.activation', true);

    const before = cache.presenceVersion();
    const settled = new Promise<void>((resolve) => {
      const stop = cache.onPresenceInstalled(() => {
        if (cache.presenceVersion() !== before) {
          stop();
          resolve();
        }
      });
    });
    subscriber.emit('message', STATE_CHANGED_CHANNEL, '{"moduleId":"fixture_pim_b","newState":"installed"}');
    await settled;

    // The same refresh that installed the new activation answers the family, so
    // there is no tick in which one of the two is the pre-flip value.
    expect(state.membersOfCapability('pim-connector')).toEqual(['fixture_pim_b']);
    expect(state.declaredMembersOfCapability('pim-connector')).toEqual([...MEMBERS]);
    cache.stopFallbackRefresh();
  });
});
