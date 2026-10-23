import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBook, PriceBookRow, PriceBookRowsDryRun, PriceBookSummary } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Feature 160 (US7, T090) — a book's rows through the admin API: the batch
 * write (one audited command, shape and overlap refusals naming **every**
 * failing row — G6 — the per-book limit, the version it was made against —
 * G5), the base book's rules (G7), the read with labels, natural keys and the
 * deleted-target flag (G2), its search (G3), and the dry run with natural keys,
 * merge and replace (G10). FR-005, FR-006, FR-035.
 */
describe('admin price-book rows (feature 160 US7)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;

  type Envelope<T> = { data: T };
  type RowError = { index?: number; rowId?: string; field: string; code: string; message: string };
  type ErrorEnvelope = { error: { code: string; message: string; details?: { errors?: RowError[]; currentVersion?: number } } };

  const newBook = async (name: string): Promise<PriceBook> =>
    (
      await api.post<Envelope<PriceBook>>('/api/v1/admin/price-books', {
        name,
        type: 'regular',
        currencyCode: 'PLN',
        channelIds: [f.channels.CH1.id],
        audience: { kind: 'organizations', memberIds: [f.orgs.Acme.id] },
      })
    ).body.data;

  const versionOf = async (id: string): Promise<number> =>
    (await api.get<Envelope<PriceBook>>(`/api/v1/admin/price-books/${id}`)).body.data.version;

  const rowsOf = async (id: string, query = ''): Promise<PriceBookRow[]> =>
    (await api.get<{ data: PriceBookRow[] }>(`/api/v1/admin/price-books/${id}/rows${query}`)).body.data;

  const fixed = (amount: string) => ({ type: 'fixed', amount });
  const percent = (value: string) => ({ type: 'percent', percent: value });

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('writes a batch as one audited command, moves the version, and reads the rows back with labels (G2)', async () => {
    const book = await newBook('Rows book');
    const before = await h.em().count(AuditLogEntry, { objectId: book.id, action: 'price_list.rows_replace' });
    const res = await api.put<Envelope<{ version: number; rows: unknown[] }>>(`/api/v1/admin/price-books/${book.id}/rows`, {
      expectedVersion: book.version,
      upsert: [
        { selection: { productId: f.products.P1.id }, minQuantity: 1, price: fixed('95') },
        { selection: { productId: f.products.P5.id, variantId: f.variants.P5r }, minQuantity: 1, price: fixed('77') },
        { selection: { categoryId: f.categories.screws }, minQuantity: 10, price: percent('-5') },
        { selection: { attribute: { key: 'color', value: 'red' } }, minQuantity: 1, price: percent('-2') },
      ],
    });
    expect(res.status, res.raw).toBe(200);
    expect(res.body.data.version).toBe(book.version + 1);
    expect(res.body.data.rows).toHaveLength(4);
    const after = await h.em().count(AuditLogEntry, { objectId: book.id, action: 'price_list.rows_replace' });
    expect(after - before).toBe(1);

    const rows = await rowsOf(book.id);
    const product = rows.find((r) => r.selectionKind === 'product')!;
    expect(product.labels).toMatchObject({ productName: 'Screws 0200', productSku: f.products.P1.sku });
    expect(product.naturalKey).toEqual({ productSku: f.products.P1.sku });
    expect(product.targetDeleted).toBe(false);
    const variant = rows.find((r) => r.selectionKind === 'variant')!;
    expect(variant.labels).toMatchObject({ productName: 'Screws 0500', variantSku: expect.stringMatching(/^P5R-/) });
    expect(variant.naturalKey).toMatchObject({ variantSku: variant.labels.variantSku });
    const category = rows.find((r) => r.selectionKind === 'category')!;
    expect(category.labels.categoryPath).toBe('Screws');
    expect(category.naturalKey.categoryPath).toMatch(/^screws-/);
    const attribute = rows.find((r) => r.selectionKind === 'attribute')!;
    expect(attribute.labels.attributeLabel).toBeTruthy();
    expect(attribute.naturalKey).toEqual({ attribute: { key: 'color', valueCode: 'red' } });
    expect(attribute.inactiveReason).toBeNull();

    const read = await api.get<Envelope<PriceBook>>(`/api/v1/admin/price-books/${book.id}`);
    expect(read.body.data.tierStarts).toEqual([1, 10]);
    expect(read.body.data.rowCount).toBe(4);
  });

  it('searches the rows over their labels and SKUs (G3), and filters by selection kind', async () => {
    const book = await newBook('Search book');
    await api.put(`/api/v1/admin/price-books/${book.id}/rows`, {
      expectedVersion: book.version,
      upsert: [
        { selection: { productId: f.products.P1.id }, minQuantity: 1, price: fixed('95') },
        { selection: { productId: f.products.P3.id }, minQuantity: 1, price: fixed('25') },
        { selection: { categoryId: f.categories.bolts }, minQuantity: 1, price: percent('-3') },
      ],
    });
    expect((await rowsOf(book.id, '?search=0200')).map((r) => r.selection.productId)).toEqual([f.products.P1.id]);
    expect((await rowsOf(book.id, `?search=${encodeURIComponent(f.products.P3.sku)}`)).map((r) => r.selection.productId)).toEqual([
      f.products.P3.id,
    ]);
    expect((await rowsOf(book.id, '?search=bolt')).map((r) => r.selectionKind).sort()).toEqual(['category', 'product']);
    expect((await rowsOf(book.id, '?selectionKind=category')).map((r) => r.selectionKind)).toEqual(['category']);
  });

  it('refuses a stale batch with the current version and writes nothing (G5)', async () => {
    const book = await newBook('Stale rows');
    const first = await api.put(`/api/v1/admin/price-books/${book.id}/rows`, {
      expectedVersion: book.version,
      upsert: [{ selection: { productId: f.products.P1.id }, minQuantity: 1, price: fixed('90') }],
    });
    expect(first.status, first.raw).toBe(200);
    const stale = await api.put(`/api/v1/admin/price-books/${book.id}/rows`, {
      expectedVersion: book.version,
      upsert: [{ selection: { productId: f.products.P2.id }, minQuantity: 1, price: fixed('40') }],
    });
    expect(stale.status).toBe(409);
    expect((stale.body as ErrorEnvelope).error).toMatchObject({ code: 'PRICE_BOOK_STALE', details: { currentVersion: book.version + 1 } });
    expect((await rowsOf(book.id)).map((r) => r.selection.productId)).toEqual([f.products.P1.id]);
    const missing = await api.put(`/api/v1/admin/price-books/${book.id}/rows`, { upsert: [] });
    expect(missing.status).toBe(400);
  });

  it('names every failing row of a refused batch, with index, field and code (G6)', async () => {
    const book = await newBook('Refusals');
    const res = await api.put(`/api/v1/admin/price-books/${book.id}/rows`, {
      expectedVersion: book.version,
      upsert: [
        { selection: { productId: f.products.P1.id }, minQuantity: 1, price: fixed('90') },
        { selection: {}, minQuantity: 1, price: fixed('10') },
        { selection: { productId: f.products.P2.id }, minQuantity: 5, maxQuantity: 2, price: fixed('10') },
        { selection: { productId: f.products.P3.id }, minQuantity: 1, price: percent('-150') },
        { selection: { productId: '00000000-0000-4000-8000-0000001600aa' }, minQuantity: 1, price: fixed('10') },
      ],
    });
    expect(res.status).toBe(400);
    const error = (res.body as ErrorEnvelope).error;
    expect(error.code).toBe('PRICE_BOOK_ROW_SHAPE');
    const errors = error.details!.errors!;
    expect(errors.map((e) => e.index).sort()).toEqual([1, 2, 3, 4]);
    expect(errors.find((e) => e.index === 1)).toMatchObject({ code: 'PRICE_BOOK_ROW_SHAPE', reason: 'fixed_on_all', field: 'price.type' });
    expect(errors.find((e) => e.index === 2)).toMatchObject({ code: 'PRICE_BOOK_ROW_SHAPE', reason: 'max_below_min', field: 'maxQuantity' });
    expect(errors.find((e) => e.index === 3)).toMatchObject({ code: 'PRICE_BOOK_ROW_SHAPE', reason: 'row_invalid', field: 'price.percent' });
    expect(errors.find((e) => e.index === 4)).toMatchObject({ code: 'PRICE_BOOK_ROW_TARGET', reason: 'product_unknown', field: 'selection.productId' });
    expect(await rowsOf(book.id)).toEqual([]);
    expect(await versionOf(book.id)).toBe(book.version);
  });

  it('refuses overlapping windows on one selection 409, naming both rows (FR-006)', async () => {
    const book = await newBook('Overlaps');
    const first = await api.put<Envelope<{ version: number; rows: Array<{ id: string }> }>>(`/api/v1/admin/price-books/${book.id}/rows`, {
      expectedVersion: book.version,
      upsert: [{ selection: { productId: f.products.P1.id }, minQuantity: 1, maxQuantity: 9, price: fixed('90') }],
    });
    const storedId = first.body.data.rows[0]!.id!;
    const res = await api.put(`/api/v1/admin/price-books/${book.id}/rows`, {
      expectedVersion: first.body.data.version,
      upsert: [
        { selection: { productId: f.products.P2.id }, minQuantity: 1, price: fixed('40') },
        { selection: { productId: f.products.P1.id }, minQuantity: 5, maxQuantity: 20, price: fixed('85') },
      ],
    });
    expect(res.status).toBe(409);
    const error = (res.body as ErrorEnvelope).error;
    expect(error.code).toBe('PRICE_BOOK_ROW_OVERLAP');
    expect(error.details!.errors).toEqual([
      expect.objectContaining({ index: 1, rowId: storedId, code: 'PRICE_BOOK_ROW_OVERLAP', field: 'minQuantity' }),
    ]);
  });

  it('accepts the base book for product and variant rows only, refusing the rest per row (G7)', async () => {
    const base = (await api.get<{ data: PriceBookSummary[] }>('/api/v1/admin/price-books?currency=PLN')).body.data.find((b) => b.isSystem)!;
    const res = await api.put(`/api/v1/admin/price-books/${base.id}/rows`, {
      expectedVersion: base.version,
      upsert: [
        { selection: { categoryId: f.categories.screws }, minQuantity: 1, price: percent('-5') },
        { selection: { productId: f.products.P3.id }, minQuantity: 1, price: percent('-5') },
      ],
    });
    expect(res.status).toBe(400);
    expect((res.body as ErrorEnvelope).error.details!.errors!.map((e) => e.index)).toEqual([0, 1]);

    const ok = await api.put<Envelope<{ version: number }>>(`/api/v1/admin/price-books/${base.id}/rows`, {
      expectedVersion: base.version,
      upsert: [
        // Replaces P3's stored 1+ row (same selection and start), so the new 10+ tier fits.
        { selection: { productId: f.products.P3.id }, minQuantity: 1, maxQuantity: 9, price: fixed('30') },
        { selection: { productId: f.products.P3.id }, minQuantity: 10, price: fixed('28') },
        { selection: { productId: f.products.P5.id, variantId: f.variants.P5b }, minQuantity: 1, price: { type: 'amount', amount: '-5' } },
      ],
    });
    expect(ok.status, ok.raw).toBe(200);
    expect(await f.amount('guest', f.products.P3, { quantity: 10 })).toBe('28.0000');
    expect(await f.amount('guest', f.products.P5, { variantId: f.variants.P5b })).toBe('75.0000');
    await f.resetBase();
  });

  it('previews a natural-key import without writing, then confirms the same body (G10)', async () => {
    const book = await newBook('Import book');
    await api.put(`/api/v1/admin/price-books/${book.id}/rows`, {
      expectedVersion: book.version,
      upsert: [
        { selection: { productId: f.products.P1.id }, minQuantity: 1, price: fixed('95') },
        { selection: { productId: f.products.P2.id }, minQuantity: 1, price: fixed('45') },
        { selection: { productId: f.products.P3.id }, minQuantity: 1, price: fixed('25') },
      ],
    });
    const version = await versionOf(book.id);
    const screwsSlug = ((await h
      .em()
      .getConnection()
      .execute(`select "slug" from "categories" where "id" = ?`, [f.categories.screws])) as Array<{ slug: string }>)[0]!.slug;
    const body = {
      expectedVersion: version,
      mode: 'merge',
      upsert: [
        { key: { productSku: f.products.P1.sku }, minQuantity: 1, price: fixed('93') },
        { key: { productSku: f.products.P2.sku }, minQuantity: 1, price: fixed('45') },
        { key: { categoryPath: screwsSlug }, minQuantity: 20, price: percent('-7') },
        { key: { attribute: { key: 'color', valueCode: 'red' } }, minQuantity: 1, price: percent('-1') },
        { key: { productSku: 'NO-SUCH-SKU' }, minQuantity: 1, price: fixed('1') },
      ],
    };
    const preview = await api.put<Envelope<PriceBookRowsDryRun>>(`/api/v1/admin/price-books/${book.id}/rows?dryRun=true`, body);
    expect(preview.status, preview.raw).toBe(200);
    const dry = preview.body.data;
    expect(dry.version).toBe(version);
    expect(dry.errors).toEqual([expect.objectContaining({ index: 4, code: 'PRICE_BOOK_ROW_TARGET', reason: 'product_unknown', field: 'key.productSku' })]);
    expect(dry.resolved[0]).toMatchObject({ selection: { productId: f.products.P1.id } });
    expect(dry.resolved[4]).toBeNull();
    expect(dry.diff.changed).toEqual([
      expect.objectContaining({
        before: expect.objectContaining({ price: { type: 'fixed', amount: '95.0000' } }),
        after: expect.objectContaining({ price: { type: 'fixed', amount: '93.0000' } }),
      }),
    ]);
    expect(dry.diff.added.map((r) => r.selectionKind).sort()).toEqual(['attribute', 'category']);
    expect(dry.diff.removed).toEqual([]);
    expect(dry.diff.unchangedCount).toBe(1);
    // Nothing was written.
    expect(await versionOf(book.id)).toBe(version);
    expect((await rowsOf(book.id)).find((r) => r.selection.productId === f.products.P1.id)!.price).toEqual(fixed('95.0000'));

    // Replace mode previews the rows the file does not name as removed.
    const replace = await api.put<Envelope<PriceBookRowsDryRun>>(`/api/v1/admin/price-books/${book.id}/rows?dryRun=true`, {
      ...body,
      mode: 'replace',
      upsert: body.upsert.slice(0, 4),
    });
    expect(replace.status, replace.raw).toBe(200);
    expect(replace.body.data.diff.removed.map((r) => r.selection.productId)).toEqual([f.products.P3.id]);
    expect(replace.body.data.errors).toEqual([]);

    // A preview with refused rows does not confirm; the clean body does.
    const refused = await api.put(`/api/v1/admin/price-books/${book.id}/rows`, body);
    expect(refused.status).toBe(400);
    const confirmed = await api.put<Envelope<{ version: number }>>(`/api/v1/admin/price-books/${book.id}/rows`, {
      ...body,
      mode: 'replace',
      upsert: body.upsert.slice(0, 4),
    });
    expect(confirmed.status, confirmed.raw).toBe(200);
    expect(confirmed.body.data.version).toBe(version + 1);
    const rows = await rowsOf(book.id);
    expect(rows).toHaveLength(4);
    expect(rows.some((r) => r.selection.productId === f.products.P3.id)).toBe(false);
  });

  it('flags a row whose target was deleted (G2)', async () => {
    const book = await newBook('Deleted target');
    await api.put(`/api/v1/admin/price-books/${book.id}/rows`, {
      expectedVersion: book.version,
      upsert: [{ selection: { productId: f.products.P4.id }, minQuantity: 1, price: fixed('50') }],
    });
    await h.em().getConnection().execute(`update "products" set "deleted_at" = now() where "id" = ?`, [f.products.P4.id]);
    try {
      const [row] = await rowsOf(book.id);
      expect(row).toMatchObject({ targetDeleted: true, inactiveReason: 'target_deleted' });
    } finally {
      await h.em().getConnection().execute(`update "products" set "deleted_at" = null where "id" = ?`, [f.products.P4.id]);
    }
  });

  it('refuses a batch over 5 000 rows before reading it', async () => {
    const book = await newBook('Too many');
    const upsert = Array.from({ length: 5001 }, (_, i) => ({
      selection: { productId: f.products.P1.id },
      minQuantity: i + 1,
      maxQuantity: i + 1,
      price: fixed('1'),
    }));
    const res = await api.put(`/api/v1/admin/price-books/${book.id}/rows`, { expectedVersion: book.version, upsert });
    expect(res.status).toBe(400);
  });
});
