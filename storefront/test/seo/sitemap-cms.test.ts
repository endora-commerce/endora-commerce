import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The sitemap's CMS source — `specs/105-cms-root-page-urls/` FR-020…FR-022,
 * US3; `contracts/cms-page-url.md` §4.1 and §4.3.
 *
 * Before Phase 3 the shop advertised **no CMS URL at all**: `sitemap.ts` emitted
 * its five static URLs and three dynamic sources, and no CMS page reached any
 * crawler. `SITEMAP_DYNAMIC_ROUTES` named `/[...slug]` throughout, which is a
 * declaration of the route *pattern* for `check:storefront-indexability`'s
 * reconciliation and says nothing about the rows behind it — so the check was
 * green while the population it stands for was empty. That gap is what these
 * cases hold closed.
 *
 * Every collaborator is stubbed, `sitemap()` is called for real, and the
 * assertions are over the URLs it returns. The three other dynamic sources are
 * stubbed to nothing so a failure names the CMS source rather than a product
 * fixture.
 */

const listProducts = vi.fn();
const getCategoryTree = vi.fn();
const getBlogIndex = vi.fn();
const getCmsPageIndex = vi.fn();
const getHomepageConfig = vi.fn();

vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ ctx: { locale: 'en-US' } }),
}));
vi.mock('../../lib/api/catalog', () => ({
  listProducts: (...args: unknown[]) => listProducts(...args),
  getCategoryTree: (...args: unknown[]) => getCategoryTree(...args),
}));
vi.mock('../../lib/api/blog', () => ({
  getBlogIndex: (...args: unknown[]) => getBlogIndex(...args),
}));
// `normalizeCmsUrlPath` is the **real** one: the sitemap compares the home-page
// slug an operator typed against the slugs the backend returned, and a stubbed
// normalizer would make that comparison agree with itself.
vi.mock('../../lib/api/cms', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/api/cms')>()),
  getCmsPageIndex: (...args: unknown[]) => getCmsPageIndex(...args),
}));
vi.mock('../../lib/api/homepage', () => ({
  getHomepageConfig: (...args: unknown[]) => getHomepageConfig(...args),
}));

const ORIGIN = 'https://shop.example.com';

async function sitemapUrls(): Promise<string[]> {
  const { default: sitemap } = await import('../../app/sitemap');
  const entries = await sitemap();
  return entries.map((entry) => entry.url);
}

describe('the sitemap tells crawlers the CMS pages exist', () => {
  beforeEach(() => {
    process.env['NEXT_PUBLIC_SITE_URL'] = ORIGIN;
    listProducts.mockResolvedValue({ data: [], pagination: { hasMore: false, nextCursor: null } });
    getCategoryTree.mockResolvedValue([]);
    getBlogIndex.mockResolvedValue(null);
    getCmsPageIndex.mockResolvedValue({
      pages: [
        { slug: 'dostawa', updatedAt: '2026-09-01T10:00:00.000Z' },
        { slug: 'pomoc/zwroty', updatedAt: '2026-09-02T10:00:00.000Z' },
      ],
    });
    getHomepageConfig.mockResolvedValue({ cmsPageSlug: null });
  });

  afterEach(() => {
    delete process.env['NEXT_PUBLIC_SITE_URL'];
    vi.clearAllMocks();
  });

  it('carries one absolute URL per published page, at its root address (US3.1)', async () => {
    const urls = await sitemapUrls();

    expect(urls).toContain(`${ORIGIN}/dostawa`);
    // A slug may carry a `/` — `cmsSlugRe` permits it and the route is a
    // catch-all — so one page lives at `/pomoc/zwroty` and is not a page under
    // a section (contract §1).
    expect(urls).toContain(`${ORIGIN}/pomoc/zwroty`);
    expect(urls).not.toContain(`${ORIGIN}/cms/dostawa`);
  });

  it('carries the home page as `/` and never as its slug address (US3.2)', async () => {
    getHomepageConfig.mockResolvedValue({ cmsPageSlug: 'dostawa' });

    const urls = await sitemapUrls();

    // `/` is already advertised as a static route; what must not happen is the
    // slug address appearing beside it, because that URL answers a permanent
    // redirect (§1.3) and a sitemap never advertises a URL that redirects.
    expect(urls).toContain(`${ORIGIN}/`);
    expect(urls).not.toContain(`${ORIGIN}/dostawa`);
    expect(urls).toContain(`${ORIGIN}/pomoc/zwroty`);
  });

  it('is short rather than a 500 when the backend cannot answer (US3.3)', async () => {
    getCmsPageIndex.mockRejectedValue(new Error('connect ECONNREFUSED'));

    const urls = await sitemapUrls();

    expect(urls).toContain(`${ORIGIN}/`);
    expect(urls).not.toContain(`${ORIGIN}/dostawa`);
  });

  it('advertises no CMS URL while the module is off, and still serves (US3.4)', async () => {
    // A switched-off `cms` answers `null` through `isModuleDisabled`, exactly as
    // `blog`'s index does: the module is absent, so the shop advertises no CMS
    // URL — the correct sitemap rather than a degraded one (§4.3).
    getCmsPageIndex.mockResolvedValue(null);

    const urls = await sitemapUrls();

    expect(urls).toContain(`${ORIGIN}/`);
    expect(urls).toContain(`${ORIGIN}/catalog`);
    expect(urls).not.toContain(`${ORIGIN}/dostawa`);
  });

  it('does not ask the CMS a second time for the home-page slug', async () => {
    // One index read and one homepage read per sitemap build. The home page is
    // decided from the config the storefront already fetches for every content
    // page, not by resolving the row again.
    await sitemapUrls();

    expect(getCmsPageIndex).toHaveBeenCalledTimes(1);
    expect(getHomepageConfig).toHaveBeenCalledTimes(1);
  });
});
