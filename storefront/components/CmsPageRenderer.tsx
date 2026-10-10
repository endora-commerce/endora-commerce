import { CmsRenderProvider } from '@endora-commerce/cms-components/components/render-context';
// Self-contained, prefix-isolated stylesheet for the CMS Page Builder components
// (feature 041, FR-012a). SSR-safe — bundled globally by Next at build time.
import '@endora-commerce/cms-components/styles.css';
import type { CmsResolvedPage, CmsResolvedBlock, CmsResolvedTemplate } from '@endora-commerce/contracts';
import type { RequestContext } from '../lib/api/client';
import { toAbsoluteAssetUrl } from '../lib/asset-url';
import { CatalogBlockData } from './CatalogBlockData';
import { Hook } from './Hook';
import { PageBuilderRender } from './PageBuilderRender';
import { publicApiBaseUrl } from '../lib/env.mjs';

const mediaBaseUrl = publicApiBaseUrl().replace(
  /\/+$/,
  '',
);

function embedNode(item: CmsResolvedBlock | CmsResolvedTemplate) {
  return <PageBuilderRender data={item.content.data} />;
}

/**
 * `ctx` is the request's context. It is what the page's catalogue blocks are
 * resolved with — on the server, as this viewer — so that the products and
 * categories they show are in the HTML (`CatalogBlockData`).
 */
export function CmsPageRenderer({ page, ctx }: { page: CmsResolvedPage; ctx: RequestContext }) {
  const embeds = {
    blocks: Object.fromEntries(
      Object.entries(page.embeds.blocks).map(([code, block]) => [code, embedNode(block)]),
    ),
    templates: Object.fromEntries(
      Object.entries(page.embeds.templates).map(([code, template]) => [code, embedNode(template)]),
    ),
  };

  const assets = Object.fromEntries(
    Object.entries(page.assets).map(([id, asset]) => [
      id,
      { ...asset, url: toAbsoluteAssetUrl(asset.url) },
    ]),
  );

  return (
    <CmsRenderProvider embeds={embeds} assets={assets} mediaBaseUrl={mediaBaseUrl}>
      <Hook code="cms.page.top" />
      <CatalogBlockData
        ctx={ctx}
        documents={[
          page.content.data,
          ...Object.values(page.embeds.blocks).map((block) => block.content.data),
          ...Object.values(page.embeds.templates).map((template) => template.content.data),
        ]}
      >
        <PageBuilderRender data={page.content.data} pageContainer />
      </CatalogBlockData>
      <Hook code="cms.page.bottom" />
    </CmsRenderProvider>
  );
}
