import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '../../../../components/Breadcrumbs';
import { FilterPanel } from '../../../../components/FilterPanel';
import { ProductGrid } from '../../../../components/ProductGrid';
import { Pagination } from '../../../../components/Pagination';
import { CatalogToolbar } from '../../../../components/CatalogToolbar';
import { MobileFilterSheet } from '../../../../components/mobile/MobileFilterSheet';
import { Hook } from '../../../../components/Hook';
import {
  getCategoryTree,
  getFilters,
  listProducts,
} from '../../../../lib/api/catalog';
import type { CategoryNode, ProductListSort } from '@endora-commerce/contracts';
import { getServerContext } from '../../../../lib/server-context';
import { tForLocale } from '../../../../lib/i18n/messages';
import {
  parseCatalogPriceQuery,
  parsePriceBound,
  parseSortParam,
  priceControlsActive,
} from '../../../../lib/catalog-price-query';

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * Category landing page. SSR over the catalog listing narrowed by
 * `categorySlug`. The category tree is cached for 5 minutes; mutations
 * in the admin can `revalidateTag('catalog:categories')` to flush.
 */
export default async function CategoryPage({ params, searchParams }: PageProps): Promise<ReactNode> {
  const { slug } = await params;
  const { ctx, locale } = await getServerContext();
  const t = tForLocale(locale);
  const sp = await searchParams;

  const [tree, filters] = await Promise.all([getCategoryTree(ctx), getFilters(ctx)]);
  const node = findCategory(tree, slug);
  if (!node) notFound();

  const parsed = parseChromeQuery(sp);
  const priceQuery = parseCatalogPriceQuery(sp);
  const attributeFilters = collectAttributeFilters(sp);

  const products = await listProducts(
    {
      categorySlug: slug,
      ...(Object.keys(attributeFilters).length > 0 ? { attributeFilters } : {}),
      ...(parsed.sort ? { sort: parsed.sort } : {}),
      ...(parsed.limit ? { limit: parsed.limit } : {}),
      ...(parsed.cursor ? { cursor: parsed.cursor } : {}),
      ...(priceQuery.minPrice !== undefined ? { minPrice: priceQuery.minPrice } : {}),
      ...(priceQuery.maxPrice !== undefined ? { maxPrice: priceQuery.maxPrice } : {}),
    },
    ctx,
  );
  // FR-023 — the server's answer, never the storefront's guess.
  const priceOrdering = products.capabilities?.priceOrdering === true;

  const basePath = `/c/${node.slug}`;
  const activeFilterCount = Object.values(attributeFilters).reduce((n, vs) => n + vs.length, 0);
  const clearParams = new URLSearchParams(
    Object.entries(parsed.baseQuery).filter(([k]) => k !== 'cursor'),
  );
  const clearHref = clearParams.toString() ? `${basePath}?${clearParams.toString()}` : basePath;
  const filterLabels = {
    filters: t('catalog.filters'),
    clear: 'Wyczyść',
    applyTemplate: 'Pokaż {count} wyników',
    close: 'Zamknij',
  };

  return (
    <div className="mx-auto max-w-[1360px] px-[24px]">
      <Breadcrumbs
        crumbs={[
          { href: '/', label: t('nav.home') },
          { href: '/catalog', label: t('catalog.heading') },
          { href: basePath, label: node.name },
        ]}
      />
      <Hook code="category.top" />
      <div className="industria-catalog">
        <div className="max-md:hidden">
          <FilterPanel
            filters={filters}
            selected={attributeFilters}
            baseQuery={parsed.baseQuery}
            basePath={basePath}
            locale={locale}
            priceRange={priceOrdering}
            selectedPriceRange={{ min: priceQuery.minPrice, max: priceQuery.maxPrice }}
          />
        </div>
        <div>
          <div className="industria-catalog__title">
            <div>
              <h1>{node.name}</h1>
              <p>{node.productCount.toLocaleString('pl-PL')} produktów</p>
            </div>
          </div>
          <CatalogToolbar
            shown={products.data.length}
            sort={parsed.sort ?? 'relevance'}
            limit={parsed.limit ?? 24}
            view={parsed.view}
            baseQuery={parsed.baseQuery}
            locale={locale}
            priceOrdering={priceOrdering}
            priceControlsActive={priceOrdering && priceControlsActive(priceQuery)}
            filtersSlot={
              <MobileFilterSheet
                key="mobile-filter-sheet"
                resultCount={products.data.length}
                activeFilterCount={activeFilterCount}
                clearHref={clearHref}
                labels={filterLabels}
              >
                <FilterPanel
                  filters={filters}
                  selected={attributeFilters}
                  priceRange={priceOrdering}
                  selectedPriceRange={{ min: priceQuery.minPrice, max: priceQuery.maxPrice }}
                  baseQuery={parsed.baseQuery}
                  basePath={basePath}
                  locale={locale}
                  variant="sheet"
                />
              </MobileFilterSheet>
            }
          />
          <ProductGrid
            products={products.data}
            locale={locale}
            columns={3}
            view={parsed.view}
          />
          <Pagination
            basePath={`/c/${node.slug}`}
            baseQuery={parsed.baseQuery}
            nextCursor={products.pagination.nextCursor}
            hasMore={products.pagination.hasMore}
            locale={locale}
          />
        </div>
      </div>
      <Hook code="category.bottom" />
    </div>
  );
}

function findCategory(tree: CategoryNode[], slug: string): CategoryNode | null {
  for (const node of tree) {
    if (node.slug === slug) return node;
    const child = findCategory(node.children, slug);
    if (child) return child;
  }
  return null;
}

function collectAttributeFilters(
  raw: Record<string, string | string[] | undefined>,
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;
    const m = /^filter\[attr\.([^\]]+)\]$/.exec(key);
    if (m && m[1]) {
      out[m[1]] = Array.isArray(value) ? value.map(String) : [String(value)];
    }
  }
  return out;
}

function parseChromeQuery(raw: Record<string, string | string[] | undefined>): {
  sort?: ProductListSort;
  limit?: 24 | 48 | 96;
  cursor?: string;
  view: 'grid' | 'list';
  baseQuery: Record<string, string>;
} {
  const baseQuery: Record<string, string> = {};
  const sort = parseSortParam(raw['sort']);
  let limit: 24 | 48 | 96 | undefined;
  let cursor: string | undefined;
  let view: 'grid' | 'list' = 'grid';
  if (sort !== undefined) baseQuery['sort'] = sort;
  for (const key of ['minPrice', 'maxPrice'] as const) {
    const bound = parsePriceBound(raw[key]);
    if (bound !== undefined) baseQuery[key] = String(bound);
  }
  if (typeof raw['limit'] === 'string') {
    const n = Number(raw['limit']);
    if (n === 24 || n === 48 || n === 96) {
      limit = n;
      baseQuery['limit'] = String(n);
    }
  }
  if (typeof raw['view'] === 'string' && raw['view'] === 'list') {
    view = 'list';
    baseQuery['view'] = 'list';
  }
  if (typeof raw['cursor'] === 'string') {
    cursor = raw['cursor'];
    baseQuery['cursor'] = cursor;
  }
  return {
    ...(sort !== undefined ? { sort } : {}),
    ...(limit !== undefined ? { limit } : {}),
    ...(cursor !== undefined ? { cursor } : {}),
    view,
    baseQuery,
  };
}
