import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Pagination } from '@endora-commerce/contracts';

/**
 * The sitemap's product source walks a cursor-paginated endpoint, and a loop
 * over a remote list has to end whatever the remote says.
 *
 * It read a pagination field the API never sends, so the cursor it sent back
 * was always the first page's: a shop with three hundred products advertised
 * its first hundred fifty times over and none of the rest. Worse, the loop's
 * only other exit was "enough URLs collected" — so a first page that came back
 * empty while reporting more to come never ended at all, and because the
 * answer is served from the data cache the loop never yielded to I/O either.
 * One request for `/sitemap.xml` then stopped the storefront answering anybody.
 *
 * Every page below has the shape the published contract gives it
 * (`paginationSchema` in `@endora-commerce/contracts`): `cursor`, `hasMore`,
 * `limit`. Each case that used to spin is guarded by a call ceiling inside the
 * stub, so a regression fails the assertion instead of hanging the run.
 */

const listProducts = vi.fn();

vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ ctx: { locale: 'en-US' } }),
}));
vi.mock('../../lib/api/catalog', () => ({
  listProducts: (...args: unknown[]) => listProducts(...args),
  getCategoryTree: async () => [],
}));
vi.mock('../../lib/api/blog', () => ({ getBlogIndex: async () => null }));
vi.mock('../../lib/api/cms', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/cms')>()),
  getCmsPageIndex: async () => null,
}));
vi.mock('../../lib/api/homepage', () => ({
  getHomepageConfig: async () => ({ cmsPageSlug: null }),
}));

const ORIGIN = 'https://shop.example.com';

/** Far above anything a correct walk needs, far below "the run hangs". */
const RUNAWAY_CALLS = 2000;

interface Page {
  data: { slug: string }[];
  pagination: Pagination;
}

function page(slugs: string[], cursor: string | null, hasMore = cursor !== null): Page {
  return { data: slugs.map((slug) => ({ slug })), pagination: { cursor, hasMore, limit: 100 } };
}

/** Answer by the cursor asked for; refuse to be called without end. */
function serve(pages: Record<string, Page>): void {
  listProducts.mockImplementation(async (query: { cursor?: string }) => {
    if (listProducts.mock.calls.length > RUNAWAY_CALLS) {
      throw new Error('the product walk did not terminate');
    }
    const answer = pages[query.cursor ?? 'first'];
    if (answer === undefined) throw new Error(`unexpected cursor ${String(query.cursor)}`);
    return answer;
  });
}

async function productUrls(): Promise<string[]> {
  const { default: sitemap } = await import('../../app/sitemap');
  const entries = await sitemap();
  return entries.map((entry) => entry.url).filter((url) => url.startsWith(`${ORIGIN}/p/`));
}

function cursorsAsked(): (string | undefined)[] {
  return listProducts.mock.calls.map(([query]) => (query as { cursor?: string }).cursor);
}

describe('the sitemap walks the product list once and always finishes', () => {
  beforeEach(() => {
    process.env['NEXT_PUBLIC_SITE_URL'] = ORIGIN;
  });

  afterEach(() => {
    delete process.env['NEXT_PUBLIC_SITE_URL'];
    vi.clearAllMocks();
  });

  it('asks for each of three pages once, in order, by the cursor the API returned', async () => {
    serve({
      first: page(['a1', 'a2'], 'c2'),
      c2: page(['b1', 'b2'], 'c3'),
      c3: page(['c1'], null),
    });

    const urls = await productUrls();

    expect(cursorsAsked()).toEqual([undefined, 'c2', 'c3']);
    expect(urls).toEqual(['a1', 'a2', 'b1', 'b2', 'c1'].map((slug) => `${ORIGIN}/p/${slug}`));
  });

  it('finishes when the first page is empty and still reports more to come', async () => {
    // No cursor to follow: the answer is self-contradictory, and the only
    // thing asking again could return is the same answer.
    serve({ first: page([], null, true) });

    expect(await productUrls()).toEqual([]);
    expect(listProducts).toHaveBeenCalledTimes(1);
  });

  it('follows the cursor past an empty page, because the API filters after it pages', async () => {
    // The list endpoint applies sales-channel membership to a page it has
    // already cut, so a page of rows none of which belongs to this channel is
    // empty, reports more, and carries a cursor that does advance.
    serve({
      first: page([], 'c2'),
      c2: page(['b1'], null),
    });

    expect(await productUrls()).toEqual([`${ORIGIN}/p/b1`]);
    expect(cursorsAsked()).toEqual([undefined, 'c2']);
  });

  it('finishes when the API hands back the cursor it was asked with', async () => {
    serve({
      first: page(['a1'], 'c2'),
      c2: page(['b1'], 'c2'),
    });

    expect(await productUrls()).toEqual([`${ORIGIN}/p/a1`, `${ORIGIN}/p/b1`]);
    expect(cursorsAsked()).toEqual([undefined, 'c2']);
  });

  it('finishes when every page is empty and every cursor is new', async () => {
    // Nothing above stops this one: the cursor always advances and no URL is
    // ever collected. Only a ceiling on the number of pages asked for does.
    let served = 0;
    listProducts.mockImplementation(async () => {
      served += 1;
      if (served > RUNAWAY_CALLS) throw new Error('the product walk did not terminate');
      return page([], `c${served}`);
    });

    expect(await productUrls()).toEqual([]);
    expect(served).toBeLessThanOrEqual(200);
  });

  it('never lists a product twice', async () => {
    serve({
      first: page(['a1', 'a2'], 'c2'),
      c2: page(['a2', 'b1'], 'c3'),
      c3: page(['a1'], null),
    });

    const urls = await productUrls();

    expect(new Set(urls).size).toBe(urls.length);
    expect(urls).toEqual(['a1', 'a2', 'b1'].map((slug) => `${ORIGIN}/p/${slug}`));
  });
});
