import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  CMS_STOREFRONT_CACHE_TAGS,
  MEGAMENU_STOREFRONT_CACHE_TAG,
} from '@endora-commerce/contracts';
import { getBlogBySlug, getBlogIndex, getBlogTagByCode } from '../../lib/api/blog';
import type { RequestContext } from '../../lib/api/client';
import {
  getCmsBlockByCode,
  getCmsHookByCode,
  getCmsPageBySlug,
  getCmsPageIndex,
} from '../../lib/api/cms';
import { getActiveMegamenu } from '../../lib/api/megamenu';

/**
 * What the storefront lets Next's Data Cache keep of operator-edited content,
 * and under which names.
 *
 * The backend drops these entries **by tag** when a page, a block, a template
 * or a hook is saved (`cms`' content-change subscription, and `megamenu`'s for
 * the blocks a menu inlines). A fetch that carries a different spelling is
 * simply never dropped: the revalidation request answers 200 and the shopper
 * keeps reading the old page until the time window runs out, which is the
 * defect this file exists to hold shut. So every assertion compares against
 * the shared vocabulary in `@endora-commerce/contracts`, never against a
 * literal — the backend's tests assert the same names from the other side.
 *
 * The blog readers are asserted the other way round: they keep **nothing** in
 * the Data Cache, so there is no entry for a publish to leave stale and no tag
 * to drop. A `revalidate` window added there without a matching backend
 * revalidation would bring the delay back.
 */

interface RecordedCall {
  url: string;
  init: RequestInit & { next?: { revalidate?: number | false; tags?: string[] } };
}

const originalFetch = globalThis.fetch;
let calls: RecordedCall[] = [];

function stubFetch(body: unknown): void {
  calls = [];
  globalThis.fetch = vi.fn(async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: (init ?? {}) as RecordedCall['init'] });
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as unknown as typeof fetch;
}

const CTX: RequestContext = { salesChannelCode: 'pl_retail', locale: 'en-US' };

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('CMS reads carry the tags a content write revalidates', () => {
  it('tags a page read with every-page and with its own slug', async () => {
    stubFetch({ data: {} });
    await getCmsPageBySlug('About/Team', CTX);

    expect(calls[0]!.url).toContain('/api/v1/cms/pages/by-slug?slug=about%2Fteam');
    expect(calls[0]!.init.next?.tags).toEqual([
      CMS_STOREFRONT_CACHE_TAGS.pages,
      CMS_STOREFRONT_CACHE_TAGS.page('about/team'),
    ]);
  });

  it('tags a block read with every-block and with its own code', async () => {
    stubFetch({ data: {} });
    await getCmsBlockByCode('footer-links', CTX);

    expect(calls[0]!.init.next?.tags).toEqual([
      CMS_STOREFRONT_CACHE_TAGS.blocks,
      CMS_STOREFRONT_CACHE_TAGS.block('footer-links'),
    ]);
  });

  it('tags a hook read with every-hook and with its own code', async () => {
    stubFetch({ data: {} });
    await getCmsHookByCode('home.top', CTX);

    expect(calls[0]!.init.next?.tags).toEqual([
      CMS_STOREFRONT_CACHE_TAGS.hooks,
      CMS_STOREFRONT_CACHE_TAGS.hook('home.top'),
    ]);
  });

  it('tags the page index on its own, so a block save does not rebuild the sitemap source', async () => {
    stubFetch({ data: { pages: [] } });
    await getCmsPageIndex(CTX);

    expect(calls[0]!.url).toContain('/api/v1/cms/pages/by-channel');
    expect(calls[0]!.init.next?.tags).toEqual([CMS_STOREFRONT_CACHE_TAGS.pageIndex]);
  });
});

describe('the megamenu read carries the tag a menu or embedded-block write revalidates', () => {
  it('tags the resolved menu', async () => {
    stubFetch({ data: {} });
    await getActiveMegamenu(CTX);

    expect(calls[0]!.init.next?.tags).toEqual([MEGAMENU_STOREFRONT_CACHE_TAG]);
  });
});

describe('blog reads keep nothing in the Data Cache', () => {
  it.each([
    ['the index', () => getBlogIndex(CTX)],
    ['a post or category', () => getBlogBySlug('news', CTX, undefined)],
    ['a tag page', () => getBlogTagByCode('releases', CTX, undefined)],
  ])('%s is fetched no-store with no revalidate window', async (_name, read) => {
    stubFetch({ data: {} });
    await read();

    expect(calls[0]!.init.cache).toBe('no-store');
    expect(calls[0]!.init.next).toBeUndefined();
  });
});
