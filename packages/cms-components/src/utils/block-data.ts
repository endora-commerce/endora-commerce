import type { CmsBlogPostCard } from '../schema/blog-types.js';
import type { CmsCategoryNode, CmsProductSummary } from '../schema/catalog-types.js';
import { filterCategories } from './catalog-fetch.js';
import type { FormBlockData } from './catalog-preview-bridge.js';

/**
 * What a data-driven block needs before it can render, declared as data.
 *
 * A block that fills itself in from an effect renders its loading branch on
 * the server, because an effect needs a browser: the document a crawler, a
 * link preview or a reader without JavaScript receives holds no product or
 * post at all. So the read is lifted out of the block. Each such block
 * **declares** its request here, the application that renders the page
 * **resolves** the requests on the server, and the block **reads** its answer
 * from `CatalogPreviewProvider`'s `data` under {@link blockDataKey}.
 *
 * The request kinds are a closed union (`specs/163-page-builder-marketing-pages/`
 * research R-15): the catalogue's three, `blog-posts`, and `form` — the public
 * read of a `forms.Form` block's form (`specs/170-forms-module/` research R-8). Each kind has an
 * owner module ({@link blockDataOwnerOf}); a request whose owner is absent is
 * skipped, so a switched-off module costs the page nothing.
 *
 * This module is deliberately not a `'use client'` module and imports no React:
 * a Server Component calls it directly. The block components call the same
 * declarations, which is what keeps the key a block reads and the key the
 * server wrote from being two spellings of one thing.
 */

export type CatalogCategorySelectionMode = 'all' | 'manual' | 'childrenOf';

export type BlockDataRequest =
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
    }
  | { readonly kind: 'blog-posts'; readonly limit: number; readonly categorySlug?: string }
  | { readonly kind: 'form'; readonly formId: string };

/** One category as the category blocks render it. */
export interface CatalogCategoryItem {
  slug: string;
  name: string;
  productCount: number;
  depth: number;
}

/** One resolved answer: products, categories, blog post cards or a form's public read. */
export type BlockDataValue = CmsProductSummary[] | CatalogCategoryItem[] | CmsBlogPostCard[] | FormBlockData;

/**
 * Resolved answers, keyed by {@link blockDataKey}. Plain JSON, so it
 * crosses from a Server Component to the provider as a prop.
 *
 * A request with no entry is one whose read failed or whose owner module is
 * absent: its block renders its empty state, and the rest of the page is
 * unaffected.
 */
export type BlockData = Readonly<Record<string, BlockDataValue>>;

/** Where the resolver reads from. The application supplies it, with the request's identity. */
export interface BlockDataSource {
  /** One product, or `null` when it does not exist or is not visible to this viewer. */
  fetchProductBySlug: (slug: string) => Promise<CmsProductSummary | null>;
  fetchProductsList: (query: { categorySlug?: string; q?: string; limit: number }) => Promise<CmsProductSummary[]>;
  fetchCategoryTree: () => Promise<CmsCategoryNode[]>;
  /** The newest published posts of the request's channel. Absent: `blog-posts` requests are skipped. */
  fetchBlogPosts?: (query: { limit: number; categorySlug?: string }) => Promise<CmsBlogPostCard[]>;
  /**
   * A form's public read (`GET /api/v1/storefront/forms/:formId`) — viewer-independent, so it is
   * read anonymously. Absent: `form` requests are skipped and the block renders nothing.
   */
  fetchForm?: (formId: string) => Promise<FormBlockData>;
  /**
   * Whether a module is present for this request (both activation axes). A
   * request whose owner answers `false` is skipped and its owner is not asked.
   * Absent: every owner is taken as present, as an unread presence degrades open.
   */
  isModulePresent?: (moduleId: string) => boolean;
}

/** The module that answers a request kind. */
export function blockDataOwnerOf(request: BlockDataRequest): 'catalog' | 'blog' | 'forms' {
  if (request.kind === 'blog-posts') return 'blog';
  if (request.kind === 'form') return 'forms';
  return 'catalog';
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
}): BlockDataRequest {
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
export function productCardDataRequest(props: { productSlug?: string | undefined }): BlockDataRequest | null {
  return props.productSlug ? { kind: 'products-by-slugs', slugs: [props.productSlug] } : null;
}

/** The request of a category list or grid — the two share one selection model. */
export function categorySelectionDataRequest(props: {
  selectionMode?: string | undefined;
  categorySlugs?: readonly string[] | undefined;
  parentSlug?: string | undefined;
  maxDepth?: number | undefined;
}): BlockDataRequest {
  const mode = props.selectionMode;
  return {
    kind: 'categories',
    selectionMode: mode === 'manual' || mode === 'childrenOf' ? mode : 'all',
    categorySlugs: [...(props.categorySlugs ?? [])],
    parentSlug: props.parentSlug ?? '',
    ...(typeof props.maxDepth === 'number' ? { maxDepth: props.maxDepth } : {}),
  };
}

/** Most posts one `blog.LatestPosts` shows (contracts/blocks.md). */
export const LATEST_POSTS_MAX_LIMIT = 12;
/** Posts a `blog.LatestPosts` with no `limit` shows. */
export const LATEST_POSTS_DEFAULT_LIMIT = 6;

/** The request of a latest-posts block: the newest `limit` posts (1–12), optionally of one category. */
export function blogPostsDataRequest(props: {
  limit?: number | undefined;
  categorySlug?: string | undefined;
}): BlockDataRequest {
  const raw = typeof props.limit === 'number' && Number.isFinite(props.limit) ? Math.round(props.limit) : LATEST_POSTS_DEFAULT_LIMIT;
  const limit = Math.min(LATEST_POSTS_MAX_LIMIT, Math.max(1, raw));
  const categorySlug = props.categorySlug?.trim() ?? '';
  return { kind: 'blog-posts', limit, ...(categorySlug ? { categorySlug } : {}) };
}

/** The request of a `forms.Form` block: its form's public read, or `null` while no form is picked. */
export function formBlockDataRequest(props: { formId?: string | undefined }): BlockDataRequest | null {
  const formId = props.formId?.trim() ?? '';
  return formId === '' ? null : { kind: 'form', formId };
}

/**
 * The declarations, keyed by the block name a stored document carries. A block
 * absent from this map shows no fetched data and costs the server nothing.
 */
const DECLARATIONS: Readonly<Record<string, (props: BlockProps) => BlockDataRequest | null>> = {
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
  'blog.LatestPosts': (props) =>
    blogPostsDataRequest({
      limit: typeof props['limit'] === 'number' ? props['limit'] : undefined,
      categorySlug: text(props['categorySlug']),
    }),
  'forms.Form': (props) => formBlockDataRequest({ formId: text(props['formId']) }),
};

/** What the block `type` with these stored props needs, or `null` for a block that needs nothing. */
export function blockDataRequestOf(type: string, props: BlockProps): BlockDataRequest | null {
  const declare = Object.hasOwn(DECLARATIONS, type) ? DECLARATIONS[type] : undefined;
  return declare === undefined ? null : declare(props);
}

/**
 * The key a request's answer is stored and read under. A fixed field order
 * rather than `JSON.stringify(request)`, so two blocks asking the same question
 * share one read whatever order their props were written in.
 */
export function blockDataKey(request: BlockDataRequest): string {
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
    case 'blog-posts':
      return JSON.stringify(['blog-posts', request.categorySlug ?? null, request.limit]);
    case 'form':
      return JSON.stringify(['form', request.formId]);
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
export function collectBlockDataRequests(documents: readonly unknown[]): BlockDataRequest[] {
  const found = new Map<string, BlockDataRequest>();
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (!isRecord(node)) return;
    const type = node['type'];
    const props = node['props'];
    if (typeof type === 'string' && isRecord(props)) {
      const request = blockDataRequestOf(type, props);
      if (request !== null) found.set(blockDataKey(request), request);
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
    summary: product.summary ?? null,
  };
}

/** The fields a post card renders. */
function toPostCard(post: CmsBlogPostCard): CmsBlogPostCard {
  return {
    id: post.id,
    slug: post.slug,
    name: post.name,
    publishedAt: post.publishedAt ?? null,
    excerpt: post.excerpt ?? null,
    mainImageUrl: post.mainImageUrl ?? null,
    primaryCategorySlug: post.primaryCategorySlug ?? null,
    primaryCategoryName: post.primaryCategoryName ?? null,
    ...(post.url ? { url: post.url } : {}),
  };
}

/** How many reads one page may have in flight at once. */
export const BLOCK_DATA_CONCURRENCY = 6;

/**
 * Resolve the requests of one page.
 *
 * - **An absent owner is skipped.** A request whose owner module the source
 *   reports absent, or whose reader the source does not have, is not read.
 * - **One pass, in parallel, bounded.** Every distinct read of the page — each
 *   product once however many blocks show it, each listing, the category tree
 *   once — is started together and at most `concurrency` are in flight.
 *   Nothing waits on another block's answer.
 * - **A failed read is that block's alone.** It is left out of the result, so
 *   its block renders its empty state; this function does not reject.
 * - **Only what a block renders is handed on**, so a source that returns a
 *   richer record does not put it into the page payload.
 */
export async function resolveBlockData(
  allRequests: readonly BlockDataRequest[],
  source: BlockDataSource,
  options: { concurrency?: number } = {},
): Promise<BlockData> {
  type Unit =
    | { readonly kind: 'product'; readonly slug: string }
    | { readonly kind: 'list'; readonly key: string; readonly request: BlockDataRequest & { kind: 'products-list' } }
    | { readonly kind: 'tree' }
    | { readonly kind: 'posts'; readonly key: string; readonly request: BlockDataRequest & { kind: 'blog-posts' } }
    | { readonly kind: 'form'; readonly key: string; readonly formId: string };

  const isPresent = source.isModulePresent ?? (() => true);
  const fetchBlogPosts = source.fetchBlogPosts;
  const fetchForm = source.fetchForm;
  const requests = allRequests.filter(
    (request) =>
      isPresent(blockDataOwnerOf(request)) &&
      (request.kind !== 'blog-posts' || fetchBlogPosts !== undefined) &&
      (request.kind !== 'form' || fetchForm !== undefined),
  );

  const slugs = new Set<string>();
  const units: Unit[] = [];
  let needsTree = false;
  for (const request of requests) {
    if (request.kind === 'products-by-slugs') for (const slug of request.slugs) slugs.add(slug);
    else if (request.kind === 'products-list') units.push({ kind: 'list', key: blockDataKey(request), request });
    else if (request.kind === 'blog-posts') units.push({ kind: 'posts', key: blockDataKey(request), request });
    else if (request.kind === 'form') units.push({ kind: 'form', key: blockDataKey(request), formId: request.formId });
    else needsTree = true;
  }
  for (const slug of slugs) units.push({ kind: 'product', slug });
  if (needsTree) units.push({ kind: 'tree' });

  const productBySlug = new Map<string, CmsProductSummary>();
  const data: Record<string, BlockDataValue> = {};
  let tree: CmsCategoryNode[] | null = null;

  await settleBounded(units, options.concurrency ?? BLOCK_DATA_CONCURRENCY, async (unit) => {
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
    } else if (unit.kind === 'posts') {
      const { limit, categorySlug } = unit.request;
      const posts = await fetchBlogPosts!({ limit, ...(categorySlug !== undefined ? { categorySlug } : {}) });
      data[unit.key] = posts.slice(0, limit).map(toPostCard);
    } else if (unit.kind === 'form') {
      data[unit.key] = await fetchForm!(unit.formId);
    } else {
      tree = await source.fetchCategoryTree();
    }
  });

  const resolvedTree = tree as CmsCategoryNode[] | null;
  for (const request of requests) {
    if (request.kind === 'products-by-slugs') {
      data[blockDataKey(request)] = request.slugs
        .map((slug) => productBySlug.get(slug))
        .filter((product): product is CmsProductSummary => product !== undefined);
    } else if (request.kind === 'categories' && resolvedTree !== null) {
      data[blockDataKey(request)] = filterCategories(resolvedTree, {
        selectionMode: request.selectionMode,
        categorySlugs: [...request.categorySlugs],
        parentSlug: request.parentSlug,
        ...(request.maxDepth !== undefined ? { maxDepth: request.maxDepth } : {}),
      });
    }
  }
  return data;
}
