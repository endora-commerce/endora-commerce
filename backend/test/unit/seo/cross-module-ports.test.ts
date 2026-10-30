import type { EntityManager } from '@mikro-orm/postgresql';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  CatalogCategoryReadPort,
  CatalogCategoryRecord,
  CatalogProductReadPort,
  CatalogProductRecord,
  ChannelMemberEntityType,
  CmsPageReadPort,
  CmsPageRecord,
} from '@endora-commerce/contracts';
import type { SalesChannelMembershipPort } from '@endora-commerce/platform/kernel';
import { MetaTagResolverService } from '../../../../packages/modules/seo/src/backend/services/meta-tag-resolver.service.js';
import { SitemapGeneratorService } from '../../../../packages/modules/seo/src/backend/services/sitemap-generator.service.js';
import { StorefrontAddressService } from '../../../../packages/modules/seo/src/backend/services/storefront-address.service.js';

/**
 * Feature 075, Phase C — `seo` asks `catalog` and `cms` for their rows, and
 * the sales-channel bridge for its memberships (FR-012, Constitution XII).
 *
 * Six edges were `em.find(<their entity>, …)` written from inside this module,
 * which is the shape Principle XVII cannot gate: deactivation drops no tables,
 * so the sitemap kept advertising product, category and CMS URLs, and the
 * meta-tag resolver kept describing them, out of modules an operator had
 * switched off. A seventh read was invisible even to the ratchet: three raw
 * `SELECT`s against `sales_channel_products`, `sales_channel_categories` and
 * `sales_channel_cms_pages` — no import specifier, so nothing could see them.
 *
 * These cases assert the demand rather than the plumbing: an `EntityManager`
 * that **refuses** to serve a foreign entity or a foreign table, plus stub
 * ports, must be enough. A fake that would notice the old query is what makes
 * the test able to fail.
 */

const CHANNEL = {
  id: 'chan-1',
  code: 'web',
  name: { 'en-US': 'Web' },
  defaultLanguage: 'en-US',
  languages: ['en-US', 'pl-PL', 'de-DE'],
  prefixDefaultLanguage: true,
  active: true,
  systemDefault: true,
};

function productRecord(
  id: string,
  overrides: Partial<CatalogProductRecord> = {},
): CatalogProductRecord {
  return {
    id,
    sku: `SKU-${id}`,
    slug: `slug-${id}`,
    type: 'simple',
    status: 'active',
    name: `Product ${id}`,
    description: `About ${id}`,
    stockMode: null,
    visibility: 'public',
    attributeValues: {},
    allowedOrganizationIds: [],
    attributeSetId: 'set-1',
    downloadAssetId: null,
    downloadUrl: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    archivedAt: null,
    deletedAt: null,
    manageStock: false,
    backorderEnabled: false,
    lowStockThreshold: null,
    lowStockThresholdMode: 'cumulative',
    fulfilmentStrategy: null,
    fulfilmentStrategyWarehouseOrder: null,
    minOrderQuantity: null,
    returnable: false,
    ...overrides,
  };
}

function categoryRecord(
  id: string,
  overrides: Partial<CatalogCategoryRecord> = {},
): CatalogCategoryRecord {
  return {
    id,
    parentCategoryId: null,
    name: { 'en-US': `Category ${id}` },
    slug: `cat-${id}`,
    sortOrder: 0,
    metaTitleOverride: null,
    metaDescriptionOverride: null,
    customFieldValues: {},
    isActive: true,
    inventoryThresholdHigh: null,
    inventoryThresholdMedium: null,
    inventoryThresholdLow: null,
    mainImageAssetId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function pageRecord(id: string, overrides: Partial<CmsPageRecord> = {}): CmsPageRecord {
  return {
    id,
    path: `legacy-${id}`,
    slug: `page-${id}`,
    status: 'published',
    name: `Page ${id}`,
    active: true,
    title: { 'en-US': `Legacy title ${id}` },
    metaTitle: null,
    metaDescription: null,
    metaKeywords: null,
    publishedAt: new Date('2026-01-01T00:00:00.000Z'),
    archivedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    // Feature 163 (T080): the record carries the breadcrumb parent.
    parentPageId: null,
    ...overrides,
  };
}

/**
 * An `EntityManager` that serves this module's own rows and the kernel's
 * `SalesChannel`, and refuses everything else — including a raw connection,
 * because the membership read used to go around the ORM entirely.
 */
function fakeEm(handlers: Record<string, unknown>): () => EntityManager {
  const dispatch = (entity: { name?: string }, fallback: unknown): unknown => {
    const name = entity.name ?? '(anonymous)';
    if (!(name in handlers)) {
      throw new Error(`seo queried '${name}' directly — that row belongs to another module`);
    }
    return handlers[name] ?? fallback;
  };
  const em = {
    findOne: async (entity: { name?: string }) => dispatch(entity, null),
    find: async (entity: { name?: string }) => dispatch(entity, []),
    create: (_entity: unknown, data: Record<string, unknown>) => ({ id: 'row-1', ...data }),
    persist: () => undefined,
    persistAndFlush: async () => undefined,
    flush: async () => undefined,
    getConnection: () => ({
      execute: async (sql: string) => {
        throw new Error(`seo ran raw SQL against another module's table: ${sql}`);
      },
    }),
  };
  return () => em as unknown as EntityManager;
}

const refusing = (module: string): never =>
  ((new Proxy(
    {},
    {
      get: (_target, property) => () => {
        throw new Error(`seo unexpectedly called ${module}.${String(property)}`);
      },
    },
  ) as unknown) as never);

describe('seo — the meta-tag rule sources arrive over published read ports', () => {
  it('reads the product through catalogProductReadPort, never the catalog table', async () => {
    const asked: string[] = [];
    const catalogProducts = {
      findById: async (id: string) => {
        asked.push(id);
        return productRecord(id);
      },
    } as unknown as CatalogProductReadPort;

    const service = new MetaTagResolverService(
      fakeEm({ SeoMetaOverride: null }),
      // A read: the bus (feature 163 — writes are Commands) and the membership are never reached.
      refusing('command bus'),
      catalogProducts,
      refusing('catalog categories'),
      refusing('cms'),
      refusing('sales channel membership'),
    );

    const meta = await service.resolve({
      entityType: 'product',
      entityId: 'prod-1',
      locale: 'en-US',
    });

    expect(asked).toEqual(['prod-1']);
    expect(meta.title).toBe('Product prod-1');
    expect(meta.source).toBe('rule');
  });

  it('asks the category port for a live row and still refuses a deactivated one', async () => {
    const options: Array<{ liveOnly?: boolean } | undefined> = [];
    const catalogCategories = {
      findById: async (_id: string, opts?: { liveOnly?: boolean }) => {
        options.push(opts);
        return categoryRecord('cat-1', { isActive: false });
      },
    } as unknown as CatalogCategoryReadPort;

    const service = new MetaTagResolverService(
      fakeEm({ SeoMetaOverride: null }),
      // A read: the bus (feature 163 — writes are Commands) and the membership are never reached.
      refusing('command bus'),
      refusing('catalog products'),
      catalogCategories,
      refusing('cms'),
      refusing('sales channel membership'),
    );

    await expect(
      service.resolve({ entityType: 'category', entityId: 'cat-1', locale: 'en-US' }),
    ).rejects.toMatchObject({ statusCode: 404 });
    expect(options).toEqual([{ liveOnly: true }]);
  });

  it('falls back to the page name, which the record now carries', async () => {
    const cmsPages = {
      findById: async (id: string) => pageRecord(id, { name: 'About us' }),
    } as unknown as CmsPageReadPort;

    const service = new MetaTagResolverService(
      fakeEm({ SeoMetaOverride: null }),
      // A read: the bus (feature 163 — writes are Commands) and the membership are never reached.
      refusing('command bus'),
      refusing('catalog products'),
      refusing('catalog categories'),
      cmsPages,
      refusing('sales channel membership'),
    );

    const meta = await service.resolve({
      entityType: 'cms_page',
      entityId: 'page-1',
      locale: 'en-US',
    });

    // Not the entity's `@deprecated` `title` map, which is what the record
    // carried before this cut and would have silently become the answer.
    expect(meta.title).toBe('About us');
  });
});

describe('seo — the sitemap reads memberships through the sanctioned bridge accessor', () => {
  // `SitemapGeneratorService` resolves its base URL setting -> env -> fallback, and the
  // `baseUrl` option feeds only the last of the three. `backend/.env` sets
  // `STOREFRONT_BASE_URL`, so under the complete config the env step outranks the option
  // these cases inject and every asserted URL comes back on `localhost:3000` instead.
  // The cases passed under `test:unit:fast` alone, which loads no `.env` — a green that
  // meant "this variable happens to be unset here" rather than "the option is honoured".
  // Emptying it is what makes these unit cases answer about the option they set.
  beforeEach(() => {
    vi.stubEnv('STOREFRONT_BASE_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function membershipStub(
    members: Partial<Record<ChannelMemberEntityType, string[]>>,
    seen: ChannelMemberEntityType[],
  ): SalesChannelMembershipPort {
    return {
      listEntityIdsForChannel: async (
        _channelId: string,
        entityType: ChannelMemberEntityType,
        page = 0,
        pageSize = 100,
      ) => {
        seen.push(entityType);
        const all = members[entityType] ?? [];
        return { entityIds: all.slice(page * pageSize, (page + 1) * pageSize), total: all.length };
      },
    } as unknown as SalesChannelMembershipPort;
  }

  it('builds URLs from the ports, filtering exactly what the SQL filtered', async () => {
    const seen: ChannelMemberEntityType[] = [];
    const membership = membershipStub(
      {
        product: ['p-live', 'p-private'],
        category: ['c-live', 'c-off'],
        'cms-page': ['pg-live', 'pg-off'],
      },
      seen,
    );

    const catalogProducts = {
      findByIds: async (ids: readonly string[], opts?: Record<string, boolean>) => {
        // Feature 163 — no status narrowing in the read: availability is `catalog`'s answer.
        expect(opts).toEqual({ liveOnly: true });
        return ids.map((id) =>
          id === 'p-private'
            ? productRecord(id, { visibility: 'logged_in_only' })
            : productRecord(id, { slug: 'live-product' }),
        );
      },
    } as unknown as CatalogProductReadPort;

    const catalogCategories = {
      findByIds: async (ids: readonly string[], opts?: Record<string, boolean>) => {
        expect(opts).toEqual({ liveOnly: true });
        return ids.map((id) =>
          id === 'c-off'
            ? categoryRecord(id, { isActive: false })
            : categoryRecord(id, { slug: 'live-category' }),
        );
      },
    } as unknown as CatalogCategoryReadPort;

    const cmsPages = {
      findByIds: async (ids: readonly string[]) =>
        ids.map((id) =>
          id === 'pg-off'
            ? pageRecord(id, { active: false })
            : // Feature 167 — the page exists in two of the channel's three languages.
              pageRecord(id, {
                slug: 'live-page',
                languages: ['en-US', 'pl-PL'],
                // 163 R24: the page's own slug in Polish.
                translations: { 'pl-PL': { slug: 'zywa-strona' } },
              }),
        ),
    } as unknown as CmsPageReadPort;

    const service = new SitemapGeneratorService(
      fakeEm({ SalesChannel: CHANNEL, SitemapCache: null }),
      new StorefrontAddressService(null, { fallbackUrl: 'https://shop.test' }),
      membership,
      catalogProducts,
      catalogCategories,
      cmsPages,
      // Feature 163 — the anonymous crawler's answer per member: the private
      // product's channel-effective rule is `logged_in_only`.
      {
        describeChannelAvailability: async (ids: readonly string[]) =>
          new Map(
            ids.map((id) => [
              id,
              {
                liveLanguages: ['en-US'],
                window: { from: null, until: null },
                audience: {
                  visibility: id === 'p-private' ? ('logged_in_only' as const) : ('public' as const),
                  allowedOrganizationIds: [],
                },
              },
            ]),
          ),
      },
      // Feature 163 (T112) — no URL-key rows: every key is the product's global key.
      { effectiveKeys: async () => new Map() },
      { baseUrl: 'https://shop.test', staleAfterMs: 0 },
    );

    const { payload } = await service.regenerateForChannel('web');

    expect(seen.sort()).toEqual(['category', 'cms-page', 'product']);
    expect(payload).toContain('https://shop.test/en/p/live-product');
    // Feature 167 (FR-032) — a category per channel language, under its prefix.
    for (const prefix of ['en', 'pl', 'de']) expect(payload).toContain(`https://shop.test/${prefix}/c/live-category`);
    expect(payload).not.toContain('https://shop.test/c/live-category');
    // The CMS URL comes from `slug`, not from the entity's deprecated `path` — per
    // language the page has that the channel serves.
    expect(payload).toContain('https://shop.test/en/live-page');
    // R24: each language at its own slug.
    expect(payload).toContain('https://shop.test/pl/zywa-strona');
    expect(payload).not.toContain('https://shop.test/pl/live-page');
    expect(payload).not.toContain('https://shop.test/de/live-page');
    expect(payload).not.toContain('lang=');
    expect(payload).not.toContain('legacy-');
    // The three excluded rows produce no URL at all.
    expect(payload).not.toContain('slug-p-private');
    expect(payload).not.toContain('cat-c-off');
    expect(payload).not.toContain('page-pg-off');
  });

  it('walks every page of members, not only the first', async () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `p-${i}`);
    const seen: ChannelMemberEntityType[] = [];
    const membership = membershipStub({ product: ids }, seen);

    let received = 0;
    const catalogProducts = {
      findByIds: async (given: readonly string[]) => {
        received = given.length;
        return [];
      },
    } as unknown as CatalogProductReadPort;

    const service = new SitemapGeneratorService(
      fakeEm({ SalesChannel: CHANNEL, SitemapCache: null }),
      new StorefrontAddressService(null, { fallbackUrl: 'https://shop.test' }),
      membership,
      catalogProducts,
      { findByIds: async () => [] } as unknown as CatalogCategoryReadPort,
      { findByIds: async () => [] } as unknown as CmsPageReadPort,
      { describeChannelAvailability: async () => new Map() },
      { effectiveKeys: async () => new Map() },
      { baseUrl: 'https://shop.test', staleAfterMs: 0 },
    );

    await service.regenerateForChannel('web');

    expect(received).toBe(1200);
  });

  it('emits one URL per live language with the effective key there, prefixed, never ?lang= (163 T112, FR-074; 167 FR-031)', async () => {
    const membership = membershipStub({ product: ['p-1'] }, []);
    const askedFor: Array<{ ids: readonly string[]; channelId: string }> = [];
    const service = new SitemapGeneratorService(
      fakeEm({ SalesChannel: CHANNEL, SitemapCache: null }),
      new StorefrontAddressService(null, { fallbackUrl: 'https://shop.test' }),
      membership,
      {
        findByIds: async (ids: readonly string[]) => ids.map((id) => productRecord(id, { slug: 'drill' })),
      } as unknown as CatalogProductReadPort,
      { findByIds: async () => [] } as unknown as CatalogCategoryReadPort,
      { findByIds: async () => [] } as unknown as CmsPageReadPort,
      {
        describeChannelAvailability: async (ids: readonly string[]) =>
          new Map(
            ids.map((id) => [
              id,
              {
                // Live in en-US and pl-PL; de-DE is off, so it gets no URL even with a key.
                liveLanguages: ['en-US', 'pl-PL'],
                window: { from: null, until: null },
                audience: { visibility: 'public' as const, allowedOrganizationIds: [] },
              },
            ]),
          ),
      },
      {
        effectiveKeys: async (ids: readonly string[], channelId: string) => {
          askedFor.push({ ids, channelId });
          return new Map([
            ['p-1', new Map([['en-US', 'drill'], ['pl-PL', 'wiertarka'], ['de-DE', 'bohrer']])],
          ]);
        },
      },
      { baseUrl: 'https://shop.test', staleAfterMs: 0 },
    );

    const { payload } = await service.regenerateForChannel('web');

    expect(askedFor).toEqual([{ ids: ['p-1'], channelId: 'chan-1' }]);
    expect(payload).toContain('<loc>https://shop.test/en/p/drill</loc>');
    expect(payload).toContain('<loc>https://shop.test/pl/p/wiertarka</loc>');
    expect(payload).not.toContain('bohrer');
    expect(payload).not.toContain('lang=');
  });
});
