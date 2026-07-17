'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface CmsRenderEmbeds {
  blocks: Record<string, ReactNode>;
  templates: Record<string, ReactNode>;
}

export interface CmsRenderAsset {
  url: string;
  mimeType?: string;
  filename?: string;
  label?: string | null;
  visibility?: 'public' | 'private';
}

export interface CmsRenderContextValue {
  embeds: CmsRenderEmbeds;
  assets: Record<string, CmsRenderAsset>;
  /** API origin for rebasing host-relative `/assets/file/...` URLs. */
  mediaBaseUrl?: string;
}

const emptyValue: CmsRenderContextValue = {
  embeds: { blocks: {}, templates: {} },
  assets: {},
};

export const CmsRenderContext = createContext<CmsRenderContextValue>(emptyValue);

export function CmsRenderProvider({
  embeds,
  assets = {},
  mediaBaseUrl,
  children,
}: {
  embeds: CmsRenderEmbeds;
  assets?: Record<string, CmsRenderAsset>;
  mediaBaseUrl?: string;
  children: ReactNode;
}) {
  return (
    <CmsRenderContext.Provider value={{ embeds, assets, ...(mediaBaseUrl !== undefined ? { mediaBaseUrl } : {}) }}>
      {children}
    </CmsRenderContext.Provider>
  );
}

export function useCmsRenderEmbeds(): CmsRenderEmbeds {
  return useContext(CmsRenderContext).embeds;
}

export function useCmsRenderAssets(): Record<string, CmsRenderAsset> {
  return useContext(CmsRenderContext).assets;
}

export function useCmsRenderMediaBaseUrl(): string | undefined {
  return useContext(CmsRenderContext).mediaBaseUrl;
}
