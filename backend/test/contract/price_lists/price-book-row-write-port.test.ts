import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  ERROR_CODES,
  PRICE_BOOK_ROW_WRITE_PORT,
  bookProductRowsSchema,
  type PriceBookRowWritePort,
} from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { setupPricingFixture, type PricingFixture } from '../../helpers/pricing-fixture.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';

/**
 * Issue #1028 — the contract of `priceBookRowWritePort` as the composed
 * platform serves it: registered by `price_lists` under the container name
 * the contracts declare, answering the declared shape, refusing a base book
 * with its own code, and writing rows the admin API then reads as its own —
 * the same rows, under its own audit verb, with the book's version moved.
 */
describe('priceBookRowWritePort — the composed container serves the contract (issue #1028)', () => {
  let h: BackendServerHandle;
  let f: PricingFixture;
  let api: ApiClient;
  let port: PriceBookRowWritePort;

  beforeAll(async () => {
    h = await setupBackendServer();
    f = await setupPricingFixture(h);
    api = priceBookApi(h);
    port = (h.container as unknown as { resolve<T>(name: string): T }).resolve<PriceBookRowWritePort>(
      PRICE_BOOK_ROW_WRITE_PORT,
    );
  }, 5 * 60_000);

  afterAll(async () => {
    await f.clearBooks();
    await teardownBackendServer(h);
  });

  it('resolves under the declared name with the three declared methods', () => {
    expect(PRICE_BOOK_ROW_WRITE_PORT).toBe('priceBookRowWritePort');
    expect(typeof port.replaceBookRows).toBe('function');
    expect(typeof port.removeBookRows).toBe('function');
    expect(typeof port.bookRows).toBe('function');
  });

  it('writes rows the admin API reads, answering the declared shape, audited under its own verb', async () => {
    const book = await f.book({ audience: { groups: [f.groups.VIP] } });
    const read = async () =>
      (await api.get<{ data: { version: number } }>(`/api/v1/admin/price-books/${book.id}`)).body.data.version;
    const versionBefore = await read();
    const before = await h.em().fork().count(AuditLogEntry, { objectId: book.id, action: 'price_list.book_rows_set' });

    const answer = await f.system(() =>
      port.replaceBookRows(book.id, f.products.P3.id, {
        product: [
          { minQuantity: 1, maxQuantity: 4, amount: '29' },
          { minQuantity: 5, maxQuantity: null, amount: '27.5' },
        ],
      }),
    );
    expect(bookProductRowsSchema.parse(answer)).toEqual(answer);
    expect(answer.version).toBe(versionBefore + 1);
    expect(await read()).toBe(versionBefore + 1);
    expect(await h.em().fork().count(AuditLogEntry, { objectId: book.id, action: 'price_list.book_rows_set' })).toBe(before + 1);

    const rows = await api.get<{ data: Array<{ selection: { productId: string | null }; minQuantity: number; price: unknown }> }>(
      `/api/v1/admin/price-books/${book.id}/rows?pageSize=100`,
    );
    expect(rows.status, rows.raw).toBe(200);
    expect(
      rows.body.data
        .filter((r) => r.selection.productId === f.products.P3.id)
        .map((r) => ({ minQuantity: r.minQuantity, price: r.price })),
    ).toEqual([
      { minQuantity: 1, price: { type: 'fixed', amount: '29.0000' } },
      { minQuantity: 5, price: { type: 'fixed', amount: '27.5000' } },
    ]);
  });

  it('refuses a base book with PRICE_BOOK_BASE_BOOK', async () => {
    const [base] = await h
      .em()
      .getConnection()
      .execute<Array<{ id: string }>>(`select "id" from "price_lists" where "is_system" and "currency_code" = 'PLN'`);
    await expect(
      f.system(() => port.replaceBookRows(base!.id, f.products.P3.id, { product: [] })),
    ).rejects.toMatchObject({ statusCode: 409, code: ERROR_CODES.PRICE_BOOK_BASE_BOOK });
  });
});
