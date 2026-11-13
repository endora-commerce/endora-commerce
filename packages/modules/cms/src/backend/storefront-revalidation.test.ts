import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  ASSET_CHANGED_EVENT,
  CMS_CONTENT_CHANGED_EVENT,
  CMS_STOREFRONT_CACHE_TAGS,
  type CmsContentChange,
} from '@endora-commerce/contracts';
import type { EventBus } from '@endora-commerce/platform/events';
import { composeModuleForTest, type ComposedModule } from '@endora-commerce/test-kit/module';
import { registerModule } from './index.js';

/**
 * `cms` answers its own content-change event by asking the storefront to drop
 * the Data Cache entries the change made stale — and stops doing so with the
 * module (Constitution XVII).
 *
 * The event is driven through the EventBus the module subscribes to, with the
 * module composed in isolation: the handler resolves the revalidator and
 * nothing else, so no database and no Redis are involved. That a real admin
 * save *publishes* the event is the host's
 * `backend/test/integration/cms/storefront-revalidation.test.ts`; this file
 * holds the half that needs presence switched, which a composed harness cannot
 * do per test.
 */

const MODULE_ID = 'cms';

type FetchSpy = ReturnType<typeof vi.fn>;

/** Every composition a case made; `afterEach` disposes them, presence included. */
const composed: ComposedModule[] = [];

/** Compose `cms` alone, present or off, and keep the handle for `afterEach`. */
function compose(present: boolean, values: Record<string, unknown> = {}): ComposedModule {
  const handle = composeModuleForTest({ module: { id: MODULE_ID, registerModule }, values });
  handle.registryCache.setEnabled(present ? [MODULE_ID] : []);
  composed.push(handle);
  return handle;
}

function build(
  present: boolean,
  env: { storefront?: string; secret?: string } = {},
): {
  emit: (change: CmsContentChange) => void;
  fetchSpy: FetchSpy;
  bus: EventBus;
} {
  if (env.storefront === undefined) delete process.env['STOREFRONT_BASE_URL'];
  else process.env['STOREFRONT_BASE_URL'] = env.storefront;
  if (env.secret === undefined) delete process.env['REVALIDATE_SECRET'];
  else process.env['REVALIDATE_SECRET'] = env.secret;

  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 200 })) as unknown as FetchSpy;
  const bus = compose(present).eventBus;

  return {
    emit: (change) =>
      bus.emit(CMS_CONTENT_CHANGED_EVENT, {
        eventId: 'e-1',
        occurredAt: new Date().toISOString(),
        ...change,
      } as never),
    fetchSpy,
    bus,
  };
}

const ORIGINAL_ENV = {
  url: process.env['STOREFRONT_BASE_URL'],
  secret: process.env['REVALIDATE_SECRET'],
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 20));

function postedTags(fetchSpy: FetchSpy): string[] {
  const [url, init] = fetchSpy.mock.calls[0]! as [unknown, RequestInit];
  expect(String(url)).toBe('http://storefront:3010/api/revalidate');
  expect(init.method).toBe('POST');
  expect((init.headers as Record<string, string>)['x-revalidate-secret']).toBe('sekret');
  return (JSON.parse(init.body as string) as { tags: string[] }).tags;
}

afterEach(() => {
  vi.restoreAllMocks();
  for (const handle of composed.splice(0)) handle.dispose();
  if (ORIGINAL_ENV.url === undefined) delete process.env['STOREFRONT_BASE_URL'];
  else process.env['STOREFRONT_BASE_URL'] = ORIGINAL_ENV.url;
  if (ORIGINAL_ENV.secret === undefined) delete process.env['REVALIDATE_SECRET'];
  else process.env['REVALIDATE_SECRET'] = ORIGINAL_ENV.secret;
});

describe('cms storefront revalidation', () => {
  it.each<[string, CmsContentChange, string[]]>([
    [
      'a page',
      { kind: 'page', slugs: ['about'] },
      [CMS_STOREFRONT_CACHE_TAGS.page('about'), CMS_STOREFRONT_CACHE_TAGS.pageIndex],
    ],
    [
      'a block',
      { kind: 'block', codes: ['hero'] },
      [
        CMS_STOREFRONT_CACHE_TAGS.block('hero'),
        CMS_STOREFRONT_CACHE_TAGS.pages,
        CMS_STOREFRONT_CACHE_TAGS.hooks,
      ],
    ],
    ['a template', { kind: 'template' }, [CMS_STOREFRONT_CACHE_TAGS.pages]],
    [
      'a hook',
      { kind: 'hook', codes: ['home.top'] },
      [CMS_STOREFRONT_CACHE_TAGS.hook('home.top')],
    ],
  ])('posts the tags %s change makes stale', async (_name, change, tags) => {
    const { emit, fetchSpy } = build(true, { storefront: 'http://storefront:3010', secret: 'sekret' });

    emit(change);
    await settle();

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(postedTags(fetchSpy)).toEqual(tags);
  });

  // R19C (T271): the handler hands its request back to the bus, so a write that
  // dispatches its change in a scope (`publishContentChange`) answers only once
  // the storefront has dropped the tags — the next request then reads the new content.
  it('lets a scoped dispatch wait until the storefront has answered', async () => {
    const { emit, fetchSpy, bus } = build(true, {
      storefront: 'http://storefront:3010',
      secret: 'sekret',
    });
    let answer!: () => void;
    fetchSpy.mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          answer = () => resolve(new Response(null, { status: 200 }));
        }),
    );
    let done = false;
    const dispatched = bus
      .run(async () => {
        emit({ kind: 'page', slugs: ['about'] });
      })
      .then(() => {
        done = true;
      });
    await settle();
    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(done).toBe(false);
    answer();
    await dispatched;
    expect(done).toBe(true);
  });

  it('stays a no-op when the storefront revalidate endpoint is not configured', async () => {
    const { emit, fetchSpy } = build(true);

    emit({ kind: 'page', slugs: ['about'] });
    await settle();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not reach the storefront at all while the module is off', async () => {
    const { emit, fetchSpy } = build(false, { storefront: 'http://storefront:3010', secret: 'sekret' });

    emit({ kind: 'page', slugs: ['about'] });
    await settle();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

/**
 * Issue #363 — a cached CMS answer (a page, a block, a hook) carries the URL of
 * every asset it embeds, `?v=<contentVersion>` included, so an asset write
 * leaves it stale. `assets_library` announces the write on the bus; `cms`
 * answers by dropping its Redis entries, *then* asking the storefront to drop
 * the Data Cache entries in front of them — and does nothing while it is off
 * (Constitution XVII). The CMS learns of the write only through the event, so
 * an `assets_library` that is absent simply never announces anything.
 */

function buildForAssets(present: boolean): {
  emit: (assetIds: string[]) => void;
  log: string[];
  bus: EventBus;
} {
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

  const bus = compose(present, {
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
  }).eventBus;

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

describe('cms answers an asset write (issue #363)', () => {
  it('drops every cached CMS answer, then the storefront entries in front of them', async () => {
    const { bus, log } = buildForAssets(true);

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
    const { emit, log } = buildForAssets(false);

    emit(['a-1']);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(log).toEqual([]);
  });
});
