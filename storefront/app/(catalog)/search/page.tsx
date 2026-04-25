import type { ReactNode } from 'react';
import CatalogPage from '../catalog/page';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/**
 * `/search` is functionally identical to `/catalog?q=…` today (backend
 * search is Postgres-based via catalog-query.service). Once the
 * Meilisearch indexer ships (T067/T068), the ranked-search bridge will
 * replace this re-export so the search route can carry richer
 * relevance metadata without affecting the plain catalog listing.
 */
export default async function SearchPage(props: PageProps): Promise<ReactNode> {
  return CatalogPage(props);
}
