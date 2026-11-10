'use client';

import { useContext, type ReactNode } from 'react';
import {
  CmsRenderContext,
  type CmsRenderAsset,
} from '@endora-commerce/cms-components/components/render-context';

/**
 * The asset map of a hook or of a block by code, for the Page Builder blocks
 * below it. Without it a `cms.Image` rendered outside a page — the root
 * layout's header and footer hooks — finds no map and builds a bare
 * `/assets/file/<id>`, which is `public, no-cache` and so revalidated on every
 * visit, where the same image in a page is served `immutable` at `?v=`.
 *
 * Inside a page's render context it adds to the page's map and keeps everything
 * else the page set; the page's `mediaBaseUrl` wins over this one.
 */
export function CmsAssetScope({
  assets,
  mediaBaseUrl,
  children,
}: {
  assets: Record<string, CmsRenderAsset>;
  mediaBaseUrl: string;
  children: ReactNode;
}): ReactNode {
  const outer = useContext(CmsRenderContext);
  return (
    <CmsRenderContext.Provider
      value={{
        ...outer,
        assets: { ...outer.assets, ...assets },
        mediaBaseUrl: outer.mediaBaseUrl ?? mediaBaseUrl,
      }}
    >
      {children}
    </CmsRenderContext.Provider>
  );
}
