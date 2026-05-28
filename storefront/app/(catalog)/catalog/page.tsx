import type { ReactNode } from 'react';
import { ProductGrid } from '../../../components/ProductGrid';
import { FilterPanel } from '../../../components/FilterPanel';
import { Pagination } from '../../../components/Pagination';
import { Breadcrumbs } from '../../../components/Breadcrumbs';
import { CatalogToolbar } from '../../../components/CatalogToolbar';
import { listProducts, getFilters } from '../../../lib/api/catalog';
import { getServerContext } from '../../../lib/server-context';
import { tForLocale } from '../../../lib/i18n/messages';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Catalog listing — SSR, with cursor pagination and a hidden-form filter
 * panel that round-trips through the URL. Same page handles `?q=…`
 * search; the dedicated `/search` route just defers to this listing.
 */
export default async function CatalogPage({ searchParams }: PageProps): Promise<ReactNode> {
  const params = await searchParams;
  const { ctx, locale } = await getServerContext();
  const t = tForLocale(locale);
  const query = parseQuery(params);

  const [products, filters] = await Promise.all([
    listProducts(query.list, ctx),
    getFilters(ctx),
  ]);

  const heading = query.list.q
    ? `${t('common.searchAction')}: ${query.list.q}`
    : t('catalog.heading');

  return (
    <div className="container">
      <Breadcrumbs
        crumbs={[
          { href: '/', label: t('nav.home') },
          { href: '/catalog', label: t('catalog.heading') },
        ]}
      />
      <div className="industria-catalog">
        <FilterPanel
          filters={filters}
          selected={query.list.attributeFilters ?? {}}
          baseQuery={query.baseQuery}
          basePath="/catalog"
          locale={locale}
        />
        <div>
          <div className="industria-catalog__title">
            <div>
              <h1>{heading}</h1>
              <p>{products.data.length.toLocaleString('pl-PL')} produktów</p>
            </div>
          </div>
          <CatalogToolbar
            shown={products.data.length}
            sort={query.list.sort ?? 'relevance'}
            limit={query.list.limit ?? 24}
            view={query.view}
            baseQuery={query.baseQuery}
          />
          <ProductGrid
            products={products.data}
            locale={locale}
            columns={3}
            view={query.view}
          />
          <Pagination
            basePath="/catalog"
            baseQuery={query.baseQuery}
            nextCursor={products.pagination.nextCursor}
            hasMore={products.pagination.hasMore}
            locale={locale}
          />
        </div>
      </div>
    </div>
  );
}

function parseQuery(raw: Record<string, string | string[] | undefined>): {
  list: {
    q?: string | undefined;
    cursor?: string | undefined;
    sort?: 'relevance' | '-createdAt' | 'name' | '-name' | undefined;
    limit?: 24 | 48 | 96 | undefined;
    attributeFilters?: Record<string, string[]> | undefined;
  };
  view: 'grid' | 'list';
  baseQuery: Record<string, string>;
} {
  const baseQuery: Record<string, string> = {};
  const attributeFilters: Record<string, string[]> = {};
  let q: string | undefined;
  let sort: 'relevance' | '-createdAt' | 'name' | '-name' | undefined;
  let limit: 24 | 48 | 96 | undefined;
  let view: 'grid' | 'list' = 'grid';
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    if (key === 'q' && typeof value === 'string') {
      q = value;
      baseQuery['q'] = value;
      continue;
    }
    if (key === 'sort' && typeof value === 'string') {
      if (value === 'relevance' || value === '-createdAt' || value === 'name' || value === '-name') {
        sort = value;
        baseQuery['sort'] = value;
      }
      continue;
    }
    if (key === 'limit' && typeof value === 'string') {
      const n = Number(value);
      if (n === 24 || n === 48 || n === 96) {
        limit = n;
        baseQuery['limit'] = String(n);
      }
      continue;
    }
    if (key === 'view' && typeof value === 'string') {
      if (value === 'list') {
        view = 'list';
        baseQuery['view'] = 'list';
      }
      continue;
    }
    if (key === 'cursor' && typeof value === 'string') {
      baseQuery['cursor'] = value;
      continue;
    }
    const attrMatch = /^filter\[attr\.([^\]]+)\]$/.exec(key);
    if (attrMatch && attrMatch[1]) {
      const values = Array.isArray(value) ? value.map(String) : [String(value)];
      attributeFilters[attrMatch[1]] = values;
    }
  }
  return {
    list: {
      ...(q !== undefined ? { q } : {}),
      ...(sort !== undefined ? { sort } : {}),
      ...(limit !== undefined ? { limit } : {}),
      ...(baseQuery['cursor'] !== undefined ? { cursor: baseQuery['cursor'] } : {}),
      ...(Object.keys(attributeFilters).length > 0 ? { attributeFilters } : {}),
    },
    view,
    baseQuery,
  };
}
