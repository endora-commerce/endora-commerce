import { asValue } from 'awilix';
import { afterEach, describe, expect, it } from 'vitest';
import { createRootContainer } from '@endora-commerce/platform/composition';
import {
  createModuleContext,
  createModuleRegistrationSink,
  type ModuleRegistrationSink,
} from '@endora-commerce/platform/composition';
import { type ModuleContext } from '../../../src/kernel/index.js';
import { EventBus } from '@endora-commerce/platform/events';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import { registerModule } from '../../../../packages/modules/product_feeds/src/backend/index.js';

/**
 * D-62 — the two boot hooks of `product_feeds`, and why only one of them asks.
 *
 * A boot hook is **not** gated by effective state: `runBootHooks` runs every
 * hook every module registered, whatever the operator switched off. That is
 * deliberate and must stay that way, because one of these two hooks is a
 * contribution the host filters, and skipping it would mean a module switched
 * on at runtime contributes nothing until the next restart.
 *
 * The other hook does **work**. `reconcileSchedules()` re-asserts every
 * per-feed BullMQ Job Scheduler (FR-031), so with `product_feeds` switched off
 * it wrote scheduler keys into Redis at every boot — a switched-off module
 * behaving very much as if it were installed (Constitution XVII). The probe at
 * the top of that hook is the fix, and it goes *first*, outside the `try`: a
 * boot hook has no caller to answer, so a presence answer raised inside would
 * either be swallowed by the reconcile's failure tolerance or take out the
 * boot.
 *
 * Both halves are asserted here, because either alone passes for the wrong
 * reason: a probe on both hooks would satisfy "does no work while off" and
 * silently break runtime activation.
 */

const MODULE_ID = 'product_feeds';

interface Harness {
  ctx: ModuleContext;
  sink: ModuleRegistrationSink;
  reconciles: () => string[];
  contributions: () => string[];
}

function build(): Harness {
  const container = createRootContainer();
  const sink = createModuleRegistrationSink();
  const reconciles: string[] = [];
  const contributions: string[] = [];

  const ctx = createModuleContext({
    module: { id: MODULE_ID, version: '1.0.0' },
    container,
    eventBus: new EventBus(),
    sink,
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });

  registerModule(ctx);

  // Registered **after** the module, deliberately: these overwrite the names it
  // would otherwise build, so the assertions below measure the hooks rather
  // than the cost of constructing a feed pipeline. `emFactory` and friends are
  // never reached — a hook that returns early resolves nothing at all, which is
  // itself part of what is being asserted.
  container.register({
    productFeedsRunWorkers: asValue(true),
    productFeeds: asValue({
      handle: {
        reconcileTemplates: async (): Promise<void> => {
          reconciles.push('predefined-template');
        },
        reconcileTaxonomies: async (): Promise<void> => {
          reconciles.push('taxonomy');
        },
        reconcileSchedules: async (): Promise<void> => {
          reconciles.push('schedule');
        },
      },
    }),
    configurationTypeRegistry: asValue({
      register: (type: { code: string }): void => {
        contributions.push(type.code);
      },
    }),
  });

  return { ctx, sink, reconciles: () => reconciles, contributions: () => contributions };
}

afterEach(() => {
  registryCache.__setEnabledForTesting([]);
});

describe('product_feeds — the boot hooks under an operator switch (D-62)', () => {
  it('reconciles nothing while the module is absent', async () => {
    const h = build();
    registryCache.__setEnabledForTesting([]);

    for (const hook of h.sink.bootHooks) await hook();

    // Not "no schedule": *nothing*. If `product_feeds` is off, none of the
    // three reconciles should run, which is why the probe is at the top of the
    // hook rather than per reconcile target.
    expect(h.reconciles()).toEqual([]);
  });

  it('still contributes its delivery credential type while the module is absent', async () => {
    const h = build();
    registryCache.__setEnabledForTesting([]);

    for (const hook of h.sink.bootHooks) await hook();

    // The contribution hook must **not** probe. `credentials` filters the
    // descriptor by owner presence at enumeration, so pushing it costs nothing
    // while the module is off — and withholding it would mean switching the
    // module back on at runtime contributed nothing until a restart.
    expect(h.contributions()).toEqual(['product_feeds_delivery']);
  });

  it('runs all three reconciles again once the module is present', async () => {
    const h = build();
    registryCache.__setEnabledForTesting([MODULE_ID]);

    for (const hook of h.sink.bootHooks) await hook();

    expect(h.reconciles()).toEqual(['predefined-template', 'taxonomy', 'schedule']);
    expect(h.contributions()).toEqual(['product_feeds_delivery']);
  });
});
