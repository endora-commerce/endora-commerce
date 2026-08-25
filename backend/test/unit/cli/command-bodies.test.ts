import { afterEach, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import { EventBus } from '../../../src/events/bus.js';
import { createRootContainer } from '../../../src/kernel/container.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import {
  createModuleContext,
  createModuleRegistrationSink,
  type ModuleContext,
} from '../../../src/kernel/module-context.js';
import { coverage } from '../../../src/modules/_i18n/cli/coverage.js';
import { abandonmentSweep } from '../../../src/modules/carts/cli/abandonment-sweep.js';
import { reindex } from '../../../../packages/modules/search/src/backend/cli/reindex.js';
import { cacheClear } from '../../../src/modules/settings/cli/cache-clear.js';

/**
 * How a converted command **reaches** what it needs (feature 080, T042b).
 *
 * The bodies are small; the part that can be wrong is the resolution, and it is
 * wrong in a way `tsc` cannot see. `lazyPort<T>(ctx, name)` is
 * `new Proxy({} as T, …)` whose `get` trap answers **every** property with a
 * function so it can forward a method call — the same property that makes
 * optional methods impossible through a port (D-97.3). So
 * `lazyPort<SearchModuleHandle>(ctx, 'searchHandle').indexer` type-checks as a
 * `SearchIndexer` and is a function at runtime, and the reach one level down
 * dies with `handle.indexer.reindexAllChannels is not a function`. That is
 * exactly what the first version of `search reindex` did, and nothing but
 * running it said so.
 *
 * Each test below therefore builds a real `ModuleContext` over a real container
 * holding a stub registration, and calls the command body — never a
 * pre-resolved collaborator handed in (issue #130). A body that reaches through
 * a proxy where it should read a cradle goes red here.
 */

function contextOver(
  moduleId: string,
  registrations: Record<string, unknown>,
): ModuleContext {
  const container = createRootContainer();
  const ctx = createModuleContext({
    module: { id: moduleId, version: '1.0.0' },
    container,
    eventBus: new EventBus(),
    sink: createModuleRegistrationSink(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  ctx.di.register(
    Object.fromEntries(
      Object.entries(registrations).map(([name, value]) => [
        name,
        ctx.asFunction(() => value).singleton(),
      ]),
    ),
  );
  return ctx;
}

afterEach(() => {
  registryCache.__setEnabledForTesting([]);
});

describe('search reindex reaches the composition own indexer', () => {
  it('reindexes every channel through `searchHandle` and prints the breakdown', async () => {
    const seen: unknown[] = [];
    const em = { marker: 'em' } as unknown as EntityManager;
    const ctx = contextOver('search', {
      emFactory: () => em,
      searchHandle: {
        indexer: {
          reindexAllChannels: async (received: unknown) => {
            seen.push(received);
            return [{ channelCode: 'default', indexUid: 'products_default', documentCount: 12 }];
          },
        },
      },
    });

    const out: string[] = [];
    expect(await reindex({ ctx, argv: [], out: (l) => out.push(l), err: () => {} })).toBe(0);
    // The EntityManager the composition supplies reaches the indexer — not a
    // fork this command took for itself.
    expect(seen).toEqual([em]);
    expect(out.join('\n')).toContain('products_default');
    expect(out.join('\n')).toContain('12 documents');
  });

  it('says so when no channel came back, instead of printing an empty table', async () => {
    const ctx = contextOver('search', {
      emFactory: () => ({}) as EntityManager,
      searchHandle: { indexer: { reindexAllChannels: async () => [] } },
    });
    const out: string[] = [];
    expect(await reindex({ ctx, argv: [], out: (l) => out.push(l), err: () => {} })).toBe(0);
    expect(out.join('\n')).toMatch(/No Sales Channels found/);
  });
});

describe('carts abandonment-sweep reaches the composition own worker', () => {
  it('sweeps through `cartAbandonmentWorker` and reports both counts', async () => {
    const ctx = contextOver('carts', {
      cartAbandonmentWorker: { sweep: async () => ({ abandonedCount: 3, notifiedCount: 1 }) },
    });
    const out: string[] = [];
    expect(await abandonmentSweep({ ctx, argv: [], out: (l) => out.push(l), err: () => {} })).toBe(
      0,
    );
    expect(out).toEqual(['[cart abandonment-sweep] abandoned=3 notified=1']);
  });
});

describe('settings cache-clear reaches the composition own CacheAdminService', () => {
  it('flushes the namespaces the operator named', async () => {
    const cleared: unknown[] = [];
    const ctx = contextOver('settings', {
      settingsCacheAdminService: {
        clear: async (target: unknown) => {
          cleared.push(target);
          return { cleared: [{ key: 'blog', deletedKeysCount: 4 }], totalDeletedKeys: 4 };
        },
      },
    });
    const out: string[] = [];
    expect(
      await cacheClear({ ctx, argv: ['blog'], out: (l) => out.push(l), err: () => {} }),
    ).toBe(0);
    expect(cleared).toEqual([['blog']]);
    expect(out.join('\n')).toContain('4 key(s) deleted in total');
  });

  it('refuses an unknown namespace rather than flushing something else', async () => {
    const ctx = contextOver('settings', {
      settingsCacheAdminService: {
        clear: async () => {
          throw new Error('nothing may be flushed for an argv this command refused');
        },
      },
    });
    const err: string[] = [];
    expect(
      await cacheClear({ ctx, argv: ['not-a-namespace'], out: () => {}, err: (l) => err.push(l) }),
    ).toBe(1);
    expect(err.join('\n')).toMatch(/Unknown namespace/);
  });
});

describe('_i18n coverage reaches the composition own I18nService', () => {
  it('forwards the filters and answers 0 outside strict mode', async () => {
    // `adminI18nService` is a **port** in `_i18n`'s own registrations, so this
    // one is reached with `lazyPort` and the reach is a top-level method call —
    // which is the shape the proxy does forward. The presence gate on a
    // `providePort` registration is transient, so the module has to be present
    // for the resolution to answer at all.
    registryCache.__setEnabledForTesting(['_i18n']);
    const asked: unknown[] = [];
    const container = createRootContainer();
    const ctx = createModuleContext({
      module: { id: '_i18n', version: '1.0.0' },
      container,
      eventBus: new EventBus(),
      sink: createModuleRegistrationSink(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    ctx.di.providePort(
      'adminI18nService',
      ctx
        .asFunction(() => ({
          getCoverageSnapshot: async (filters: unknown) => {
            asked.push(filters);
            return {
              capturedAt: '2026-08-22T00:00:00.000Z',
              modules: [
                {
                  moduleId: 'blog',
                  languages: [{ languageCode: 'pl', missingCount: 2, fellBackToEnCount: 1 }],
                },
              ],
            };
          },
        }))
        .singleton(),
    );

    const out: string[] = [];
    expect(
      await coverage({
        ctx,
        argv: ['--modules', 'blog', '--languages', 'pl'],
        out: (l) => out.push(l),
        err: () => {},
      }),
    ).toBe(0);
    expect(asked).toEqual([{ moduleIds: ['blog'], languageCodes: ['pl'] }]);
    expect(out.join('\n')).toContain('missing=  2');
  });

  it('exits non-zero in strict mode when a pair is missing entries', async () => {
    registryCache.__setEnabledForTesting(['_i18n']);
    const container = createRootContainer();
    const ctx = createModuleContext({
      module: { id: '_i18n', version: '1.0.0' },
      container,
      eventBus: new EventBus(),
      sink: createModuleRegistrationSink(),
      log: { info: () => {}, warn: () => {}, error: () => {} },
    });
    ctx.di.providePort(
      'adminI18nService',
      ctx
        .asFunction(() => ({
          getCoverageSnapshot: async () => ({
            capturedAt: '2026-08-22T00:00:00.000Z',
            modules: [
              {
                moduleId: 'blog',
                languages: [{ languageCode: 'pl', missingCount: 2, fellBackToEnCount: 0 }],
              },
            ],
          }),
        }))
        .singleton(),
    );

    const err: string[] = [];
    expect(
      await coverage({ ctx, argv: ['--strict'], out: () => {}, err: (l) => err.push(l) }),
    ).toBe(1);
    expect(err.join('\n')).toMatch(/strict mode: 1 \(module, language\) pair/);
  });
});
