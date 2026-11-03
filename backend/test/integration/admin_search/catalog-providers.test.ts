import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Category, Product } from '../../helpers/package-entities.js';
import { createAttributeFixture } from '../../helpers/seed-catalog.js';
import {
  providerFor,
  providerQuery,
  runToken,
  searchAsPlatform,
} from '../../helpers/admin-search-fixtures.js';

/**
 * `specs/150-admin-global-search/` T047 — the Product and Category providers:
 * each field, a product's Global name (feature 170, FR-031: one string, shown
 * whatever the admin's language), a category name in any language shown in the
 * admin's, drafts and inactive
 * products found with their status, deleted ones never, quick-search
 * attributes limited to the flagged ones, and a category's parent path.
 */
describe('admin global search — Product and Category providers (spec 150)', () => {
  let h: BackendServerHandle;
  const T = runToken();
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    await createAttributeFixture(em, {
      key: `gs_flag_${T}`,
      label: { 'en-US': 'GS Flagged' },
      labelDefault: 'GS Flagged',
      valueType: 'string',
      quickSearchable: true,
    });
    await createAttributeFixture(em, {
      key: `gs_plain_${T}`,
      label: { 'en-US': 'GS Plain' },
      labelDefault: 'GS Plain',
      valueType: 'string',
    });
    const product = async (
      key: string,
      over: {
        sku: string;
        slug?: string;
        name?: string;
        status?: string;
        archivedAt?: Date;
        attributeValues?: Record<string, unknown>;
      },
    ) => {
      const row = em.create(Product, {
        sku: over.sku,
        slug: over.slug ?? `item-${Math.random().toString(36).slice(2, 12)}`,
        type: 'simple',
        status: (over.status ?? 'active') as never,
        name: over.name ?? 'Item',
        description: null,
        visibility: 'public',
        attributeValues: over.attributeValues ?? {},
        ...(over.archivedAt ? { archivedAt: over.archivedAt } : {}),
      } as never);
      await em.persistAndFlush(row);
      ids[key] = (row as { id: string }).id;
    };
    await product('sku', { sku: `SKU${T}-1` });
    await product('name', { sku: `N-${T}`, name: `Krzesło NAZWA${T}` });
    await product('slug', { sku: `S-${T}`, slug: `slug${T}-red` });
    await product('quickSearchAttributes', { sku: `F-${T}`, attributeValues: { [`gs_flag_${T}`]: `FLAG${T}` } });
    await product('plain', { sku: `P-${T}`, attributeValues: { [`gs_plain_${T}`]: `HIDDEN${T}` } });
    // Feature 163 — `draft` is gone; an archived product is listed like any other.
    await product('archived', { sku: `ST${T}-archived`, status: 'inactive', archivedAt: new Date() });
    await product('inactive', { sku: `ST${T}-inactive`, status: 'inactive' });
    await product('deleted', { sku: `ST${T}-deleted` });
    await em.nativeUpdate(Product, { id: ids['deleted']! }, { deletedAt: new Date() });
    await product('exact', { sku: `RK${T}` });
    await product('prefix', { sku: `RK${T}-2` });
    await product('contains', { sku: `X-RK${T}` });
    await product('wild', { sku: `WC${T}%_x` });
    await product('tame', { sku: `WC${T}ab` });

    const category = async (key: string, name: Record<string, string>, slug: string, parentCategoryId?: string) => {
      const row = em.create(Category, { name, slug, ...(parentCategoryId ? { parentCategoryId } : {}) } as never);
      await em.persistAndFlush(row);
      ids[key] = (row as { id: string }).id;
    };
    await category('root', { 'en-US': `Furniture ${T}`, 'pl-PL': `Meble ${T}` }, `furniture-${T}`);
    await category('mid', { 'en-US': 'Seating', 'pl-PL': 'Siedziska' }, `seating-${T}`, ids['root']);
    await category('leaf', { 'en-US': `Chairs CAT${T}`, 'pl-PL': `Krzesła CAT${T}` }, `chairs-${T}`, ids['mid']);
    await category('slugged', { 'en-US': 'Tables' }, `tables${T}`);
    await category('gone', { 'en-US': `GONE${T}` }, `gone-${T}`);
    await em.nativeUpdate(Category, { id: ids['gone']! }, { deletedAt: new Date() });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const product = () => providerFor(h, 'catalog.product');
  const category = () => providerFor(h, 'catalog.category');
  const productIds = async (text: string, fields: string[], over = {}) =>
    (await searchAsPlatform(product(), providerQuery(text, fields, over))).hits.map((hit) => hit.id);

  it.each([
    ['sku', `SKU${T}`],
    ['name', `NAZWA${T}`],
    ['slug', `slug${T}`],
    ['quickSearchAttributes', `FLAG${T}`],
  ])('matches %s alone, and only that product', async (field, text) => {
    expect(await productIds(text, [field])).toEqual([ids[field]]);
    const others = ['sku', 'name', 'slug', 'quickSearchAttributes'].filter((f) => f !== field);
    expect(await productIds(text, others)).toEqual([]);
  });

  it('matches only attributes flagged for quick search', async () => {
    expect(await productIds(`HIDDEN${T}`, ['sku', 'name', 'slug', 'quickSearchAttributes'])).toEqual([]);
  });

  it('matches the Global name and shows it whatever the admin’s language (170, FR-031)', async () => {
    const [en] = (await searchAsPlatform(product(), providerQuery(`NAZWA${T}`, ['name'], { language: 'en' }))).hits;
    expect(en?.title).toBe(`Krzesło NAZWA${T}`);
    const [pl] = (await searchAsPlatform(product(), providerQuery(`NAZWA${T}`, ['name'], { language: 'pl' }))).hits;
    expect(pl?.title).toBe(`Krzesło NAZWA${T}`);
    expect(pl?.targetRoute).toBe(`/catalog/products/${ids['name']}`);
  });

  it('finds inactive and archived products with their status, never a deleted one (FR-016)', async () => {
    const result = await searchAsPlatform(product(), providerQuery(`ST${T}`, ['sku'], { language: 'pl' }));
    const byId = new Map(result.hits.map((hit) => [hit.id, hit]));
    expect(byId.get(ids['archived']!)?.status).toEqual({ code: 'inactive', label: 'Nieaktywny' });
    expect(byId.get(ids['inactive']!)?.status).toEqual({ code: 'inactive', label: 'Nieaktywny' });
    expect(byId.has(ids['deleted']!)).toBe(false);
    expect(await productIds(ids['deleted']!, ['sku'])).toEqual([]);
  });

  it('ranks the exact SKU first, then the prefix; finds by id; matches wildcards literally; hasMore', async () => {
    expect(await productIds(`rk${T}`, ['sku'])).toEqual([ids['exact'], ids['prefix'], ids['contains']]);
    expect(await productIds(ids['sku']!, ['name'])).toEqual([ids['sku']]);
    expect(await productIds(`WC${T}%_`, ['sku'])).toEqual([ids['wild']]);
    const limited = await searchAsPlatform(product(), providerQuery(`RK${T}`, ['sku'], { limit: 2 }));
    expect(limited.hasMore).toBe(true);
  });

  it('matches a category by name in any language and by slug, with its parent path, never a deleted one', async () => {
    const [hit] = (await searchAsPlatform(category(), providerQuery(`CAT${T}`, ['name'], { language: 'pl' }))).hits;
    expect(hit).toEqual({
      id: ids['leaf'],
      title: `Krzesła CAT${T}`,
      subtitle: `Meble ${T} › Siedziska`,
      status: null,
      targetRoute: `/catalog/categories?focus=${ids['leaf']}`,
    });
    expect((await searchAsPlatform(category(), providerQuery(`tables${T}`, ['slug']))).hits.map((x) => x.id)).toEqual([
      ids['slugged'],
    ]);
    expect((await searchAsPlatform(category(), providerQuery(`tables${T}`, ['name']))).hits).toEqual([]);
    expect((await searchAsPlatform(category(), providerQuery(`GONE${T}`, ['name', 'slug']))).hits).toEqual([]);
    const [root] = (await searchAsPlatform(category(), providerQuery(`furniture-${T}`, ['slug']))).hits;
    expect(root?.subtitle).toBeNull();
  });
});
