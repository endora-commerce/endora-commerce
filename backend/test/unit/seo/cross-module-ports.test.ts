import type { EntityManager } from '@mikro-orm/postgresql';
import { describe, expect, it } from 'vitest';
import type {
  CatalogCategoryReadPort,
  CatalogCategoryRecord,
  CatalogProductReadPort,
  CatalogProductRecord,
  ChannelMemberEntityType,
  CmsPageReadPort,
  CmsPageRecord,
} from '@endora-commerce/contracts';
import type { SalesChannelMembershipPort } from '../../../src/kernel/ports/sales-channel.js';
import { MetaTagResolverService } from '../../../src/modules/seo/services/meta-tag-resolver.service.js';
import { SitemapGeneratorService } from '../../../src/modules/seo/services/sitemap-generator.service.js';

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
    name: { 'en-US': `Product ${id}` },
    description: { 'en-US': `About ${id}` },
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
      undefined,
      catalogProducts,
      refusing('catalog categories'),
      refusing('cms'),
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
      undefined,
      refusing('catalog products'),
      catalogCategories,
      refusing('cms'),
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
      undefined,
      refusing('catalog products'),
      refusing('catalog categories'),
      cmsPages,
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
        expect(opts).toEqual({ liveOnly: true, activeOnly: true });
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
          id === 'pg-off' ? pageRecord(id, { active: false }) : pageRecord(id, { slug: 'live-page' }),
        ),
    } as unknown as CmsPageReadPort;

    const service = new SitemapGeneratorService(
      fakeEm({ SalesChannel: CHANNEL, SitemapCache: null }),
      null,
      membership,
      catalogProducts,
      catalogCategories,
      cmsPages,
      { baseUrl: 'https://shop.test', staleAfterMs: 0 },
    );

    const { payload } = await service.regenerateForChannel('web');

    expect(seen.sort()).toEqual(['category', 'cms-page', 'product']);
    expect(payload).toContain('https://shop.test/p/live-product');
    expect(payload).toContain('https://shop.test/c/live-category');
    // The CMS URL comes from `slug`, not from the entity's deprecated `path`.
    expect(payload).toContain('https://shop.test/live-page');
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
      null,
      membership,
      catalogProducts,
      { findByIds: async () => [] } as unknown as CatalogCategoryReadPort,
      { findByIds: async () => [] } as unknown as CmsPageReadPort,
      { baseUrl: 'https://shop.test', staleAfterMs: 0 },
    );

    await service.regenerateForChannel('web');

    expect(received).toBe(1200);
  });
});
