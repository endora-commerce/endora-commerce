import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { Category, Product } from '../../helpers/package-entities.js';
import { SalesChannel } from '@endora-commerce/platform/kernel';

/**
 * Issue #151 — the storefront product list narrowed a page **after** cutting it.
 *
 * `listProducts`' default path (no price ordering, no price range, no search
 * engine) fetched `limit + 1` rows, read `hasMore` and the next cursor off that
 * cut, and only then applied sales-channel membership, the audience predicate,
 * the attribute filters and the category filter. A page whose rows were all
 * narrowed away was answered `data: []` with `hasMore: true`; one where some
 * were was simply short, and `limit` was not the page size anybody got.
 *
 * Real rows, because the defect is in which statement holds the predicate and a
 * stub cannot say:
 *
 *  - **block A** — the 100 newest products, bound to `pl_b2b_vip` only. The
 *    listing's default ordering is newest first, so the whole first page of a
 *    `limit=100` request for `pl_retail` is made of rows that channel may not
 *    see. This is the issue's own reproduction;
 *  - **block B** — the next 200, bound to `pl_retail`;
 *  - **block C** — 120 more on `pl_retail` in a category of their own, the
 *    newest 50 of them `logged_in_only`, for the audience axis;
 *  - **block D** — eight on `pl_retail` in a category of their own, one per
 *    JSON kind an attribute value takes, for the attribute comparison.
 *
 * Every third product (across A and B, so the channel and the category overlap
 * rather than partition) also sits in a child category, every fourth carries
 * `material = steel`, and every product in A and B sits in the parent category
 * — which is what lets the attribute assertions name an exact set while the
 * harness's own seeded products share the channel.
 *
 * Expectations are derived from the fixture list, never written as numbers: a
 * count typed here would be a second statement of the fixture.
 */

const RETAIL = { 'x-sales-channel': 'pl_retail' };
const SIGNED_IN = { b2b_session: 'stub-customer-session' };

const SKU_PREFIX = 'I151-';
const ALL_SLUG = 'i151-all';
const THIRD_SLUG = 'i151-third';
const AUDIENCE_SLUG = 'i151-audience';
const KINDS_SLUG = 'i151-kinds';

/**
 * Block D's `material` values. The listing compares `String(value)` with the
 * requested strings, and each of these is a kind `String` treats differently:
 * a one-element array reads as its element, a longer one as a comma-joined
 * list, and a JSON `null` as the word. The last entry carries no `material`
 * key at all.
 */
const KINDS: ReadonlyArray<{ material?: unknown }> = [
  { material: 'steel' },
  { material: ['steel'] },
  { material: ['steel', 'oak'] },
  { material: 5 },
  { material: true },
  { material: null },
  { material: 'plastic' },
  {},
];

/** Newest first: index 0 is the first row of the default ordering. */
const NEWEST = Date.parse('2031-01-01T00:00:00.000Z');

interface Fixture {
  index: number;
  sku: string;
  channel: 'pl_retail' | 'pl_b2b_vip';
  visibility: 'public' | 'logged_in_only';
  categories: string[];
  attributeValues: Record<string, unknown>;
}

const fixtures: Fixture[] = Array.from({ length: 420 + KINDS.length }, (_, index) => {
  const audienceBlock = index >= 300 && index < 420;
  if (index >= 420) {
    return {
      index,
      sku: `${SKU_PREFIX}${String(index).padStart(4, '0')}`,
      channel: 'pl_retail',
      visibility: 'public',
      categories: [KINDS_SLUG],
      attributeValues: { ...KINDS[index - 420] },
    };
  }
  return {
    index,
    sku: `${SKU_PREFIX}${String(index).padStart(4, '0')}`,
    channel: index < 100 ? 'pl_b2b_vip' : 'pl_retail',
    visibility: audienceBlock && index < 350 ? 'logged_in_only' : 'public',
    categories: audienceBlock
      ? [AUDIENCE_SLUG]
      : [ALL_SLUG, ...(index % 3 === 0 ? [THIRD_SLUG] : [])],
    attributeValues: { material: index % 4 === 0 ? 'steel' : 'plastic' },
  };
});

const isSteel = (f: Fixture): boolean => f.attributeValues['material'] === 'steel';

interface Page {
  skus: string[];
  hasMore: boolean;
  cursor: string | null;
}

async function walk(
  h: BackendServerHandle,
  query: string,
  limit: number,
  cookies?: Record<string, string>,
): Promise<Page[]> {
  const pages: Page[] = [];
  let cursor: string | null = null;
  // A bound on the walk, so a cursor that never ends fails the test instead of
  // hanging it.
  for (let guard = 0; guard < 60; guard++) {
    const url =
      `/api/v1/catalog/products?limit=${limit}` +
      (query === '' ? '' : `&${query}`) +
      (cursor === null ? '' : `&cursor=${encodeURIComponent(cursor)}`);
    const res = await h.app.inject({
      method: 'GET',
      url,
      headers: RETAIL,
      ...(cookies ? { cookies } : {}),
    });
    expect(res.statusCode, url).toBe(200);
    expect(res.headers['x-search-backend'], 'the default path is the subject').toBe('postgres');
    const body = res.json() as {
      data: Array<{ sku: string }>;
      pagination: { cursor: string | null; hasMore: boolean; limit: number };
    };
    expect(body.pagination.limit).toBe(limit);
    pages.push({
      skus: body.data.map((p) => p.sku),
      hasMore: body.pagination.hasMore,
      cursor: body.pagination.cursor,
    });
    if (!body.pagination.hasMore) return pages;
    expect(body.pagination.cursor, 'a page offering a next one names it').not.toBeNull();
    cursor = body.pagination.cursor;
  }
  throw new Error(`the walk over "${query}" did not end within 60 pages`);
}

/**
 * The page contract: every page before the last holds exactly `limit` rows and
 * offers a next one; the last offers none, issues no cursor and is not empty.
 * The last clause is the `hasMore` one — a page may only promise a successor
 * when another matching product exists.
 */
function expectFullPages(pages: Page[], limit: number): void {
  expect(pages.length).toBeGreaterThan(0);
  pages.forEach((page, i) => {
    const last = i === pages.length - 1;
    if (last) {
      expect(page.hasMore, `page ${i + 1} is the last`).toBe(false);
      expect(page.cursor, `page ${i + 1} is the last`).toBeNull();
      expect(page.skus.length, `page ${i + 1} is not empty`).toBeGreaterThan(0);
      expect(page.skus.length).toBeLessThanOrEqual(limit);
    } else {
      expect(page.skus.length, `page ${i + 1} of ${pages.length} is full`).toBe(limit);
      expect(page.hasMore, `page ${i + 1} of ${pages.length}`).toBe(true);
    }
  });
}

const skusOf = (rows: Fixture[]): string[] => rows.map((f) => f.sku);
const onRetail = (f: Fixture): boolean => f.channel === 'pl_retail';

describe('GET /api/v1/catalog/products — a page is cut from the rows that match (issue #151)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
    const em = h.em();
    const conn = em.getConnection();

    const channelIdByCode = new Map<string, string>();
    for (const code of ['pl_retail', 'pl_b2b_vip']) {
      const channel = await em.findOne(SalesChannel, { code });
      expect(channel, `the harness seeds ${code}`).not.toBeNull();
      channelIdByCode.set(code, channel!.id);
    }

    const all = em.create(Category, { name: { 'en-US': 'Issue 151' }, slug: ALL_SLUG });
    const audience = em.create(Category, {
      name: { 'en-US': 'Issue 151 audience' },
      slug: AUDIENCE_SLUG,
    });
    const kinds = em.create(Category, { name: { 'en-US': 'Issue 151 kinds' }, slug: KINDS_SLUG });
    await em.persistAndFlush([all, audience, kinds]);
    // A child, so the category predicate has a tree to descend: a request for
    // the parent has to reach the rows assigned to the child only through it.
    const third = em.create(Category, {
      parentCategoryId: all.id,
      name: { 'en-US': 'Issue 151 every third' },
      slug: THIRD_SLUG,
    });
    await em.persistAndFlush(third);
    const categoryIdBySlug = new Map([
      [ALL_SLUG, all.id],
      [THIRD_SLUG, third.id],
      [AUDIENCE_SLUG, audience.id],
      [KINDS_SLUG, kinds.id],
    ]);

    const products = fixtures.map((f) =>
      em.create(Product, {
        sku: f.sku,
        slug: f.sku.toLowerCase(),
        type: 'simple',
        status: 'active',
        name: { 'en-US': `Issue 151 product ${f.index}` },
        description: { 'en-US': 'Paging fixture.' },
        visibility: f.visibility,
        allowedOrganizationIds: [],
        attributeValues: f.attributeValues,
        createdAt: new Date(NEWEST - f.index * 1000),
      }),
    );
    await em.persistAndFlush(products);

    const CHUNK = 200;
    const channelRows = fixtures.map((f, i) => [channelIdByCode.get(f.channel)!, products[i]!.id]);
    const categoryRows = fixtures.flatMap((f, i) =>
      f.categories.map((slug) => [products[i]!.id, categoryIdBySlug.get(slug)!]),
    );
    for (let offset = 0; offset < channelRows.length; offset += CHUNK) {
      const slice = channelRows.slice(offset, offset + CHUNK);
      await conn.execute(
        `insert into sales_channel_products (sales_channel_id, product_id) values ` +
          slice.map(() => '(?,?)').join(','),
        slice.flat(),
      );
    }
    for (let offset = 0; offset < categoryRows.length; offset += CHUNK) {
      const slice = categoryRows.slice(offset, offset + CHUNK);
      await conn.execute(
        `insert into product_categories (product_id, category_id) values ` +
          slice.map(() => '(?,?)').join(','),
        slice.flat(),
      );
    }
  }, 120_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('serves a full first page when the 100 newest products belong to another channel', async () => {
    // The issue's reproduction, verbatim: this answered `data: []` with
    // `hasMore: true`.
    const limit = 100;
    const pages = await walk(h, '', limit);
    expectFullPages(pages, limit);

    // The harness's own seeded products share the channel, so the walk is
    // compared on this fixture's rows — in order, each exactly once.
    const mine = pages.flatMap((p) => p.skus).filter((sku) => sku.startsWith(SKU_PREFIX));
    expect(mine).toEqual(skusOf(fixtures.filter((f) => onRetail(f) && f.visibility === 'public')));
  });

  it('pages a category that matches every third product, and stops when the matches do', async () => {
    const expected = skusOf(fixtures.filter((f) => onRetail(f) && f.categories.includes(THIRD_SLUG)));
    // A limit that divides the set exactly: the last full page is followed by
    // nothing, which is the one place `hasMore` can only be right by knowing.
    const limit = expected.length / 3;
    expect(Number.isInteger(limit), 'the fixture divides into three full pages').toBe(true);

    const pages = await walk(h, `filter%5Bcategory%5D=${THIRD_SLUG}`, limit);
    expect(pages.length).toBe(3);
    expectFullPages(pages, limit);
    expect(pages.flatMap((p) => p.skus)).toEqual(expected);
  });

  it('pages the same category with a remainder, under the name ordering too', async () => {
    const expected = skusOf(fixtures.filter((f) => onRetail(f) && f.categories.includes(THIRD_SLUG)));
    const limit = 20;
    expect(expected.length % limit, 'the fixture leaves a short last page').not.toBe(0);

    const pages = await walk(h, `filter%5Bcategory%5D=${THIRD_SLUG}&sort=name`, limit);
    expect(pages.length).toBe(Math.ceil(expected.length / limit));
    expectFullPages(pages, limit);
    // `name` orders by slug, and the slugs are the zero-padded indexes.
    expect(pages.flatMap((p) => p.skus)).toEqual([...expected].sort());
  });

  it('pages an attribute filter inside a parent category', async () => {
    const expected = skusOf(fixtures.filter((f) => onRetail(f) && f.categories.includes(ALL_SLUG) && isSteel(f)));
    const limit = expected.length / 2;
    expect(Number.isInteger(limit), 'the fixture divides into two full pages').toBe(true);

    const pages = await walk(
      h,
      `filter%5Bcategory%5D=${ALL_SLUG}&filter%5Battr.material%5D=steel`,
      limit,
    );
    expect(pages.length).toBe(2);
    expectFullPages(pages, limit);
    expect(pages.flatMap((p) => p.skus)).toEqual(expected);
  });

  it('pages the conjunction of channel, child category and attribute', async () => {
    const expected = skusOf(
      fixtures.filter((f) => onRetail(f) && f.categories.includes(THIRD_SLUG) && isSteel(f)),
    );
    const limit = 5;
    const pages = await walk(
      h,
      `filter%5Bcategory%5D=${THIRD_SLUG}&filter%5Battr.material%5D=steel`,
      limit,
    );
    expect(pages.length).toBe(Math.ceil(expected.length / limit));
    expectFullPages(pages, limit);
    expect(pages.flatMap((p) => p.skus)).toEqual(expected);
  });

  it('cuts the page from the rows the caller may see, for an anonymous caller and a buyer', async () => {
    // The audience predicate had the same shape: applied to the fetched page.
    // The 50 newest rows of this category are `logged_in_only`, so an anonymous
    // first page of 50 was empty with `hasMore: true`.
    const inCategory = fixtures.filter((f) => f.categories.includes(AUDIENCE_SLUG));
    const limit = 50;

    const anonymous = await walk(h, `filter%5Bcategory%5D=${AUDIENCE_SLUG}`, limit);
    expectFullPages(anonymous, limit);
    expect(anonymous.flatMap((p) => p.skus)).toEqual(
      skusOf(inCategory.filter((f) => f.visibility === 'public')),
    );

    const buyer = await walk(h, `filter%5Bcategory%5D=${AUDIENCE_SLUG}`, limit, SIGNED_IN);
    expectFullPages(buyer, limit);
    expect(buyer.flatMap((p) => p.skus)).toEqual(skusOf(inCategory));
  });

  it('compares an attribute value in the statement exactly as it is compared on the page', async () => {
    // The statement restates a `String(value)` comparison, and a restatement
    // can drift in either direction: admitting less loses rows from the walk,
    // admitting more leaves the page short. Both are visible below, because the
    // expectation is computed with `String` itself.
    const inCategory = fixtures.filter((f) => f.categories.includes(KINDS_SLUG));
    const matching = (wanted: string[]): string[] =>
      skusOf(
        inCategory.filter(
          (f) => 'material' in f.attributeValues && wanted.includes(String(f.attributeValues['material'])),
        ),
      );
    const query = (wanted: string[]): string =>
      [`filter%5Bcategory%5D=${KINDS_SLUG}`]
        .concat(wanted.map((v) => `filter%5Battr.material%5D=${encodeURIComponent(v)}`))
        .join('&');

    const every = ['steel', 'steel,oak', '5', 'true', 'null'];
    expect(matching(every).length, 'six of the eight kinds are asked for').toBe(6);
    const pages = await walk(h, query(every), 2);
    expect(pages.length).toBe(3);
    expectFullPages(pages, 2);
    expect(pages.flatMap((p) => p.skus)).toEqual(matching(every));

    // One at a time, so a kind that only matched in company is named.
    for (const wanted of [...every, 'oak', 'plastic']) {
      const expected = matching([wanted]);
      const walked = (await walk(h, query([wanted]), 1)).flatMap((p) => p.skus);
      expect(walked, `filter[attr.material]=${wanted}`).toEqual(expected);
    }
  });

  it('answers an unknown category with one empty page and no successor', async () => {
    const pages = await walk(h, 'filter%5Bcategory%5D=i151-no-such-category', 10);
    expect(pages).toEqual([{ skus: [], hasMore: false, cursor: null }]);
  });
});
