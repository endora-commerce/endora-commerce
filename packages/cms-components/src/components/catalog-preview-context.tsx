'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import type { CatalogPreviewApi } from '../utils/catalog-preview-bridge.js';
import { registerCatalogPreviewGetter } from '../utils/catalog-preview-bridge.js';

export type { CatalogPreviewApi } from '../utils/catalog-preview-bridge.js';

const CatalogPreviewContext = createContext<CatalogPreviewApi | null>(null);

export function CatalogPreviewProvider({
  api,
  children,
}: {
  api: CatalogPreviewApi;
  children: ReactNode;
}): React.ReactElement {
  useEffect(() => {
    registerCatalogPreviewGetter(() => api);
    return (): void => {
      registerCatalogPreviewGetter(null);
    };
  }, [api]);

  return <CatalogPreviewContext.Provider value={api}>{children}</CatalogPreviewContext.Provider>;
}

export function useCatalogPreviewApi(): CatalogPreviewApi | null {
  return useContext(CatalogPreviewContext);
}
