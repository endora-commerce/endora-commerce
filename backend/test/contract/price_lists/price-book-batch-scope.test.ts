import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBook, PriceBookRowsDryRun } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';
import { BASE_BOOK_ID, ensureBaseBookSql } from '../../helpers/price-book-sql.js';
import {
  measureStatements,
  seedBulkProductsSql,
  seedEmptyBookSql,
  seedProductTiersSql,
} from '../../helpers/price-book-bulk.js';

/**
 * Feature 161, G18 (`specs/161-price-book-editor/contracts/backend-gaps.md`;
 * owner acceptance of the base-book exemption, 2026-10-22) — a row batch
 * validates against what it touches, not against the whole book:
 *
 * - the stored rows of the selections the batch names (overlap is a rule
 *   within one selection), the book's row count for the limit, and in replace
 *   mode the ids of every stored row;
 * - `PRICE_BOOK_MAX_ROWS` (5 000) holds for non-base books and not for base
 *   books, which hold a row per product tier across the catalogue (FR-009 of
 *   spec 160) — so the base grid can save at all;
 * - so a 10-row batch reads the same rows and issues the same statements on a
 *   300-row and on a 30 000-row book.
 */
describe('price-book batches — scoped validation, base books uncapped (161 G18)', () => {
  let h: BackendServerHandle;
  let api: ApiClient;
  let products: string[];
  let euroBase: string;
  let regular: string;

  type Envelope<T> = { data: T };
  type ErrorEnvelope = { error: { code: string; details?: { errors?: Array<{ code: string }> } } };
  const version = async (id: string) => (await api.get<Envelope<PriceBook>>(`/api/v1/admin/price-books/${id}`)).body.data.version;
  const rowCount = async (id: string) => (await api.get<Envelope<PriceBook>>(`/api/v1/admin/price-books/${id}`)).body.data.rowCount;
  const fixed = (productId: string, amount: string, minQuantity = 1) => ({
    selection: { productId },
    minQuantity,
    maxQuantity: minQuantity === 1 ? 9 : null,
    price: { type: 'fixed', amount },
  });

  beforeAll(async () => {
    h = await setupBackendServer();
    api = priceBookApi(h);
    const em = h.em();
    products = await seedBulkProductsSql(em, { count: 30_000, namePrefix: 'Batch', skuPrefix: 'G18' });
    // PLN base: 30 000 rows of the bulk products beside the seeded catalogue's.
    await seedProductTiersSql(em, BASE_BOOK_ID, products, 1);
    // EUR base: the first 300 of them, the same rows.
    euroBase = await ensureBaseBookSql(em, 'EUR');
    await seedProductTiersSql(em, euroBase, products.slice(0, 300), 1);
    // A regular book at 4 999 rows (written past the API, which is what is under test).
    regular = await seedEmptyBookSql(em, 'G18 near the cap');
    await seedProductTiersSql(em, regular, products.slice(0, 4999), 1);
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('a base book above 5 000 rows accepts a batch', async () => {
    expect(await rowCount(BASE_BOOK_ID)).toBeGreaterThan(30_000);
    const res = await api.put(`/api/v1/admin/price-books/${BASE_BOOK_ID}/rows`, {
      expectedVersion: await version(BASE_BOOK_ID),
      upsert: [fixed(products[0]!, '11.5'), fixed(products[0]!, '10.5', 10)],
    });
    expect(res.status, res.raw).toBe(200);
  });

  it('a non-base book is held at 5 000 rows: 5 000 accepted, 5 001 refused', async () => {
    const over = await api.put<ErrorEnvelope>(`/api/v1/admin/price-books/${regular}/rows`, {
      expectedVersion: await version(regular),
      upsert: [fixed(products[5000]!, '1'), fixed(products[5001]!, '1')],
    });
    expect(over.status, over.raw).toBe(400);
    expect(over.body.error.code).toBe('PRICE_BOOK_ROW_LIMIT');
    const at = await api.put(`/api/v1/admin/price-books/${regular}/rows`, {
      expectedVersion: await version(regular),
      upsert: [fixed(products[5000]!, '1')],
    });
    expect(at.status, at.raw).toBe(200);
    expect(await rowCount(regular)).toBe(5000);
    const next = await api.put<ErrorEnvelope>(`/api/v1/admin/price-books/${regular}/rows`, {
      expectedVersion: await version(regular),
      upsert: [fixed(products[5001]!, '1')],
    });
    expect(next.status, next.raw).toBe(400);
    expect(next.body.error.code).toBe('PRICE_BOOK_ROW_LIMIT');
    // A batch that changes stored rows only adds none, so it is accepted at the cap.
    const changed = await api.put(`/api/v1/admin/price-books/${regular}/rows`, {
      expectedVersion: await version(regular),
      upsert: [fixed(products[1]!, '2')],
    });
    expect(changed.status, changed.raw).toBe(200);
  });

  it('a 10-row batch reads the same rows and issues the same statements on a 300-row and a 30 000-row book', async () => {
    const batch = (bookId: string, round: number) => async () =>
      api.put(`/api/v1/admin/price-books/${bookId}/rows`, {
        expectedVersion: await version(bookId),
        upsert: products.slice(100, 110).map((id, i) => ({
          selection: { productId: id },
          minQuantity: 1,
          maxQuantity: null,
          price: { type: 'fixed', amount: String(20 + i + round) },
        })),
      });
    // Warm both paths (caches, prepared lookups), then measure.
    expect((await batch(euroBase, 0)()).status).toBe(200);
    expect((await batch(BASE_BOOK_ID, 0)()).status).toBe(200);
    const measure = async (bookId: string) => {
      const v = await version(bookId);
      return measureStatements(h.em(), () =>
        api.put(`/api/v1/admin/price-books/${bookId}/rows`, {
          expectedVersion: v,
          upsert: products.slice(100, 110).map((id, i) => ({
            selection: { productId: id },
            minQuantity: 1,
            maxQuantity: null,
            price: { type: 'fixed', amount: String(30 + i) },
          })),
        }),
      );
    };
    const small = await measure(euroBase);
    const large = await measure(BASE_BOOK_ID);
    expect(small.result.status, small.result.raw).toBe(200);
    expect(large.result.status, large.result.raw).toBe(200);
    expect(large.statements).toBe(small.statements);
    expect(large.rows).toBe(small.rows);

    const dryRun = async (bookId: string) => {
      const v = await version(bookId);
      return measureStatements(h.em(), () =>
        api.put(`/api/v1/admin/price-books/${bookId}/rows?dryRun=true`, {
          expectedVersion: v,
          upsert: products.slice(100, 110).map((id) => ({ selection: { productId: id }, minQuantity: 1, maxQuantity: null, price: { type: 'fixed', amount: '1' } })),
        }),
      );
    };
    const smallPreview = await dryRun(euroBase);
    const largePreview = await dryRun(BASE_BOOK_ID);
    expect(largePreview.statements).toBe(smallPreview.statements);
    expect(largePreview.rows).toBe(smallPreview.rows);
  });

  it('replace mode on a large base book still lists every removed row in the dry run', async () => {
    const stored = (await h.em().getConnection().execute(
      `select "id", "product_id" from "price_list_matrix_entries" where "price_list_id" = ?`,
      [BASE_BOOK_ID],
    )) as Array<{ id: string; product_id: string }>;
    const keep = products.slice(200, 210);
    const res = await api.put<Envelope<PriceBookRowsDryRun>>(`/api/v1/admin/price-books/${BASE_BOOK_ID}/rows?dryRun=true`, {
      mode: 'replace',
      upsert: keep.map((id) => ({ selection: { productId: id }, minQuantity: 1, maxQuantity: null, price: { type: 'fixed', amount: '7' } })),
    });
    expect(res.status, res.raw).toBe(200);
    const { diff, errors } = res.body.data;
    expect(errors).toEqual([]);
    const kept = new Set(stored.filter((r) => keep.includes(r.product_id)).map((r) => r.id));
    expect(diff.changed.map((c) => c.before.id).sort()).toEqual([...kept].sort());
    expect(diff.removed.map((r) => r.id).sort()).toEqual(stored.filter((r) => !kept.has(r.id)).map((r) => r.id).sort());
    expect(diff.removed.length).toBeGreaterThan(29_000);
    expect(diff.removed[0]!.price).toEqual(expect.objectContaining({ type: 'fixed' }));
  });
});
