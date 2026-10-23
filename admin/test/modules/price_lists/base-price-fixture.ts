import { vi } from 'vitest';
import { productBasePricesSchema, type PriceBookSummary, type ProductBasePrices } from '@endora-commerce/contracts';

/**
 * The base-price panel's server (feature 161, US3 tests): `worked-examples.md`
 * §10.14's configurable **P5** *Screws 0500* with variants **P5r** (red,
 * +10 %) and **P5b** (blue, inherits), base 80 PLN; EUR offered by a channel
 * and not priced yet.
 */

export const P5 = '00000000-0000-4000-8000-000000161b05';
export const P5R = '00000000-0000-4000-8000-000000161b51';
export const P5B = '00000000-0000-4000-8000-000000161b52';
const BASE_PLN = '00000000-0000-4000-8000-00000000d51b';

export const B = '/api/v1/admin/price-books';

export function basePrices(overrides: Partial<ProductBasePrices> = {}): ProductBasePrices {
  return productBasePricesSchema.parse({
    productId: P5,
    byCurrency: {
      PLN: {
        bookId: BASE_PLN,
        product: [{ minQuantity: 1, maxQuantity: null, amount: '80.0000' }],
        variants: { [P5R]: { type: 'percent', percent: '10.00' }, [P5B]: null },
      },
    },
    writable: true,
    ...overrides,
  });
}

export interface MockApi {
  readonly get: ReturnType<typeof vi.fn>;
  readonly put: ReturnType<typeof vi.fn>;
}

export function serveBasePrices(api: MockApi, answer: ProductBasePrices, books: PriceBookSummary[] = []): void {
  api.get.mockImplementation(async (url: string) => {
    const [path] = url.split('?');
    if (path === `${B}/base-prices`) return { data: answer };
    if (path === `${B}/targets/currencies`) return { data: { items: [{ code: 'EUR', exposedByChannels: ['b2b_eu'] }, { code: 'PLN', exposedByChannels: ['b2b_pl'] }] } };
    if (path === `/api/v1/admin/catalog/products/${P5}/variants`) {
      return {
        data: [
          { id: P5B, parentProductId: P5, sku: 'P5B', variantAttributeValues: { color: 'blue' }, stockLevel: null, createdAt: '2026-10-23T10:00:00.000Z', updatedAt: '2026-10-23T10:00:00.000Z' },
          { id: P5R, parentProductId: P5, sku: 'P5R', variantAttributeValues: { color: 'red' }, stockLevel: null, createdAt: '2026-10-23T10:00:00.000Z', updatedAt: '2026-10-23T10:00:00.000Z' },
        ],
      };
    }
    if (path === B) return { data: books, meta: { page: 1, pageSize: 200, totalCount: books.length, creatableAudienceKinds: [] } };
    throw new Error(`unexpected GET ${url}`);
  });
}
