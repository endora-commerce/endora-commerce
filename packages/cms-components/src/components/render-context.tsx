'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface CmsRenderEmbeds {
  blocks: Record<string, ReactNode>;
  templates: Record<string, ReactNode>;
}

const emptyEmbeds: CmsRenderEmbeds = { blocks: {}, templates: {} };

export const CmsRenderContext = createContext<CmsRenderEmbeds>(emptyEmbeds);

export function CmsRenderProvider({
  embeds,
  children,
}: {
  embeds: CmsRenderEmbeds;
  children: ReactNode;
}) {
  return <CmsRenderContext.Provider value={embeds}>{children}</CmsRenderContext.Provider>;
}

export function useCmsRenderEmbeds(): CmsRenderEmbeds {
  return useContext(CmsRenderContext);
}
