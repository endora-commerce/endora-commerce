import { describe, expect, it } from 'vitest';
import { createPriceBooksApi, PriceBooksApiShapeError, type PriceBooksTransport } from './price-books-api.js';

/**
 * The editor's API client (feature 161, T045) — one method per endpoint of
 * `contracts/ui-api-mapping.md`, every answer parsed through the contracts'
 * Zod schema of that endpoint.
 *
 * Two things are asserted per method: the request (method, path, query, body)
 * is the one the mapping names, and the answer is unwrapped and parsed — so an
 * answer the screens cannot use is refused at the boundary with the path in
 * the message, rather than rendered half-way.
 */

const BOOK_ID = '00000000-0000-4000-8000-000000161d02';
const PRODUCT_ID = '00000000-0000-4000-8000-000000161b01';
const ORG_ID = '00000000-0000-4000-8000-000000161e01';
const CHANNEL_ID = '00000000-0000-4000-8000-000000161c01';
const ROW_ID = '00000000-0000-4000-8000-000001610001';

const BOOK = {
  id: BOOK_ID,
  name: 'Acme screws',
  type: 'regular',
  status: 'active',
  currencyCode: 'PLN',
  audience: { kind: 'organizations', memberIds: [ORG_ID] },
  priority: 0,
  startsAt: null,
  endsAt: null,
  isSystem: false,
  everActivated: true,
  version: 3,
  tierStarts: [1],
  channels: [{ channelId: CHANNEL_ID, dormant: false }],
  rowCount: 2,
  writable: true,
};

const LABELS = {
  productName: 'Screws 0200',
  productSku: 'P1',
  variantLabel: null,
  variantSku: null,
  categoryPath: null,
  attributeLabel: null,
  attributeValueLabel: null,
};

const ROW = {
  id: ROW_ID,
  selectionKind: 'product',
  selection: { variantId: null, productId: PRODUCT_ID, categoryId: null, attribute: null },
  minQuantity: 1,
  maxQuantity: null,
  price: { type: 'percent', percent: '-20.00' },
  inactiveReason: null,
  targetDeleted: false,
  labels: LABELS,
  naturalKey: { productSku: 'P1' },
};

const DIFF_ROW = {
  selectionKind: 'product',
  selection: ROW.selection,
  naturalKey: { productSku: 'P1' },
  minQuantity: 1,
  maxQuantity: null,
  price: { type: 'fixed', amount: '95.0000' },
};

interface Call {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  body?: unknown;
}

/** A client that records each call and answers from `answers` by `METHOD path`. */
function fakeClient(answers: Record<string, unknown>): { client: PriceBooksTransport; calls: Call[] } {
  const calls: Call[] = [];
  const answer = async (method: Call['method'], path: string, body?: unknown): Promise<never> => {
    calls.push(body === undefined ? { method, path } : { method, path, body });
    const key = `${method} ${path}`;
    if (!(key in answers)) throw new Error(`unexpected request ${key}`);
    return answers[key] as never;
  };
  const client: PriceBooksTransport = {
    get: (path) => answer('GET', path),
    post: (path, body) => answer('POST', path, body),
    put: (path, body) => answer('PUT', path, body),
    patch: (path, body) => answer('PATCH', path, body),
    delete: (path) => answer('DELETE', path),
  };
  return { client, calls };
}

const B = '/api/v1/admin/price-books';

describe('price-books API client — books', () => {
  it('lists books with the filters in the query and returns the creatable kinds', async () => {
    const summary = {
      id: BOOK_ID,
      name: 'Acme screws',
      type: 'regular',
      status: 'active',
      currencyCode: 'PLN',
      audienceKind: 'organizations',
      priority: 0,
      startsAt: null,
      endsAt: null,
      isSystem: false,
      version: 3,
      tierStarts: [1],
      channelCount: 1,
      memberCount: 1,
      rowCount: 2,
      appliesToNoOne: false,
      appliesNowhere: false,
      writable: true,
    };
    const path = `${B}?type=regular&type=sale&status=active&currency=PLN&channelId=${CHANNEL_ID}&audienceKind=organizations&memberId=${ORG_ID}&search=acme+sc%C5%82&page=2&pageSize=25`;
    const { client, calls } = fakeClient({
      [`GET ${path}`]: {
        data: [summary],
        meta: { page: 2, pageSize: 25, totalCount: 26, creatableAudienceKinds: ['organizations'] },
      },
    });
    const api = createPriceBooksApi(client);
    const result = await api.list({
      type: ['regular', 'sale'],
      status: ['active'],
      currency: 'PLN',
      channelId: CHANNEL_ID,
      audienceKind: 'organizations',
      memberId: ORG_ID,
      search: 'acme scł',
      page: 2,
      pageSize: 25,
    });
    expect(calls).toEqual([{ method: 'GET', path }]);
    expect(result.data[0]!.name).toBe('Acme screws');
    expect(result.meta.creatableAudienceKinds).toEqual(['organizations']);
  });

  it('lists the books pricing a product (G1) with their matches', async () => {
    const { client, calls } = fakeClient({
      [`GET ${B}?productId=${PRODUCT_ID}&page=1&pageSize=200`]: {
        data: [],
        meta: { page: 1, pageSize: 200, totalCount: 0, creatableAudienceKinds: [] },
      },
    });
    await createPriceBooksApi(client).list({ productId: PRODUCT_ID, page: 1, pageSize: 200 });
    expect(calls[0]!.path).toBe(`${B}?productId=${PRODUCT_ID}&page=1&pageSize=200`);
  });

  it('reads, creates, patches with the expected version, activates, draftifies, duplicates and deletes', async () => {
    const { client, calls } = fakeClient({
      [`GET ${B}/${BOOK_ID}`]: { data: BOOK },
      [`POST ${B}`]: { data: { ...BOOK, status: 'draft', everActivated: false, version: 1 } },
      [`PATCH ${B}/${BOOK_ID}`]: { data: { ...BOOK, name: 'Renamed', version: 4 } },
      [`POST ${B}/${BOOK_ID}/activate`]: { data: BOOK },
      [`POST ${B}/${BOOK_ID}/draftify`]: { data: { ...BOOK, status: 'draft' } },
      [`POST ${B}/${BOOK_ID}/duplicate`]: { data: { ...BOOK, id: ROW_ID, status: 'draft' } },
      [`DELETE ${B}/${BOOK_ID}`]: undefined,
    });
    const api = createPriceBooksApi(client);
    expect((await api.get(BOOK_ID)).version).toBe(3);
    const created = await api.create({
      name: 'Acme screws',
      type: 'regular',
      currencyCode: 'PLN',
      channelIds: [CHANNEL_ID],
      audience: { kind: 'organizations', memberIds: [ORG_ID] },
      priority: 0,
    });
    expect(created.status).toBe('draft');
    expect((await api.patch(BOOK_ID, { name: 'Renamed' }, 3)).name).toBe('Renamed');
    await api.activate(BOOK_ID);
    await api.draftify(BOOK_ID);
    await api.duplicate(BOOK_ID, {
      name: 'Copy',
      channelIds: [],
      currencyCode: 'EUR',
      audience: { kind: 'everyone', memberIds: [] },
      amountMultiplier: '0.25',
    });
    await api.remove(BOOK_ID);
    expect(calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      `GET ${B}/${BOOK_ID}`,
      `POST ${B}`,
      `PATCH ${B}/${BOOK_ID}`,
      `POST ${B}/${BOOK_ID}/activate`,
      `POST ${B}/${BOOK_ID}/draftify`,
      `POST ${B}/${BOOK_ID}/duplicate`,
      `DELETE ${B}/${BOOK_ID}`,
    ]);
    // G5: a header write names the version it was made against.
    expect(calls[2]!.body).toEqual({ name: 'Renamed', expectedVersion: 3 });
  });
});

describe('price-books API client — lines and rows', () => {
  it('pages lines by line with kind and search (G15)', async () => {
    const path = `${B}/${BOOK_ID}/lines?kind=product&kind=variant&search=screw&page=3&pageSize=100`;
    const { client, calls } = fakeClient({
      [`GET ${path}`]: {
        data: [
          {
            selectionKey: `product:${PRODUCT_ID}`,
            selectionKind: 'product',
            selection: ROW.selection,
            labels: LABELS,
            naturalKey: { productSku: 'P1' },
            inactiveReason: null,
            targetDeleted: false,
            rows: [ROW],
            variants: [],
          },
        ],
        meta: { page: 3, pageSize: 100, totalLines: 201 },
      },
    });
    const page = await createPriceBooksApi(client).lines(BOOK_ID, {
      kind: ['product', 'variant'],
      search: 'screw',
      page: 3,
      pageSize: 100,
    });
    expect(calls[0]!.path).toBe(path);
    expect(page.meta.totalLines).toBe(201);
    expect(page.data[0]!.rows[0]!.id).toBe(ROW_ID);
  });

  it('reads rows page by page for the export', async () => {
    const path = `${B}/${BOOK_ID}/rows?page=1&pageSize=1000`;
    const { client } = fakeClient({
      [`GET ${path}`]: { data: [ROW], meta: { page: 1, pageSize: 1000, totalCount: 1 } },
    });
    const page = await createPriceBooksApi(client).rows(BOOK_ID, { page: 1, pageSize: 1000 });
    expect(page.meta.totalCount).toBe(1);
    expect(page.data).toHaveLength(1);
  });

  it('writes one batch with the expected version, and previews the same body as a dry run', async () => {
    const body = {
      mode: 'merge' as const,
      upsert: [{ selection: { productId: PRODUCT_ID }, minQuantity: 1, maxQuantity: null, price: { type: 'fixed' as const, amount: '95.0000' } }],
      delete: [ROW_ID],
    };
    const { client, calls } = fakeClient({
      [`PUT ${B}/${BOOK_ID}/rows`]: { data: { version: 4, rows: [DIFF_ROW] } },
      [`PUT ${B}/${BOOK_ID}/rows?dryRun=true`]: {
        data: {
          version: 3,
          resolved: [DIFF_ROW],
          diff: { added: [DIFF_ROW], changed: [], removed: [], unchangedCount: 0 },
          errors: [],
        },
      },
    });
    const api = createPriceBooksApi(client);
    const preview = await api.previewRows(BOOK_ID, body);
    expect(preview.diff.added).toHaveLength(1);
    const written = await api.writeRows(BOOK_ID, body, 3);
    expect(written.version).toBe(4);
    expect(calls[0]).toEqual({ method: 'PUT', path: `${B}/${BOOK_ID}/rows?dryRun=true`, body });
    expect(calls[1]).toEqual({ method: 'PUT', path: `${B}/${BOOK_ID}/rows`, body: { ...body, expectedVersion: 3 } });
  });
});

describe('price-books API client — base prices, explanation, precedence, settings', () => {
  it('reads and writes a product’s base prices', async () => {
    const answer = {
      data: {
        productId: PRODUCT_ID,
        byCurrency: { PLN: { bookId: BOOK_ID, product: [{ minQuantity: 1, maxQuantity: null, amount: '100.0000' }], variants: {} } },
        writable: true,
      },
    };
    const { client, calls } = fakeClient({
      [`GET ${B}/base-prices?productId=${PRODUCT_ID}`]: answer,
      [`PUT ${B}/base-prices/${PRODUCT_ID}`]: answer,
    });
    const api = createPriceBooksApi(client);
    expect((await api.basePrices(PRODUCT_ID)).writable).toBe(true);
    await api.writeBasePrices(PRODUCT_ID, {
      byCurrency: { PLN: { product: [{ minQuantity: 1, maxQuantity: null, amount: '100' }], variants: {} } },
    });
    expect(calls[1]!.body).toEqual({
      byCurrency: { PLN: { product: [{ minQuantity: 1, maxQuantity: null, amount: '100' }], variants: {} } },
    });
  });

  it('explains prices, reads the precedence and the list-price switch', async () => {
    const { client, calls } = fakeClient({
      [`POST ${B}/resolve`]: {
        data: [
          {
            key: 'a',
            price: { amount: '80.0000', currency: 'PLN', source: 'buyer' },
            explanation: { tier: 'buyer', cell: 'org.product', bookId: BOOK_ID, bookName: 'Acme screws', rowId: ROW_ID, reference: '100.0000', precedenceVersion: 1, candidates: [] },
          },
        ],
      },
      [`GET ${B}/precedence`]: {
        data: {
          version: 1,
          cells: [
            'org.variant', 'org.product', 'org.category_attribute', 'org.category', 'org.attribute', 'org.all',
            'group.variant', 'group.product', 'group.category_attribute', 'group.category', 'group.attribute', 'group.all',
          ],
          categoryBeforeAttribute: true,
          depthMode: 'within_cell',
          preset: 'AF',
        },
      },
      [`GET ${B}/settings/show-list-price`]: { data: { value: false } },
      [`PUT ${B}/settings/show-list-price`]: { data: { value: true } },
    });
    const api = createPriceBooksApi(client);
    const lines = await api.resolve({ buyer: { organizationId: ORG_ID }, lines: [{ key: 'a', productId: PRODUCT_ID, quantity: 1 }] });
    expect(lines[0]!.explanation.cell).toBe('org.product');
    expect((await api.precedence()).preset).toBe('AF');
    expect(await api.showListPrice()).toBe(false);
    expect(await api.setShowListPrice(true)).toBe(true);
    expect(calls[3]!.body).toEqual({ value: true });
  });
});

describe('price-books API client — targets', () => {
  it('reads every picker', async () => {
    const { client, calls } = fakeClient({
      [`GET ${B}/targets/currencies`]: { data: { items: [{ code: 'PLN', exposedByChannels: ['b2b_pl'] }] } },
      [`GET ${B}/targets/sales-channels?currency=PLN`]: {
        data: { items: [{ id: CHANNEL_ID, code: 'b2b_pl', name: { en: 'B2B PL' }, currencies: ['PLN'], defaultCurrency: 'PLN' }] },
      },
      [`GET ${B}/targets/sales-channels`]: { data: { items: [] } },
      [`GET ${B}/targets/customer-groups`]: { data: { items: [{ id: ORG_ID, code: 'vip', name: 'VIP' }] } },
      [`GET ${B}/targets/organizations?search=Ac&limit=20`]: { data: { items: [{ id: ORG_ID, name: 'Acme', taxId: 'PL1' }] } },
      [`GET ${B}/targets/organizations?ids=${ORG_ID}%2C${CHANNEL_ID}`]: { data: { items: [{ id: ORG_ID, name: 'Acme', taxId: 'PL1' }] } },
      [`GET ${B}/targets/categories`]: {
        data: { items: [{ id: CHANNEL_ID, slug: 'screws', name: { en: 'Screws', pl: 'Śruby' }, parentCategoryId: null, sortOrder: 0 }] },
      },
      [`GET ${B}/targets/attributes`]: {
        data: { items: [{ key: 'color', label: 'Color', valueType: 'select', options: [{ value: 'red', label: 'Red' }] }] },
      },
    });
    const api = createPriceBooksApi(client);
    expect((await api.targets.currencies())[0]!.code).toBe('PLN');
    expect((await api.targets.salesChannels('PLN'))[0]!.name).toEqual({ en: 'B2B PL' });
    expect(await api.targets.salesChannels()).toEqual([]);
    expect((await api.targets.customerGroups())[0]!.code).toBe('vip');
    expect((await api.targets.organizations({ search: 'Ac', limit: 20 }))[0]!.name).toBe('Acme');
    expect(await api.targets.organizations({ ids: [ORG_ID, CHANNEL_ID] })).toHaveLength(1);
    expect((await api.targets.categories())[0]!.slug).toBe('screws');
    expect((await api.targets.attributes())[0]!.options[0]!.value).toBe('red');
    expect(calls).toHaveLength(8);
  });

  it('asks for no organization when it is given no id', async () => {
    const { client, calls } = fakeClient({});
    expect(await createPriceBooksApi(client).targets.organizations({ ids: [] })).toEqual([]);
    expect(calls).toEqual([]);
  });
});

describe('price-books API client — the boundary', () => {
  it('refuses an answer the contracts schema does not accept, naming the path', async () => {
    const { client } = fakeClient({ [`GET ${B}/${BOOK_ID}`]: { data: { ...BOOK, writable: 'yes' } } });
    const failure = createPriceBooksApi(client).get(BOOK_ID);
    await expect(failure).rejects.toBeInstanceOf(PriceBooksApiShapeError);
    await expect(failure).rejects.toThrow(`GET ${B}/${BOOK_ID}`);
  });

  it('encodes an id it puts in a path', async () => {
    const { client, calls } = fakeClient({ [`GET ${B}/a%2Fb`]: { data: BOOK } });
    await createPriceBooksApi(client).get('a/b');
    expect(calls[0]!.path).toBe(`${B}/a%2Fb`);
  });
});

describe('price-books API client — a product’s variants (FR-009)', () => {
  it('reads every variant of the product through the catalogue’s admin variant read', async () => {
    // Not the storefront's product read: that one hides an inactive or
    // out-of-channel product (`backend/test/contract/catalog/admin-product-variants-read.test.ts`).
    const { client, calls } = fakeClient({
      [`GET /api/v1/admin/catalog/products/${PRODUCT_ID}/variants`]: {
        data: [
          {
            id: ORG_ID,
            parentProductId: PRODUCT_ID,
            sku: 'P1-RED-L',
            variantAttributeValues: { color: 'red' },
            stockLevel: null,
            createdAt: '2026-10-23T10:00:00.000Z',
            updatedAt: '2026-10-23T10:00:00.000Z',
          },
        ],
      },
    });
    expect(await createPriceBooksApi(client).productVariants(PRODUCT_ID)).toEqual([{ id: ORG_ID, sku: 'P1-RED-L' }]);
    expect(calls).toHaveLength(1);
  });
});

describe('price-books API client — which products already have a line', () => {
  it('asks once for every picked product, and asks nothing for none', async () => {
    const { client, calls } = fakeClient({
      [`GET ${B}/${BOOK_ID}/product-lines?productIds=${PRODUCT_ID}%2C${ORG_ID}`]: { data: { productIds: [PRODUCT_ID] } },
    });
    const api = createPriceBooksApi(client);
    expect(await api.productLines(BOOK_ID, [PRODUCT_ID, ORG_ID])).toEqual([PRODUCT_ID]);
    expect(await api.productLines(BOOK_ID, [])).toEqual([]);
    expect(calls).toHaveLength(1);
  });
});
