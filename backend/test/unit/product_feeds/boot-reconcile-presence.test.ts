import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { EventBus } from '@endora-commerce/platform/events';
import { createRootContainer, registerValues } from '../../../src/kernel/container.js';
import { composeModules } from '../../../src/kernel/compose.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { effectiveState } from '../../../src/kernel/lifecycle/effective-state.js';
import { REGISTERED_MANIFESTS } from '../../../src/lifecycle/registered-manifests.js';

/**
 * Issue #147 — the `product_feeds` boot reconcile decides presence before it works.
 *
 * `reconcileSchedules()` re-asserts every per-feed BullMQ Job Scheduler (FR-031).
 * A Job Scheduler is not a `setInterval`, and the timer check did not look at boot
 * hooks when this landed, so nothing saw it: with the module switched off an
 * operator still got its repeatable jobs written back into Redis on every deploy,
 * plus a template install and a taxonomy revision install — a switched-off module
 * writing at boot, which is Constitution XVII failing. `check:entry-presence` reads
 * boot hooks since D-68, so the hole this file was written for is now ratcheted as
 * well as tested.
 *
 * The probe goes **first, and outside the `try`** (D-62). `runBootHooks`
 * re-throws — it wraps the hook in a `try` whose `catch` raises
 * `ModuleCompositionError` — so a `ModuleDisabledError` from here would either be
 * swallowed by the `reconcile` helper's `catch`, which exists for transient API
 * failures, or take out the boot. Neither is an answer; the hook has no caller to
 * give one to, so presence is decided.
 *
 * The second hook in the same file must **not** get a probe: it pushes the feed
 * delivery credential type into `credentials`' registry, and that is a boot-time
 * contribution the host filters by owner presence. Probing it would mean a module
 * switched on at runtime contributes nothing until the next restart. Both halves
 * are asserted here, because "add the probe" applied uniformly is the wrong fix.
 */

const reconcileTemplates = vi.fn(async () => 0);
const reconcileTaxonomies = vi.fn(async () => undefined);
const reconcileSchedules = vi.fn(async () => ({ upserted: 0, removed: 0 }));

// The module under test is `backend.ts`, not the feed engine: the plugin is
// stubbed so the boot hook meets a handle whose three reconciles record whether
// they were called, and no queue, Redis client or Postgres connection is built.
vi.mock('../../../../packages/modules/product_feeds/src/backend/plugin.js', () => ({
  productFeedsModule: () => ({
    handle: { reconcileTemplates, reconcileTaxonomies, reconcileSchedules },
    plugin: async () => undefined,
  }),
}));

// Named statically. `vi.mock` is hoisted above every import in this file, so
// the stub above is in place either way — and a dynamic import names no
// binding, which takes the whole import graph of the file it reaches. This
// test composes its own container out of `registerModule` and hands the ORM
// nothing, so the source copy is the only copy in this process.
import { registerModule } from '../../../../packages/modules/product_feeds/src/backend/index.js';

const ALL_IDS = REGISTERED_MANIFESTS.map((entry) => entry.manifest.id);

interface Composed {
  runBootHooks: () => Promise<void>;
  registeredConfigurationTypes: string[];
}

async function composeProductFeeds(): Promise<Composed> {
  const container = createRootContainer();
  const registeredConfigurationTypes: string[] = [];
  // What the two hooks reach, and nothing more.
  registerValues(container, {
    emFactory: (): EntityManager => ({}) as EntityManager,
    commandBus: {},
    eventBus: new EventBus(),
    moduleQueueRedis: undefined,
    productFeedsRunWorkers: true,
    productFeedsPublicBaseUrl: 'http://feeds.test.local',
    productFeedsTokenEncryptionKey: undefined,
    productFeedsBridge: {},
    configurationTypeRegistry: {
      register: (type: { code: string }) => registeredConfigurationTypes.push(type.code),
    },
  });
  const composed = composeModules(
    [{ id: 'product_feeds', version: '1.0.0', registerModule }],
    {
      container,
      eventBus: new EventBus(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
    },
  );
  return { runBootHooks: () => composed.runBootHooks(), registeredConfigurationTypes };
}

describe('product_feeds boot reconcile is gated on effective presence', () => {
  beforeEach(() => {
    reconcileTemplates.mockClear();
    reconcileTaxonomies.mockClear();
    reconcileSchedules.mockClear();
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  afterAll(() => {
    // The cache is a process singleton and the suite shares one fork.
    registryCache.__setEnabledForTesting(ALL_IDS);
  });

  it('reconciles nothing — schedules included — while the module is off', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['product_feeds'] });
    expect(
      effectiveState.isPresent('product_feeds'),
      'the fixture did not switch the module off',
    ).toBe(false);

    const { runBootHooks } = await composeProductFeeds();
    await runBootHooks();

    expect(
      reconcileSchedules,
      'a switched-off module re-asserted its BullMQ Job Schedulers at boot',
    ).not.toHaveBeenCalled();
    expect(reconcileTemplates, 'a switched-off module installed templates').not.toHaveBeenCalled();
    expect(
      reconcileTaxonomies,
      'a switched-off module installed a taxonomy revision',
    ).not.toHaveBeenCalled();
  });

  it('still contributes its credential type while off — a contribution is not work', async () => {
    registryCache.__setEnabledForTesting(ALL_IDS, { deactivated: ['product_feeds'] });

    const { runBootHooks, registeredConfigurationTypes } = await composeProductFeeds();
    await runBootHooks();

    expect(
      registeredConfigurationTypes,
      'the contribution hook was probed too, so switching the module back on at ' +
        'runtime would contribute nothing until the next restart',
    ).toEqual(['product_feeds_delivery']);
  });

  it('reconciles everything again once the module is back on', async () => {
    const { runBootHooks } = await composeProductFeeds();
    await runBootHooks();

    expect(reconcileTemplates).toHaveBeenCalledTimes(1);
    expect(reconcileTaxonomies).toHaveBeenCalledTimes(1);
    expect(reconcileSchedules).toHaveBeenCalledTimes(1);
  });
});
