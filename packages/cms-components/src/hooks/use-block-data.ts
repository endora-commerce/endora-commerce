'use client';

import { useEffect, useState } from 'react';
import { useProvidedBlockData } from '../components/catalog-preview-context.js';
import { blockDataKey, type BlockDataRequest, type BlockDataValue } from '../utils/block-data.js';
import {
  fetchBlogPosts,
  fetchCategoryTree,
  fetchForm,
  fetchProductsBySlugs,
  fetchProductsList,
  filterCategories,
} from '../utils/catalog-fetch.js';
import { waitForCatalogSkeletonMin } from '../utils/catalog-load.js';

export interface BlockDataState<T> {
  /** `true` only while the editor-preview fetch is in flight. Never `true` when data was provided. */
  loading: boolean;
  /** The answer, or `null` when there is none: nothing requested, or the read failed. */
  data: T | null;
}

/** The editor-preview read of one request, through the preview API when one is registered. */
async function fetchBlockData(request: BlockDataRequest): Promise<BlockDataValue> {
  if (request.kind === 'products-by-slugs') return fetchProductsBySlugs([...request.slugs]);
  if (request.kind === 'form') return fetchForm(request.formId);
  if (request.kind === 'blog-posts') {
    return fetchBlogPosts({
      limit: request.limit,
      ...(request.categorySlug !== undefined ? { categorySlug: request.categorySlug } : {}),
    });
  }
  if (request.kind === 'products-list') {
    return fetchProductsList({
      ...(request.categorySlug !== undefined ? { categorySlug: request.categorySlug } : {}),
      ...(request.q !== undefined ? { q: request.q } : {}),
      limit: request.limit,
    });
  }
  return filterCategories(await fetchCategoryTree(), {
    selectionMode: request.selectionMode,
    categorySlugs: [...request.categorySlugs],
    parentSlug: request.parentSlug,
    ...(request.maxDepth !== undefined ? { maxDepth: request.maxDepth } : {}),
  });
}

/**
 * The data of one data-driven block (catalogue, blog or form).
 *
 * **Provided data wins, and is synchronous.** When a `CatalogPreviewProvider`
 * above carries `data`, the answer is read from it during render — on the
 * server and again on hydration, with the same result — so the block's HTML
 * holds its content, the effect below does nothing, and no loading state is
 * ever shown. A request with no entry is a read the server could not complete:
 * the block gets `null` and renders its empty state.
 *
 * **Otherwise this is the editor preview**, which has no server: the request is
 * fetched from an effect, and `loading` is `true` until it settles.
 * `holdSkeleton` keeps a skeleton on screen long enough to be perceived on a
 * fast API, as the blocks did before this hook existed.
 */
export function useBlockData<T extends BlockDataValue>(
  request: BlockDataRequest | null,
  options: { holdSkeleton?: boolean } = {},
): BlockDataState<T> {
  const provided = useProvidedBlockData();
  const key = request === null ? null : blockDataKey(request);
  const isProvided = provided !== null;
  const holdSkeleton = options.holdSkeleton === true;
  const [fetched, setFetched] = useState<{ key: string; data: BlockDataValue | null } | null>(null);

  useEffect(() => {
    if (isProvided || request === null || key === null) return undefined;
    let cancelled = false;
    const startedAt = Date.now();
    void (async () => {
      let data: BlockDataValue | null = null;
      try {
        // One tick later, not now: `CatalogPreviewProvider` registers the editor's preview API
        // from its own effect, and a parent's effect runs after its children's. A block mounted
        // in the same commit as the provider would otherwise read "no preview API" and go to
        // the network.
        await Promise.resolve();
        data = await fetchBlockData(request);
      } catch {
        data = null;
      }
      if (holdSkeleton) await waitForCatalogSkeletonMin(startedAt);
      if (!cancelled) setFetched({ key, data });
    })();
    return () => {
      cancelled = true;
    };
    // `key` is the request by value: a block re-rendered with an equal request does not refetch.
  }, [isProvided, key, holdSkeleton]);

  if (key === null) return { loading: false, data: null };
  if (provided !== null) {
    return { loading: false, data: Object.hasOwn(provided, key) ? (provided[key] as T) : null };
  }
  if (fetched === null || fetched.key !== key) return { loading: true, data: null };
  return { loading: false, data: fetched.data as T | null };
}
