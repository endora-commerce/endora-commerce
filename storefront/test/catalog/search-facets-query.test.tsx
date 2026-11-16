import { beforeEach, describe, expect, it, vi } from 'vitest';
import CatalogPage from '../../app/(catalog)/catalog/page';

/**
 * Issue #1326 — the catalogue listing asks for its filter counts with the
 * text query it lists, so `/search?q=…` (which renders this page) shows the
 * counts of its own result set rather than of the whole catalogue.
 */
const getFilters = vi.fn(async (..._args: unknown[]): Promise<unknown[]> => []);

vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({
    locale: 'en-US',
    ctx: { salesChannelCode: 'pl_retail', locale: 'en-US' },
    modules: { isPresent: () => true, presentIds: [], absentIds: [] },
  }),
}));
vi.mock('../../lib/api/catalog', () => ({
  listProducts: async () => ({ data: [], pagination: { cursor: null, hasMore: false, limit: 24 } }),
  getFilters: (...args: unknown[]) => getFilters(...args),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => undefined }),
  usePathname: () => '/catalog',
}));

beforeEach(() => {
  getFilters.mockClear();
});

describe('catalog listing — filter counts follow the text query', () => {
  it('passes `q` to the filters read', async () => {
    await CatalogPage({ searchParams: Promise.resolve({ q: 'bearing' }) });

    expect(getFilters).toHaveBeenCalledTimes(1);
    expect(getFilters.mock.calls[0]).toEqual([
      { salesChannelCode: 'pl_retail', locale: 'en-US' },
      { q: 'bearing' },
    ]);
  });

  it('passes no query when browsing', async () => {
    await CatalogPage({ searchParams: Promise.resolve({}) });

    expect(getFilters.mock.calls[0]?.[1]).toEqual({});
  });
});
