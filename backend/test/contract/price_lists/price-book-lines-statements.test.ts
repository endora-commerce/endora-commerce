import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PriceBookLinesResponse } from '@endora-commerce/contracts';
import { setupBackendServer, teardownBackendServer, type BackendServerHandle } from '../../helpers/test-server.js';
import { priceBookApi, type ApiClient } from '../../helpers/price-book-admin.js';
import {
  measureStatements,
  seedBulkProductsSql,
  seedEmptyBookSql,
  seedProductTiersSql,
} from '../../helpers/price-book-bulk.js';

/**
 * Feature 161, G15 (`contracts/backend-gaps.md`) — a page of a book's lines
 * costs the same number of statements whatever the book's size: the distinct
 * selections in one scan, the page cut by the catalogue's ordering
 * (`catalogProductReadPort.pageProductsByAdminName`), and rows and labels read for
 * the page's lines only. Measured over the whole request, first and last page,
 * with and without a search, at 300 and at 30 000 lines.
 *
 * Since the G15 redesign (`research.md` R14) the page comes from the
 * catalogue's stored admin name key through a membership seam, and the count
 * from `price_list_product_lines`; the assertions are the same.
 */
describe('price-book lines — statements per page do not grow with the book (161 G15)', () => {
  let h: BackendServerHandle;
  let api: ApiClient;
  let small: string;
  let large: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    api = priceBookApi(h);
    const em = h.em();
    const products = await seedBulkProductsSql(em, { count: 30_000, namePrefix: 'Statement', skuPrefix: 'G15S' });
    small = await seedEmptyBookSql(em, 'G15 300 lines');
    large = await seedEmptyBookSql(em, 'G15 30 000 lines');
    await seedProductTiersSql(em, small, products.slice(0, 300), 2);
    await seedProductTiersSql(em, large, products, 2);
  }, 5 * 60_000);

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  const measure = async (bookId: string, query: string) => {
    const url = `/api/v1/admin/price-books/${bookId}/lines?lang=en&pageSize=100&${query}`;
    const warm = await api.get<PriceBookLinesResponse>(url);
    expect(warm.status, warm.raw).toBe(200);
    const { statements, result } = await measureStatements(h.em(), () => api.get<PriceBookLinesResponse>(url));
    expect(result.status, result.raw).toBe(200);
    return { statements, body: result.body };
  };

  it('the first page, the last page and a searched page cost the same at 300 and at 30 000 lines', async () => {
    const firstSmall = await measure(small, 'page=1');
    const firstLarge = await measure(large, 'page=1');
    expect(firstSmall.body.data.length).toBe(100);
    expect(firstLarge.body.data.length).toBe(100);
    expect(firstSmall.body.meta.totalLines).toBe(300);
    expect(firstLarge.body.meta.totalLines).toBe(30_000);
    expect(firstLarge.statements).toBe(firstSmall.statements);

    const lastSmall = await measure(small, 'page=3');
    const lastLarge = await measure(large, 'page=300');
    expect(lastLarge.body.data.length).toBe(100);
    expect(lastLarge.statements).toBe(lastSmall.statements);
    expect(lastLarge.statements).toBe(firstLarge.statements);

    const searchSmall = await measure(small, 'page=1&search=Statement%2000');
    const searchLarge = await measure(large, 'page=1&search=Statement%2000');
    expect(searchLarge.body.data.length).toBe(100);
    expect(searchLarge.statements).toBe(searchSmall.statements);

    // 161 G15 redesign — a broad search takes the catalogue's dense path on the
    // large book (30 000 matches) and its sparse path on the small one (300):
    // the same statements either way.
    const broadSmall = await measure(small, 'page=2&search=statement');
    const broadLarge = await measure(large, 'page=2&search=statement');
    expect(broadSmall.body.meta.totalLines).toBe(300);
    expect(broadLarge.body.meta.totalLines).toBe(30_000);
    expect(broadLarge.statements).toBe(broadSmall.statements);
    expect(broadLarge.statements).toBe(searchLarge.statements);
  });
});
