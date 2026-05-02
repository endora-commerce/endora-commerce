import type { ReactNode } from 'react';
import { ProductGrid } from '../../../components/ProductGrid';
import { FilterPanel } from '../../../components/FilterPanel';
import { Pagination } from '../../../components/Pagination';
import { Breadcrumbs } from '../../../components/Breadcrumbs';
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
          locale={locale}
        />
        <div>
          <div className="industria-catalog__title">
            <div>
              <h1>{heading}</h1>
              <p>{products.data.length.toLocaleString('pl-PL')} produktów</p>
            </div>
          </div>
          <div className="industria-toolbar">
            <div className="industria-toolbar__left">
              Pokazuję <strong>1–{products.data.length}</strong> wyników
            </div>
            <div className="industria-toolbar__right">
              <select className="industria-select" name="sort" defaultValue={query.list.sort ?? 'relevance'}>
                <option value="relevance">Sortuj: trafność</option>
                <option value="-createdAt">Najnowsze</option>
                <option value="name">Nazwa A–Z</option>
                <option value="-name">Nazwa Z–A</option>
              </select>
            </div>
          </div>
          <ProductGrid products={products.data} locale={locale} columns={3} />
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
    attributeFilters?: Record<string, string[]> | undefined;
  };
  baseQuery: Record<string, string>;
} {
  const baseQuery: Record<string, string> = {};
  const attributeFilters: Record<string, string[]> = {};
  let q: string | undefined;
  let sort: 'relevance' | '-createdAt' | 'name' | '-name' | undefined;
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
      ...(Object.keys(attributeFilters).length > 0 ? { attributeFilters } : {}),
    },
    baseQuery,
  };
}
