import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ANONYMOUS_PRODUCT_AUDIENCE,
  ERROR_CODES,
  type DisplayMode,
  type ListingPriceOrderPort,
} from '@endora-commerce/contracts';

import { CatalogQueryService, type CatalogQueryContext, type ListProductsParams } from './catalog-query.service.js';

/**
 * Issue #420 — a page that may not show prices may not be ordered or narrowed
 * by them, and the service holds that itself, not only the public route.
 *
 * The route refuses a price sort or a price range with a 400 when the viewer's
 * page-level display mode is `none` (feature 086, FR-016). The service used to
 * trust its caller: any internal or future caller of `listProducts` that
 * skipped the route's check could narrow a range step by step and infer prices
 * the page withholds. The refusal now comes from the service, before a row or a
 * price is read — the `EntityManager` here throws if it is ever opened.
 */

const CTX: CatalogQueryContext = {
  resolvedChannel: { id: 'ch-1', code: 'pl_retail', defaultCurrency: 'PLN', defaultLanguage: 'pl-PL' },
  audience: ANONYMOUS_PRODUCT_AUDIENCE,
};

function build(mode: DisplayMode) {
  const pageDisplayMode = vi.fn(async () => mode);
  const order = {
    pageDisplayMode,
    orderByUnitPrice: vi.fn(async () => {
      throw new Error('a page that may not show prices must not be ordered by them');
    }),
    pricedProductIds: vi.fn(async () => {
      throw new Error('a page that may not show prices must not be narrowed by them');
    }),
  } as unknown as ListingPriceOrderPort;
  const emFactory = (): EntityManager => {
    throw new Error('the refusal comes before any read');
  };
  const service = new CatalogQueryService(
    emFactory,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    order,
  );
  return { service, pageDisplayMode };
}

describe('CatalogQueryService.listProducts refuses price controls on a page that hides prices (issue #420)', () => {
  it.each<[string, Partial<ListProductsParams>]>([
    ['a price sort', { sort: 'price' }],
    ['a descending price sort', { sort: '-price' }],
    ['a minimum price', { minPrice: 10 }],
    ['a maximum price', { maxPrice: 100 }],
    ['a price range', { minPrice: 10, maxPrice: 100 }],
  ])('refuses %s with PRICE_ORDERING_UNAVAILABLE', async (_name, params) => {
    const { service, pageDisplayMode } = build('none');

    await expect(service.listProducts({ limit: 20, ...params }, CTX)).rejects.toMatchObject({
      statusCode: 400,
      code: ERROR_CODES.PRICE_ORDERING_UNAVAILABLE,
    });
    // Asked for this viewer, in the channel's currency.
    expect(pageDisplayMode).toHaveBeenCalledWith({
      context: expect.objectContaining({
        salesChannel: { id: 'ch-1', defaultCurrency: 'PLN' },
        organization: null,
      }),
    });
  });

  it('does not ask for the display mode when no price control is requested', async () => {
    const { service, pageDisplayMode } = build('none');

    // The default listing reads the database, which this fixture refuses — the
    // point is only that the refusal is not the price guard's.
    await expect(service.listProducts({ limit: 20 }, CTX)).rejects.toThrow('the refusal comes before any read');
    expect(pageDisplayMode).not.toHaveBeenCalled();
  });

  it('lets a price control through when the page shows prices', async () => {
    const { service, pageDisplayMode } = build('gross_only');

    await expect(service.listProducts({ limit: 20, minPrice: 10 }, CTX)).rejects.toThrow(
      'the refusal comes before any read',
    );
    expect(pageDisplayMode).toHaveBeenCalledOnce();
  });
});
