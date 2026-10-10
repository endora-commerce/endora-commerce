import { RawQueryFragment, raw } from '@mikro-orm/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { isProductVisibleTo, type ProductAudience } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { OTHER_TEST_ORGANIZATION_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
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
 * stub cannot say. In listing order, newest first:
 *
 *  - **vip** — the 100 newest products, bound to `pl_b2b_vip` only. The whole
 *    first page of a `limit=100` request for `pl_retail` is therefore made of
 *    rows that channel may not see. This is the issue's own reproduction;
 *  - **retail** — the next 200, bound to `pl_retail`;
 *  - **deep** — 30 that sit **only** in a category two levels below the parent
 *    the other two blocks are assigned to, so a filter on an ancestor reaches
 *    them through the tree or not at all;
 *  - **audience** — 120 in a category of their own, the newest 50 of them
 *    `logged_in_only`: the original shape, on the audience axis;
 *  - **rules** — 72 cycling through every state `isProductVisibleTo` tells
 *    apart, so each rule of the predicate is held separately;
 *  - **kinds** — one per JSON kind an attribute value takes;
 *  - **malformed** — one whose stored allow-list is not an array.
 *
 * Every third product of the first two blocks also sits in the child category,
 * every fourth carries `material = steel`, so the channel, the category and the
 * attribute overlap rather than partition.
 *
 * Expectations are derived from the fixture list — and, for the audience, from
 * `isProductVisibleTo` itself — never written as numbers: a count typed here
 * would be a second statement of the fixture.
 */

const RETAIL = { 'x-sales-channel': 'pl_retail' };
const SIGNED_IN = { b2b_session: 'stub-customer-session' };
const SIGNED_IN_OTHER_ORG = { b2b_session: 'stub-customer-session-other-org' };

const SKU_PREFIX = 'I151-';
const ALL_SLUG = 'i151-all';
const THIRD_SLUG = 'i151-third';
const DEEP_SLUG = 'i151-deep';
const AUDIENCE_SLUG = 'i151-audience';
const RULES_SLUG = 'i151-rules';
const KINDS_SLUG = 'i151-kinds';
const MALFORMED_SLUG = 'i151-malformed';

/** Child -> parent. A filter on a slug matches everything assigned beneath it. */
const PARENT_OF: Readonly<Record<string, string>> = {
  [THIRD_SLUG]: ALL_SLUG,
  [DEEP_SLUG]: THIRD_SLUG,
};

type Visibility = 'public' | 'logged_in_only' | 'organization_restricted';

/**
 * The states `isProductVisibleTo` distinguishes: each visibility with no
 * allow-list, and an allow-list — which decides on its own, whatever the
 * visibility says — naming the buyer's organisation, another one, or both.
 */
const RULES: ReadonlyArray<{ visibility: Visibility; allowedOrganizationIds: string[] }> = [
  { visibility: 'public', allowedOrganizationIds: [] },
  { visibility: 'logged_in_only', allowedOrganizationIds: [] },
  { visibility: 'organization_restricted', allowedOrganizationIds: [] },
  { visibility: 'public', allowedOrganizationIds: [OTHER_TEST_ORGANIZATION_ID] },
  { visibility: 'organization_restricted', allowedOrganizationIds: [TEST_ORGANIZATION_ID] },
  {
    visibility: 'logged_in_only',
    allowedOrganizationIds: [OTHER_TEST_ORGANIZATION_ID, TEST_ORGANIZATION_ID],
  },
];

const AUDIENCES: ReadonlyArray<{
  name: string;
  audience: ProductAudience;
  cookies?: Record<string, string>;
}> = [
  { name: 'an anonymous caller', audience: { organizationId: null, authenticated: false } },
  {
    name: 'a buyer of the named organisation',
    audience: { organizationId: TEST_ORGANIZATION_ID, authenticated: true },
    cookies: SIGNED_IN,
  },
  {
    name: 'a buyer of another organisation',
    audience: { organizationId: OTHER_TEST_ORGANIZATION_ID, authenticated: true },
    cookies: SIGNED_IN_OTHER_ORG,
  },
];

/**
 * The `material` values of the kinds block. The listing compares
 * `String(value)` with the requested strings, and each of these is a value
 * `String` and PostgreSQL's own text for it part ways on: a one-element array
 * reads as its element, a longer one as a comma-joined list with `null` empty,
 * a JSON `null` as the word, an object as `[object Object]`, and a number as
 * JavaScript prints it — exponent notation from 1e21 up and below 1e-6, plain
 * in between, where PostgreSQL stores `1e21` as 22 digits and switches to
 * exponent notation at other thresholds.
 *
 * `stored` is JSON written past the ORM, for the two values JavaScript cannot
 * write: a decimal with a trailing zero. `material` is then what JavaScript
 * reads back, which is what the comparison has always seen.
 */
const KINDS: ReadonlyArray<{ material?: unknown; stored?: string }> = [
  { material: 'steel' },
  { material: ['steel'] },
  { material: ['steel', 'oak'] },
  { material: 5 },
  { material: true },
  { material: null },
  { material: 'plastic' },
  { material: 1.5 },
  { material: 1e21 },
  { material: 1.5e300 },
  { material: 123456789012345680000 },
  { material: 1e15 },
  { material: 1e-7 },
  { material: -2.5e-9 },
  { material: 0.000001 },
  { material: 0.00001 },
  { material: 0 },
  { material: { finish: 'matte' } },
  { material: [1.5, 2, 1e21, null, true, { a: 1 }] },
  { material: 2.5, stored: '2.50' },
  { material: [3.5, 4], stored: '[3.50, 4.0]' },
  {},
];

/** Newest first: index 0 is the first row of the default ordering. */
const NEWEST = Date.parse('2031-01-01T00:00:00.000Z');

interface Fixture {
  index: number;
  sku: string;
  channel: 'pl_retail' | 'pl_b2b_vip';
  visibility: Visibility;
  allowedOrganizationIds: string[];
  /** Direct assignments only — see {@link inTree}. */
  categories: string[];
  attributeValues: Record<string, unknown>;
  /** `attribute_values.material` as JSON text, written past the ORM. */
  storedMaterial?: string;
  /** `allowed_organization_ids` as JSON text, written past the ORM. */
  storedAllowList?: string;
}

const fixtures: Fixture[] = [];
function add(count: number, make: (i: number) => Partial<Fixture>): void {
  for (let i = 0; i < count; i++) {
    const index = fixtures.length;
    fixtures.push({
      index,
      sku: `${SKU_PREFIX}${String(index).padStart(4, '0')}`,
      channel: 'pl_retail',
      visibility: 'public',
      allowedOrganizationIds: [],
      categories: [],
      attributeValues: { material: index % 4 === 0 ? 'steel' : 'plastic' },
      ...make(i),
    });
  }
}
const sharedCategories = (): string[] => {
  const index = fixtures.length;
  return [ALL_SLUG, ...(index % 3 === 0 ? [THIRD_SLUG] : [])];
};
add(100, () => ({ channel: 'pl_b2b_vip', categories: sharedCategories() }));
add(200, () => ({ categories: sharedCategories() }));
add(30, () => ({ categories: [DEEP_SLUG] }));
add(120, (i) => ({
  categories: [AUDIENCE_SLUG],
  visibility: i < 50 ? 'logged_in_only' : 'public',
}));
add(72, (i) => ({ categories: [RULES_SLUG], ...RULES[i % RULES.length]! }));
add(KINDS.length, (i) => {
  const kind = KINDS[i]!;
  return {
    categories: [KINDS_SLUG],
    attributeValues: 'material' in kind ? { material: kind.material } : {},
    ...(kind.stored !== undefined ? { storedMaterial: kind.stored } : {}),
  };
});
add(1, () => ({ categories: [MALFORMED_SLUG], storedAllowList: '"not-an-array"' }));

const isSteel = (f: Fixture): boolean => f.attributeValues['material'] === 'steel';
const onRetail = (f: Fixture): boolean => f.channel === 'pl_retail';
const skusOf = (rows: Fixture[]): string[] => rows.map((f) => f.sku);

/** Assigned to `slug` or to any category beneath it. */
function inTree(f: Fixture, slug: string): boolean {
  return f.categories.some((assigned) => {
    for (let at: string | undefined = assigned; at !== undefined; at = PARENT_OF[at]) {
      if (at === slug) return true;
    }
    return false;
  });
}

/** A page size that divides `total`, so the last full page is followed by nothing. */
function dividing(total: number): number {
  for (let limit = 30; limit >= 4; limit--) {
    if (total % limit === 0 && total / limit >= 2) return limit;
  }
  throw new Error(`the fixture holds ${total} matching rows, which no page size here divides`);
}

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

    const categoryIdBySlug = new Map<string, string>();
    // Parents before children: the tree is three levels deep under `ALL_SLUG`.
    for (const slug of [
      ALL_SLUG,
      THIRD_SLUG,
      DEEP_SLUG,
      AUDIENCE_SLUG,
      RULES_SLUG,
      KINDS_SLUG,
      MALFORMED_SLUG,
    ]) {
      const parent = PARENT_OF[slug];
      const category = em.create(Category, {
        ...(parent !== undefined ? { parentCategoryId: categoryIdBySlug.get(parent)! } : {}),
        name: { 'en-US': `Issue 151 ${slug}` },
        slug,
      });
      await em.persistAndFlush(category);
      categoryIdBySlug.set(slug, category.id);
    }

    const products = fixtures.map((f) =>
      em.create(Product, {
        sku: f.sku,
        slug: f.sku.toLowerCase(),
        type: 'simple',
        status: 'active',
        name: { 'en-US': `Issue 151 product ${f.index}` },
        description: { 'en-US': 'Paging fixture.' },
        visibility: f.visibility,
        allowedOrganizationIds: f.allowedOrganizationIds,
        attributeValues: f.attributeValues,
        createdAt: new Date(NEWEST - f.index * 1000),
      }),
    );
    await em.persistAndFlush(products);

    for (const [i, f] of fixtures.entries()) {
      if (f.storedMaterial !== undefined) {
        await conn.execute(
          `update products set attribute_values = jsonb_build_object('material', ?::jsonb) where id = ?`,
          [f.storedMaterial, products[i]!.id],
        );
      }
      if (f.storedAllowList !== undefined) {
        await conn.execute(
          `update products set allowed_organization_ids = ?::jsonb where id = ?`,
          [f.storedAllowList, products[i]!.id],
        );
      }
    }

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
    const anonymous: ProductAudience = { organizationId: null, authenticated: false };
    const mine = pages.flatMap((p) => p.skus).filter((sku) => sku.startsWith(SKU_PREFIX));
    expect(mine).toEqual(
      skusOf(
        fixtures.filter(
          (f) => onRetail(f) && f.storedAllowList === undefined && isProductVisibleTo(f, anonymous),
        ),
      ),
    );
  });

  it('pages a child category, and stops when the matches do', async () => {
    const expected = skusOf(fixtures.filter((f) => onRetail(f) && inTree(f, THIRD_SLUG)));
    // A limit that divides the set exactly: the last full page is followed by
    // nothing, which is the one place `hasMore` can only be right by knowing.
    const limit = dividing(expected.length);

    const pages = await walk(h, `filter%5Bcategory%5D=${THIRD_SLUG}`, limit);
    expect(pages.length).toBe(expected.length / limit);
    expectFullPages(pages, limit);
    expect(pages.flatMap((p) => p.skus)).toEqual(expected);
  });

  it('reaches products assigned only to a category two levels below the one asked for', async () => {
    // The descent itself. Every other row under the parent is also assigned to
    // it directly, so a predicate that bound the root's id alone would still
    // find those; these thirty it can only find through the tree.
    const deepOnly = skusOf(fixtures.filter((f) => f.categories.includes(DEEP_SLUG)));
    expect(deepOnly.length).toBeGreaterThan(0);

    for (const ancestor of [ALL_SLUG, THIRD_SLUG, DEEP_SLUG]) {
      const expected = skusOf(fixtures.filter((f) => onRetail(f) && inTree(f, ancestor)));
      const limit = 20;
      const pages = await walk(h, `filter%5Bcategory%5D=${ancestor}`, limit);
      expect(pages.length, ancestor).toBe(Math.ceil(expected.length / limit));
      expectFullPages(pages, limit);
      const walked = pages.flatMap((p) => p.skus);
      expect(walked, ancestor).toEqual(expected);
      expect(walked, `${ancestor} reaches the deep rows`).toEqual(expect.arrayContaining(deepOnly));
    }
  });

  it('pages the same category with a remainder, under the name ordering too', async () => {
    const expected = skusOf(fixtures.filter((f) => onRetail(f) && inTree(f, THIRD_SLUG)));
    const limit = 17;
    expect(expected.length % limit, 'the fixture leaves a short last page').not.toBe(0);

    const pages = await walk(h, `filter%5Bcategory%5D=${THIRD_SLUG}&sort=name`, limit);
    expect(pages.length).toBe(Math.ceil(expected.length / limit));
    expectFullPages(pages, limit);
    // `name` orders by slug, and the slugs are the zero-padded indexes.
    expect(pages.flatMap((p) => p.skus)).toEqual([...expected].sort());
  });

  it('pages an attribute filter inside a parent category', async () => {
    const expected = skusOf(fixtures.filter((f) => onRetail(f) && inTree(f, ALL_SLUG) && isSteel(f)));
    const limit = dividing(expected.length);

    const pages = await walk(
      h,
      `filter%5Bcategory%5D=${ALL_SLUG}&filter%5Battr.material%5D=steel`,
      limit,
    );
    expect(pages.length).toBe(expected.length / limit);
    expectFullPages(pages, limit);
    expect(pages.flatMap((p) => p.skus)).toEqual(expected);
  });

  it('pages the conjunction of channel, child category and attribute', async () => {
    const expected = skusOf(
      fixtures.filter((f) => onRetail(f) && inTree(f, THIRD_SLUG) && isSteel(f)),
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

  describe('the audience rules, each held by the statement on its own', () => {
    // The listing applies `isProductVisibleTo` twice: restated in the
    // statement, and again over the rows that statement returned. The second
    // pass would hide a statement that admitted too much — nothing would be
    // disclosed, the page would only come back short. So every rule is walked
    // with a small page and the pages must be **full**: a row the statement
    // lets through and the predicate then drops leaves a hole in one of them,
    // and a row the statement wrongly refuses is missing from the walk.
    const inCategory = fixtures.filter((f) => f.categories.includes(RULES_SLUG));

    it.each(AUDIENCES)('serves $name exactly the rows the predicate admits', async (viewer) => {
      const expected = inCategory.filter((f) => isProductVisibleTo(f, viewer.audience));
      // Not vacuous in either direction: this viewer is refused something and
      // shown something.
      expect(expected.length).toBeGreaterThan(0);
      expect(expected.length).toBeLessThan(inCategory.length);

      for (const limit of [5, dividing(expected.length)]) {
        const pages = await walk(h, `filter%5Bcategory%5D=${RULES_SLUG}`, limit, viewer.cookies);
        expect(pages.length, `limit=${limit}`).toBe(Math.ceil(expected.length / limit));
        expectFullPages(pages, limit);
        expect(pages.flatMap((p) => p.skus), `limit=${limit}`).toEqual(skusOf(expected));
      }
    });

    it('tells every rule apart for at least one of the three viewers', () => {
      // The floor under the sweep above: a rule no viewer distinguishes from
      // its neighbour would be a rule nothing here holds.
      const verdicts = RULES.map((rule) =>
        AUDIENCES.map((viewer) => (isProductVisibleTo(rule, viewer.audience) ? 'y' : 'n')).join(''),
      );
      expect(new Set(verdicts).size).toBeGreaterThanOrEqual(5);
      expect(verdicts).toContain('nnn');
      expect(verdicts).toContain('yyy');
    });
  });

  it('withholds a product whose stored allow-list is not an array, from every viewer', async () => {
    // Why the predicate still runs over the returned rows. The statement reads
    // a non-array `allowed_organization_ids` as "no allow-list" and would serve
    // this `public` row; `isProductVisibleTo` reads it as an allow-list naming
    // nobody the caller is. The predicate is the platform's answer, so the row
    // stays hidden — and this case goes red if the second pass is removed.
    const [malformed] = skusOf(fixtures.filter((f) => f.storedAllowList !== undefined));
    for (const viewer of AUDIENCES) {
      const res = await h.app.inject({
        method: 'GET',
        url: `/api/v1/catalog/products?limit=10&filter%5Bcategory%5D=${MALFORMED_SLUG}`,
        headers: RETAIL,
        ...(viewer.cookies ? { cookies: viewer.cookies } : {}),
      });
      expect(res.statusCode).toBe(200);
      const skus = (res.json() as { data: Array<{ sku: string }> }).data.map((p) => p.sku);
      expect(skus, viewer.name).not.toContain(malformed);
    }
  });

  it('compares an attribute value in the statement exactly as it is compared on the page', async () => {
    // The statement restates a `String(value)` comparison, and a restatement
    // can drift in either direction: admitting less loses rows from the walk,
    // admitting more leaves the page short. Both are visible below, because the
    // expectation is computed with `String` itself.
    const inCategory = fixtures.filter((f) => f.categories.includes(KINDS_SLUG));
    const carrying = inCategory.filter((f) => 'material' in f.attributeValues);
    const matching = (wanted: string[]): string[] =>
      skusOf(carrying.filter((f) => wanted.includes(String(f.attributeValues['material']))));
    const query = (wanted: string[]): string =>
      [`filter%5Bcategory%5D=${KINDS_SLUG}`]
        .concat(wanted.map((v) => `filter%5Battr.material%5D=${encodeURIComponent(v)}`))
        .join('&');

    const every = [...new Set(carrying.map((f) => String(f.attributeValues['material'])))];
    // The strings this is about, spelled once so the fixture cannot quietly
    // stop producing them.
    expect(every).toEqual(
      expect.arrayContaining([
        '1e+21',
        '1.5e+300',
        '123456789012345680000',
        '1000000000000000',
        '1e-7',
        '-2.5e-9',
        '0.000001',
        '0.00001',
        '0',
        '2.5',
        '3.5,4',
        '1.5,2,1e+21,,true,[object Object]',
        '[object Object]',
        'null',
      ]),
    );

    const pages = await walk(h, query(every), 4);
    expectFullPages(pages, 4);
    expect(pages.flatMap((p) => p.skus)).toEqual(skusOf(carrying));

    // One at a time, so a kind that only matched in company is named. `oak`
    // and `1.50` are the two that must match nothing: an element of a longer
    // array, and the stored spelling JavaScript never sees.
    for (const wanted of [...every, 'oak', '1.50', '2.50']) {
      const expected = matching([wanted]);
      const walked = (await walk(h, query([wanted]), 1)).flatMap((p) => p.skus);
      expect(walked, `filter[attr.material]=${wanted}`).toEqual(expected);
    }
  });

  it('answers an unknown category with one empty page and no successor', async () => {
    const pages = await walk(h, 'filter%5Bcategory%5D=i151-no-such-category', 10);
    expect(pages).toEqual([{ skus: [], hasMore: false, cursor: null }]);
  });

  it('holds no query fragment after a request, whichever way the request ended', async () => {
    // MikroORM registers a `raw()` fragment process-wide when it is used as a
    // key and releases it when a statement consumes it. One created on a path
    // that returns without querying is therefore held for the life of the
    // process — and the unknown-category answer above is such a path, open to
    // any anonymous caller. `checkCacheSize` is the ORM's own instrument for
    // exactly this.
    const probe = String(raw('select 151'));
    const withProbe = RawQueryFragment.checkCacheSize();
    RawQueryFragment.remove(probe);
    expect(RawQueryFragment.checkCacheSize(), 'the instrument counts a held fragment').toBe(
      withProbe - 1,
    );

    const requests = [
      'filter%5Bcategory%5D=i151-no-such-category',
      'filter%5Bcategory%5D=i151-no-such-category&filter%5Battr.material%5D=steel',
      `filter%5Bcategory%5D=${THIRD_SLUG}&filter%5Battr.material%5D=steel`,
      'filter%5Battr.material%5D=steel',
      '',
    ];
    const before = RawQueryFragment.checkCacheSize();
    for (let round = 0; round < 10; round++) {
      for (const query of requests) {
        for (const viewer of AUDIENCES) {
          const res = await h.app.inject({
            method: 'GET',
            url: `/api/v1/catalog/products?limit=5${query === '' ? '' : `&${query}`}`,
            headers: RETAIL,
            ...(viewer.cookies ? { cookies: viewer.cookies } : {}),
          });
          expect(res.statusCode).toBe(200);
        }
      }
    }
    expect(RawQueryFragment.checkCacheSize()).toBe(before);
  });
});
