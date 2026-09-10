import { describe, expect, it, vi } from 'vitest';
import { EventBus } from '@endora-commerce/platform/events';
import { createRootContainer } from '@endora-commerce/platform/composition';
import { composeModules } from '@endora-commerce/platform/composition';
import { manifest as blogManifest } from '../../../../packages/modules/blog/src/manifest.js';
import * as blogBackend from '../../../../packages/modules/blog/src/backend/index.js';

/**
 * Registration is lazy; composition is not (feature 072, T044 / FR-021).
 *
 * The property the 3144-line composition root could not have: it constructs
 * every service of every module at boot, whether the process will ever use one
 * or not, so a `BACKEND_ROLE=worker` process pays for the whole HTTP graph and
 * a module nobody calls still connects to Redis at boot.
 *
 * With registrations, a service nothing resolves is never constructed — and
 * "never constructed" has to be asserted, because the failure mode is invisible:
 * an eagerly constructed service works fine, it just costs boot time, memory and
 * a connection, and turns a configuration error in an unused module into a boot
 * failure.
 */

function log(): { info: () => void; warn: () => void; error: () => void } {
  return { info: () => {}, warn: () => {}, error: () => {} };
}

describe('lazy registration', () => {
  it('does not construct a registered service nothing resolves', () => {
    const constructed = vi.fn();
    class NeverUsed {
      constructor() {
        constructed();
      }
    }
    const container = createRootContainer();

    composeModules(
      [
        {
          id: 'lazy_module',
          version: '1.0.0',
          registerModule: (ctx) => {
            ctx.di.register({
              neverUsed: ctx.asClass(NeverUsed).singleton(),
              alsoNeverUsed: ctx.asFunction(() => new NeverUsed()).singleton(),
            });
          },
        },
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    expect(container.hasRegistration('neverUsed')).toBe(true);
    expect(container.hasRegistration('alsoNeverUsed')).toBe(true);
    expect(constructed).not.toHaveBeenCalled();
  });

  it('constructs it exactly once, on first resolution', () => {
    const constructed = vi.fn();
    class Counted {
      constructor() {
        constructed();
      }
    }
    const container = createRootContainer();
    composeModules(
      [
        {
          id: 'lazy_module',
          version: '1.0.0',
          registerModule: (ctx) => {
            ctx.di.register({ counted: ctx.asClass(Counted).singleton() });
          },
        },
      ],
      { container, eventBus: new EventBus(), log: log() },
    );

    expect(constructed).not.toHaveBeenCalled();
    const first = container.resolve<Counted>('counted');
    const second = container.resolve<Counted>('counted');
    expect(constructed).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it('does not touch a dependency of a service nothing resolves', () => {
    // The stronger version: a lazy service whose dependency does not even exist
    // still composes. If registration were eager this would throw
    // AwilixResolutionError at composition instead of at first use.
    const container = createRootContainer();

    expect(() =>
      composeModules(
        [
          {
            id: 'lazy_module',
            version: '1.0.0',
            registerModule: (ctx) => {
              ctx.di.register({
                needsMissing: ctx
                  .asFunction(({ nothingRegistersThis }: { nothingRegistersThis: string }) => ({
                    value: nothingRegistersThis,
                  }))
                  .singleton(),
              });
            },
          },
        ],
        { container, eventBus: new EventBus(), log: log() },
      ),
    ).not.toThrow();

    expect(() => container.resolve('needsMissing')).toThrow(/nothingRegistersThis/);
  });

  it('composes the real blog module against a container with nothing in it', () => {
    // `blog` is the converted module (T040) and its registrations name seven
    // host-provided values — `emFactory`, `redis`, `requireAdmin`,
    // `settingsReadPort`, the two registries and the storefront ports. None is
    // registered here. Composition still succeeds, because `registerModule`
    // declares and resolves nothing; the first *resolution* is what would fail.
    const container = createRootContainer();

    expect(() =>
      composeModules(
        [
          {
            id: blogManifest.id,
            version: blogManifest.version,
            registerModule: blogBackend.registerModule,
          },
        ],
        { container, eventBus: new EventBus(), log: log() },
      ),
    ).not.toThrow();

    for (const name of [
      'blogCacheService',
      'blogSettingsResolver',
      'blogPostService',
      'blogCategoryService',
      'blogTagService',
      'blogStorefrontResolver',
    ]) {
      expect(container.hasRegistration(name), name).toBe(true);
    }
    expect(() => container.resolve('blogPostService')).toThrow();
  });
});
