'use client';

import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react';
import type { CatalogBlockData } from '../utils/catalog-block-data.js';
import type { CatalogPreviewApi } from '../utils/catalog-preview-bridge.js';
import { registerCatalogPreviewGetter } from '../utils/catalog-preview-bridge.js';

export type { CatalogPreviewApi } from '../utils/catalog-preview-bridge.js';
export type {
  CatalogBlockData,
  CatalogBlockDataRequest,
  CatalogBlockDataSource,
  CatalogCategoryItem,
} from '../utils/catalog-block-data.js';

const CatalogPreviewContext = createContext<CatalogPreviewApi | null>(null);
const CatalogBlockDataContext = createContext<CatalogBlockData | null>(null);

/**
 * The seam through which catalogue data reaches the catalogue blocks. Two
 * callers, two props, and a block is told which it has by which one arrived:
 *
 *  - **`data`** — the storefront. A Server Component resolved what the page's
 *    blocks declare (`utils/catalog-block-data.ts`) and passes the answers
 *    here. They are part of the server render and of the hydration render, so
 *    the HTML carries the products and the browser asks for nothing.
 *  - **`api`** — the editor. The admin page builder has no server to resolve
 *    on, so it supplies the functions and a block fetches through them from an
 *    effect, showing its skeleton meanwhile.
 *
 * With `data` present a block never fetches: a request the server could not
 * answer has no entry, and the block renders its empty state.
 */
export function CatalogPreviewProvider({
  api,
  data,
  children,
}: {
  api?: CatalogPreviewApi;
  data?: CatalogBlockData;
  children: ReactNode;
}): React.ReactElement {
  useEffect(() => {
    if (api === undefined) return undefined;
    registerCatalogPreviewGetter(() => api);
    return (): void => {
      registerCatalogPreviewGetter(null);
    };
  }, [api]);

  const withApi =
    api === undefined ? (
      children
    ) : (
      <CatalogPreviewContext.Provider value={api}>{children}</CatalogPreviewContext.Provider>
    );
  // A provider nested in another adds to what the outer one resolved rather than hiding it: a
  // tree rendered inside a page — a hook region, an embedded block — may show a block whose
  // answer the page's own provider holds.
  const outer = useContext(CatalogBlockDataContext);
  const merged = useMemo(
    () => (data === undefined ? outer : outer === null ? data : { ...outer, ...data }),
    [outer, data],
  );
  return data === undefined ? (
    <>{withApi}</>
  ) : (
    <CatalogBlockDataContext.Provider value={merged}>{withApi}</CatalogBlockDataContext.Provider>
  );
}

export function useCatalogPreviewApi(): CatalogPreviewApi | null {
  return useContext(CatalogPreviewContext);
}

/** The answers a server resolved for this tree, or `null` when nothing above resolved any. */
export function useProvidedCatalogBlockData(): CatalogBlockData | null {
  return useContext(CatalogBlockDataContext);
}
