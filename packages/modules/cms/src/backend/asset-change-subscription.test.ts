import { afterEach, describe, expect, it, vi } from 'vitest';
import { ASSET_CHANGED_EVENT, CMS_STOREFRONT_CACHE_TAGS } from '@endora-commerce/contracts';
import {
  createModuleContext,
  createModuleRegistrationSink,
  createRootContainer,
  registerValues,
  registryCache,
} from '@endora-commerce/platform/composition';
import { EventBus } from '@endora-commerce/platform/events';
import { registerModule } from './index.js';

/**
 * Issue #363 — a cached CMS answer (a page, a block, a hook) carries the URL of
 * every asset it embeds, `?v=<contentVersion>` included, so an asset write
 * leaves it stale. `assets_library` announces the write on the bus; `cms`
 * answers by dropping its Redis entries, *then* asking the storefront to drop
 * the Data Cache entries in front of them — and does nothing while it is off
 * (Constitution XVII). The CMS learns of the write only through the event, so
 * an `assets_library` that is absent simply never announces anything.
 */

const MODULE_ID = 'cms';

function build(): { emit: (assetIds: string[]) => void; log: string[]; bus: EventBus } {
  process.env['STOREFRONT_BASE_URL'] = 'http://storefront:3010';
  process.env['REVALIDATE_SECRET'] = 'sekret';

  const log: string[] = [];
  vi.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => {
    const { tags } = JSON.parse(String(init?.body)) as { tags: string[] };
    log.push(`post:${tags.join(',')}`);
    return new Response(null, { status: 200 });
  });

  // The two commands `CmsCache.invalidateAll` issues, and nothing else.
  const redis = {
    scan: async (_cursor: string, _match: string, pattern: string) => {
      log.push(`scan:${pattern}`);
      return ['0', ['cms:v1:page:home:default:en-US']];
    },
    del: async (...keys: string[]) => {
      log.push(`del:${keys.join(',')}`);
      return keys.length;
    },
  };

  const container = createRootContainer();
  registerValues(container, {
    emFactory: () => {
      throw new Error('the subscription must not open a database connection');
    },
    commandBus: {
      run: () => {
        throw new Error('the subscription must not run a command');
      },
    },
    redis,
    resolvedModuleRegistry: [],
  });
  const bus = new EventBus();
  registerValues(container, { eventBus: bus });
  const ctx = createModuleContext({
    module: { id: MODULE_ID, version: '1.0.0' },
    container,
    eventBus: bus,
    sink: createModuleRegistrationSink(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  registerModule(ctx);

  return {
    emit: (assetIds) =>
      bus.emit(ASSET_CHANGED_EVENT, {
        eventId: 'e-1',
        occurredAt: new Date().toISOString(),
        assetIds,
      } as never),
    log,
    bus,
  };
}

const ORIGINAL_ENV = {
  url: process.env['STOREFRONT_BASE_URL'],
  secret: process.env['REVALIDATE_SECRET'],
};

afterEach(() => {
  vi.restoreAllMocks();
  registryCache.__setEnabledForTesting([]);
  if (ORIGINAL_ENV.url === undefined) delete process.env['STOREFRONT_BASE_URL'];
  else process.env['STOREFRONT_BASE_URL'] = ORIGINAL_ENV.url;
  if (ORIGINAL_ENV.secret === undefined) delete process.env['REVALIDATE_SECRET'];
  else process.env['REVALIDATE_SECRET'] = ORIGINAL_ENV.secret;
});

describe('cms answers an asset write (issue #363)', () => {
  it('drops every cached CMS answer, then the storefront entries in front of them', async () => {
    registryCache.__setEnabledForTesting([MODULE_ID]);
    const { bus, log } = build();

    // Dispatched in a scope, as `assets_library` does, so the write answers only
    // once both caches have been dropped.
    await bus.run(async () => {
      bus.emit(ASSET_CHANGED_EVENT, {
        eventId: 'e-1',
        occurredAt: new Date().toISOString(),
        assetIds: ['a-1'],
      } as never);
    });

    expect(log).toEqual([
      'scan:cms:v1:*',
      'del:cms:v1:page:home:default:en-US',
      `post:${[
        CMS_STOREFRONT_CACHE_TAGS.pages,
        CMS_STOREFRONT_CACHE_TAGS.blocks,
        CMS_STOREFRONT_CACHE_TAGS.hooks,
      ].join(',')}`,
    ]);
  });

  it('does nothing at all while the module is off', async () => {
    registryCache.__setEnabledForTesting([]);
    const { emit, log } = build();

    emit(['a-1']);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(log).toEqual([]);
  });
});
