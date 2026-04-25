import type { ReactNode } from 'react';
import { notFound } from 'next/navigation';
import { Breadcrumbs } from '../../../../components/Breadcrumbs';
import { FilterPanel } from '../../../../components/FilterPanel';
import { ProductGrid } from '../../../../components/ProductGrid';
import { Pagination } from '../../../../components/Pagination';
import {
  getCategoryTree,
  getFilters,
  listProducts,
} from '../../../../lib/api/catalog';
import type { CategoryNode } from '@b2b/contracts';
import { getServerContext } from '../../../../lib/server-context';
import { tForLocale } from '../../../../lib/i18n/messages';

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

  const attributeFilters = collectAttributeFilters(sp);
  const baseQuery: Record<string, string> = {};
  if (typeof sp['sort'] === 'string') baseQuery['sort'] = sp['sort'];

  const products = await listProducts(
    {
      categorySlug: slug,
      ...(Object.keys(attributeFilters).length > 0 ? { attributeFilters } : {}),
      ...(typeof sp['cursor'] === 'string' ? { cursor: sp['cursor'] } : {}),
    },
    ctx,
  );

  return (
    <>
      <Breadcrumbs
        crumbs={[
          { href: '/', label: t('nav.home') },
          { href: '/catalog', label: t('catalog.heading') },
          { href: `/c/${node.slug}`, label: node.name },
        ]}
      />
      <h1>{node.name}</h1>
      <div className="b2b-listing">
        <FilterPanel
          filters={filters}
          selected={attributeFilters}
          baseQuery={baseQuery}
          locale={locale}
        />
        <div>
          <ProductGrid products={products.data} locale={locale} />
          <Pagination
            basePath={`/c/${node.slug}`}
            baseQuery={baseQuery}
            nextCursor={products.pagination.nextCursor}
            hasMore={products.pagination.hasMore}
            locale={locale}
          />
        </div>
      </div>
    </>
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
