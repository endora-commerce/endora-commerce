import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CMS_CONTENT_CHANGED_EVENT,
  CMS_STOREFRONT_CACHE_TAGS,
  type CmsContentChange,
} from '@endora-commerce/contracts';
import {
  createModuleContext,
  createModuleRegistrationSink,
  createRootContainer,
  registryCache,
} from '@endora-commerce/platform/composition';
import { EventBus } from '@endora-commerce/platform/events';
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

function build(env: { storefront?: string; secret?: string } = {}): {
  emit: (change: CmsContentChange) => void;
  fetchSpy: FetchSpy;
} {
  if (env.storefront === undefined) delete process.env['STOREFRONT_BASE_URL'];
  else process.env['STOREFRONT_BASE_URL'] = env.storefront;
  if (env.secret === undefined) delete process.env['REVALIDATE_SECRET'];
  else process.env['REVALIDATE_SECRET'] = env.secret;

  const fetchSpy = vi
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(new Response(null, { status: 200 })) as unknown as FetchSpy;
  const bus = new EventBus();
  const ctx = createModuleContext({
    module: { id: MODULE_ID, version: '1.0.0' },
    container: createRootContainer(),
    eventBus: bus,
    sink: createModuleRegistrationSink(),
    log: { info: () => {}, warn: () => {}, error: () => {} },
  });
  registerModule(ctx);

  return {
    emit: (change) =>
      bus.emit(CMS_CONTENT_CHANGED_EVENT, {
        eventId: 'e-1',
        occurredAt: new Date().toISOString(),
        ...change,
      } as never),
    fetchSpy,
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
  registryCache.__setEnabledForTesting([]);
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
    registryCache.__setEnabledForTesting([MODULE_ID]);
    const { emit, fetchSpy } = build({ storefront: 'http://storefront:3010', secret: 'sekret' });

    emit(change);
    await settle();

    expect(fetchSpy).toHaveBeenCalledOnce();
    expect(postedTags(fetchSpy)).toEqual(tags);
  });

  it('stays a no-op when the storefront revalidate endpoint is not configured', async () => {
    registryCache.__setEnabledForTesting([MODULE_ID]);
    const { emit, fetchSpy } = build();

    emit({ kind: 'page', slugs: ['about'] });
    await settle();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not reach the storefront at all while the module is off', async () => {
    registryCache.__setEnabledForTesting([]);
    const { emit, fetchSpy } = build({ storefront: 'http://storefront:3010', secret: 'sekret' });

    emit({ kind: 'page', slugs: ['about'] });
    await settle();

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
