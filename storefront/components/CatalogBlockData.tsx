import type { ReactNode } from 'react';
import { CatalogPreviewProvider } from '@endora-commerce/cms-components/components/catalog-preview-context';
import type { RequestContext } from '../lib/api/client';
import { resolveCatalogBlockDataFor } from '../lib/page-builder/catalog-block-data';

/**
 * Resolves the catalogue data of the Page Builder documents rendered below it
 * and hands it to their blocks — a Server Component, so the read happens while
 * the page renders and the products are in the HTML.
 *
 * `documents` is every tree `children` will render, embeds included: a block
 * reads its answer from the nearest provider, and one whose document was not
 * listed finds none and renders its empty state. `ctx` is the request's own
 * context and is required, because it is what makes the answer this viewer's:
 * see `lib/page-builder/catalog-block-data.ts`.
 */
export async function CatalogBlockData({
  documents,
  ctx,
  children,
}: {
  documents: readonly unknown[];
  ctx: RequestContext;
  children: ReactNode;
}): Promise<ReactNode> {
  const data = await resolveCatalogBlockDataFor(documents, ctx);
  return <CatalogPreviewProvider data={data}>{children}</CatalogPreviewProvider>;
}
