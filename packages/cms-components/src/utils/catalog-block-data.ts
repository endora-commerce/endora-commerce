import type { CmsCategoryNode, CmsProductSummary } from '../schema/catalog-types.js';
import { filterCategories } from './catalog-fetch.js';

/**
 * What a catalogue block needs before it can render, declared as data.
 *
 * A block that fills itself in from an effect renders its loading branch on
 * the server, because an effect needs a browser: the document a crawler, a
 * link preview or a reader without JavaScript receives holds no product at
 * all. So the read is lifted out of the block. Each catalogue block **declares**
 * its request here, the application that renders the page **resolves** the
 * requests on the server, and the block **reads** its answer from
 * `CatalogPreviewProvider`'s `data` under {@link catalogBlockDataKey}.
 *
 * This module is deliberately not a `'use client'` module and imports no React:
 * a Server Component calls it directly. The block components call the same
 * declarations, which is what keeps the key a block reads and the key the
 * server wrote from being two spellings of one thing.
 */

export type CatalogCategorySelectionMode = 'all' | 'manual' | 'childrenOf';

export type CatalogBlockDataRequest =
  | { readonly kind: 'products-by-slugs'; readonly slugs: readonly string[] }
  | {
      readonly kind: 'products-list';
      readonly categorySlug?: string;
      readonly q?: string;
      readonly limit: number;
    }
  | {
      readonly kind: 'categories';
      readonly selectionMode: CatalogCategorySelectionMode;
      readonly categorySlugs: readonly string[];
      readonly parentSlug: string;
      readonly maxDepth?: number;
    };

/** One category as the category blocks render it. */
export interface CatalogCategoryItem {
  slug: string;
  name: string;
  productCount: number;
  depth: number;
}

/**
 * Resolved answers, keyed by {@link catalogBlockDataKey}. Plain JSON, so it
 * crosses from a Server Component to the provider as a prop.
 *
 * A request with no entry is one whose read failed: its block renders the
 * empty state it has always had, and the rest of the page is unaffected.
 */
export type CatalogBlockData = Readonly<Record<string, CmsProductSummary[] | CatalogCategoryItem[]>>;

/** Where the resolver reads from. The application supplies it, with the request's identity. */
export interface CatalogBlockDataSource {
  /** One product, or `null` when it does not exist or is not visible to this viewer. */
  fetchProductBySlug: (slug: string) => Promise<CmsProductSummary | null>;
  fetchProductsList: (query: { categorySlug?: string; q?: string; limit: number }) => Promise<CmsProductSummary[]>;
  fetchCategoryTree: () => Promise<CmsCategoryNode[]>;
}

type BlockProps = Readonly<Record<string, unknown>>;

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function texts(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/** The request of a product grid or slider — the two share one source model. */
export function productSourceDataRequest(props: {
  source?: string | undefined;
  productSlugs?: readonly string[] | undefined;
  categorySlug?: string | undefined;
  searchQuery?: string | undefined;
  limit?: number | undefined;
}): CatalogBlockDataRequest {
  const source = props.source ?? 'manual';
  if (source === 'manual') return { kind: 'products-by-slugs', slugs: [...(props.productSlugs ?? [])] };
  const limit = typeof props.limit === 'number' && Number.isFinite(props.limit) ? props.limit : 12;
  return {
    kind: 'products-list',
    ...(source === 'category' && props.categorySlug ? { categorySlug: props.categorySlug } : {}),
    ...(source === 'query' && props.searchQuery ? { q: props.searchQuery } : {}),
    limit,
  };
}

/** The request of a product card, or `null` while no product is selected. */
export function productCardDataRequest(props: { productSlug?: string | undefined }): CatalogBlockDataRequest | null {
  return props.productSlug ? { kind: 'products-by-slugs', slugs: [props.productSlug] } : null;
}

/** The request of a category list or grid — the two share one selection model. */
export function categorySelectionDataRequest(props: {
  selectionMode?: string | undefined;
  categorySlugs?: readonly string[] | undefined;
  parentSlug?: string | undefined;
  maxDepth?: number | undefined;
}): CatalogBlockDataRequest {
  const mode = props.selectionMode;
  return {
    kind: 'categories',
    selectionMode: mode === 'manual' || mode === 'childrenOf' ? mode : 'all',
    categorySlugs: [...(props.categorySlugs ?? [])],
    parentSlug: props.parentSlug ?? '',
    ...(typeof props.maxDepth === 'number' ? { maxDepth: props.maxDepth } : {}),
  };
}

/**
 * The declarations, keyed by the block name a stored document carries. A block
 * absent from this map shows no catalogue data and costs the server nothing.
 */
const DECLARATIONS: Readonly<Record<string, (props: BlockProps) => CatalogBlockDataRequest | null>> = {
  'catalog.ProductGrid': (props) =>
    productSourceDataRequest({
      source: text(props['source']) || undefined,
      productSlugs: texts(props['productSlugs']),
      categorySlug: text(props['categorySlug']),
      searchQuery: text(props['searchQuery']),
      limit: typeof props['limit'] === 'number' ? props['limit'] : undefined,
    }),
  'catalog.ProductSlider': (props) =>
    productSourceDataRequest({
      source: text(props['source']) || undefined,
      productSlugs: texts(props['productSlugs']),
      categorySlug: text(props['categorySlug']),
      searchQuery: text(props['searchQuery']),
      limit: typeof props['limit'] === 'number' ? props['limit'] : undefined,
    }),
  'catalog.ProductCard': (props) => productCardDataRequest({ productSlug: text(props['productSlug']) }),
  'catalog.CategoryList': (props) =>
    categorySelectionDataRequest({
      selectionMode: text(props['selectionMode']) || undefined,
      categorySlugs: texts(props['categorySlugs']),
      parentSlug: text(props['parentSlug']),
      maxDepth: typeof props['maxDepth'] === 'number' ? props['maxDepth'] : undefined,
    }),
  'catalog.CategoryGrid': (props) =>
    categorySelectionDataRequest({
      selectionMode: text(props['selectionMode']) || undefined,
      categorySlugs: texts(props['categorySlugs']),
      parentSlug: text(props['parentSlug']),
      maxDepth: typeof props['maxDepth'] === 'number' ? props['maxDepth'] : undefined,
    }),
};

/** What the block `type` with these stored props needs, or `null` for a block that needs nothing. */
export function catalogBlockDataRequestOf(type: string, props: BlockProps): CatalogBlockDataRequest | null {
  const declare = Object.hasOwn(DECLARATIONS, type) ? DECLARATIONS[type] : undefined;
  return declare === undefined ? null : declare(props);
}

/**
 * The key a request's answer is stored and read under. A fixed field order
 * rather than `JSON.stringify(request)`, so two blocks asking the same question
 * share one read whatever order their props were written in.
 */
export function catalogBlockDataKey(request: CatalogBlockDataRequest): string {
  switch (request.kind) {
    case 'products-by-slugs':
      return JSON.stringify(['products-by-slugs', request.slugs]);
    case 'products-list':
      return JSON.stringify(['products-list', request.categorySlug ?? null, request.q ?? null, request.limit]);
    case 'categories':
      return JSON.stringify([
        'categories',
        request.selectionMode,
        request.categorySlugs,
        request.parentSlug,
        request.maxDepth ?? null,
      ]);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Every distinct request the given Page Builder documents declare.
 *
 * The walk is by shape rather than by Puck's document schema: a block is any
 * `{ type, props }` node, wherever it sits — top-level `content`, a legacy
 * `zones` entry, or a slot array inside another block's props. A document that
 * is not an object contributes nothing.
 */
export function collectCatalogBlockDataRequests(documents: readonly unknown[]): CatalogBlockDataRequest[] {
  const found = new Map<string, CatalogBlockDataRequest>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!isRecord(node)) return;
    const type = node['type'];
    const props = node['props'];
    if (typeof type === 'string' && isRecord(props)) {
      const request = catalogBlockDataRequestOf(type, props);
      if (request !== null) found.set(catalogBlockDataKey(request), request);
    }
    for (const value of Object.values(node)) {
      if (typeof value === 'object' && value !== null) visit(value);
    }
  };
  visit(documents);
  return [...found.values()];
}

/** Run `task` over `items` in parallel, at most `limit` at a time. Never rejects: a task's failure is its own. */
async function settleBounded<T, R>(
  items: readonly T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<PromiseSettledResult<R>[]> {
  const results = new Array<PromiseSettledResult<R>>(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next;
      next += 1;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index] as T) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker));
  return results;
}

/** The fields a block renders, and no other field the source happened to return. */
function toSummary(product: CmsProductSummary): CmsProductSummary {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    sku: product.sku,
    primaryAssetUrl: product.primaryAssetUrl ?? null,
    price: product.price ? { amount: product.price.amount, currency: product.price.currency } : null,
    stockLevel: product.stockLevel ?? null,
  };
}

/** How many reads one page may have in flight at once. */
export const CATALOG_BLOCK_DATA_CONCURRENCY = 6;

/**
 * Resolve the requests of one page.
 *
 * - **One pass, in parallel, bounded.** Every distinct read of the page — each
 *   product once however many blocks show it, each listing, the category tree
 *   once — is started together and at most `concurrency` are in flight.
 *   Nothing waits on another block's answer.
 * - **A failed read is that block's alone.** It is left out of the result, so
 *   its block renders its empty state; this function does not reject.
 * - **Only what a block renders is handed on**, so a source that returns a
 *   richer record does not put it into the page payload.
 */
export async function resolveCatalogBlockData(
  requests: readonly CatalogBlockDataRequest[],
  source: CatalogBlockDataSource,
  options: { concurrency?: number } = {},
): Promise<CatalogBlockData> {
  type Unit =
    | { readonly kind: 'product'; readonly slug: string }
    | { readonly kind: 'list'; readonly key: string; readonly request: CatalogBlockDataRequest & { kind: 'products-list' } }
    | { readonly kind: 'tree' };

  const slugs = new Set<string>();
  const units: Unit[] = [];
  let needsTree = false;
  for (const request of requests) {
    if (request.kind === 'products-by-slugs') for (const slug of request.slugs) slugs.add(slug);
    else if (request.kind === 'products-list') units.push({ kind: 'list', key: catalogBlockDataKey(request), request });
    else needsTree = true;
  }
  for (const slug of slugs) units.push({ kind: 'product', slug });
  if (needsTree) units.push({ kind: 'tree' });

  const productBySlug = new Map<string, CmsProductSummary>();
  const data: Record<string, CmsProductSummary[] | CatalogCategoryItem[]> = {};
  let tree: CmsCategoryNode[] | null = null;

  await settleBounded(units, options.concurrency ?? CATALOG_BLOCK_DATA_CONCURRENCY, async (unit) => {
    if (unit.kind === 'product') {
      const product = await source.fetchProductBySlug(unit.slug);
      if (product) productBySlug.set(unit.slug, toSummary(product));
    } else if (unit.kind === 'list') {
      const { categorySlug, q, limit } = unit.request;
      const list = await source.fetchProductsList({
        ...(categorySlug !== undefined ? { categorySlug } : {}),
        ...(q !== undefined ? { q } : {}),
        limit,
      });
      data[unit.key] = list.map(toSummary);
    } else {
      tree = await source.fetchCategoryTree();
    }
  });

  const resolvedTree = tree as CmsCategoryNode[] | null;
  for (const request of requests) {
    if (request.kind === 'products-by-slugs') {
      data[catalogBlockDataKey(request)] = request.slugs
        .map((slug) => productBySlug.get(slug))
        .filter((product): product is CmsProductSummary => product !== undefined);
    } else if (request.kind === 'categories' && resolvedTree !== null) {
      data[catalogBlockDataKey(request)] = filterCategories(resolvedTree, {
        selectionMode: request.selectionMode,
        categorySlugs: [...request.categorySlugs],
        parentSlug: request.parentSlug,
        ...(request.maxDepth !== undefined ? { maxDepth: request.maxDepth } : {}),
      });
    }
  }
  return data;
}
