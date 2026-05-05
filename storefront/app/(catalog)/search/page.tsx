import type { ReactNode } from 'react';
import CatalogPage from '../catalog/page';
import { listProducts } from '../../../lib/api/catalog';
import { recordPhrase } from '../../../lib/api/search';
import { getServerContext } from '../../../lib/server-context';
import { Hook } from '../../../components/Hook';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/search` is functionally identical to `/catalog?q=…` (FR-005 + US1
 * acceptance #3) — it re-exports `CatalogPage` so the listing, filters,
 * sort, pagination, and empty-state behave the same.
 *
 * The only search-specific behaviour is the analytics fire-and-forget
 * (feature 006 / US3 / T039 / FR-013): when `?q=` is present, dispatch
 * a `POST /api/v1/search/record` with the resolved result count BEFORE
 * delegating to CatalogPage. The promise is intentionally NOT awaited —
 * the page render is never blocked by analytics persistence (FR-015).
 *
 * The result-count read here is a small extra round-trip against the
 * same backend the catalog page hits. Cheaper than threading a "report
 * the count" hook through CatalogPage.
 */
export default async function SearchPage(props: PageProps): Promise<ReactNode> {
  const params = await props.searchParams;
  const q = typeof params['q'] === 'string' ? params['q'].trim() : '';

  if (q.length > 0) {
    const apiBaseUrl =
      process.env['BACKEND_BASE_URL'] ?? 'http://localhost:3001';
    const { ctx } = await getServerContext();
    try {
      const result = await listProducts({ q }, ctx);
      void recordPhrase({
        apiBaseUrl,
        phrase: q,
        resultCount: result.data.length,
        ...(ctx.salesChannelCode !== undefined
          ? { salesChannelCode: ctx.salesChannelCode }
          : {}),
      });
    } catch {
      // The catalog page itself will surface any backend error; we
      // silently skip the analytics record on listProducts failure
      // rather than poison the page.
    }
  }

  return (
    <>
      <Hook code="search.top" />
      {await CatalogPage(props)}
      <Hook code="search.bottom" />
    </>
  );
}
