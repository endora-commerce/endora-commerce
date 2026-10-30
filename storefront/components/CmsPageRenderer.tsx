import type { CmsRenderLocation } from '@endora-commerce/cms-components/components/render-context';
import { LocalizedCmsRenderProvider } from './LocalizedCmsRenderProvider';
// Self-contained, prefix-isolated stylesheet for the CMS Page Builder components
// (feature 041, FR-012a). SSR-safe — bundled globally by Next at build time.
import '@endora-commerce/cms-components/styles.css';
import type { CmsResolvedPage, CmsResolvedBlock, CmsResolvedTemplate } from '@endora-commerce/contracts';
import type { RequestContext } from '../lib/api/client';
import type { ModulePresenceSet } from '../lib/api/module-presence';
import { toAbsoluteAssetUrl } from '../lib/asset-url';
import { BlockData } from './BlockData';
import { Hook } from './Hook';
import { PageBuilderRender } from './PageBuilderRender';
import { cmsCarouselLabels } from '../lib/page-builder/carousel-labels';
import { pageNavigationText } from '../lib/page-builder/page-navigation-text';
import { newsletterSignupText } from '../lib/page-builder/newsletter-signup-text';
import { cmsContactFormText } from '../lib/page-builder/contact-form-text';
import { publicApiBaseUrl } from '../lib/env.mjs';

const mediaBaseUrl = publicApiBaseUrl().replace(
  /\/+$/,
  '',
);

function embedNode(item: CmsResolvedBlock | CmsResolvedTemplate) {
  return <PageBuilderRender data={item.content.data} />;
}

/**
 * `ctx` is the request's context. It is what the page's data-driven blocks are
 * resolved with — on the server, as this viewer — so that the products,
 * categories and posts they show are in the HTML (`BlockData`). `modules`, the
 * request's module presence, skips the reads of a module that is off.
 * `location`, the page's path and query, is what a block posting a plain form
 * back to the page reads (feature 163, `newsletter.Signup`): where to come
 * back to, and the outcome the handler put on the URL.
 */
export function CmsPageRenderer({
  page,
  ctx,
  modules,
  location,
}: {
  page: CmsResolvedPage;
  ctx: RequestContext;
  modules?: ModulePresenceSet;
  location?: CmsRenderLocation;
}) {
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
    <LocalizedCmsRenderProvider
      embeds={embeds}
      assets={assets}
      mediaBaseUrl={mediaBaseUrl}
      {...(location ? { location } : {})}
      newsletterSignupText={newsletterSignupText(page.language)}
      carouselLabels={cmsCarouselLabels(page.language)}
      pageNavigationText={pageNavigationText(page.language)}
      contactFormText={cmsContactFormText(page.language)}
    >
      <Hook code="cms.page.top" />
      <BlockData
        ctx={ctx}
        {...(modules ? { modules } : {})}
        documents={[
          page.content.data,
          ...Object.values(page.embeds.blocks).map((block) => block.content.data),
          ...Object.values(page.embeds.templates).map((template) => template.content.data),
        ]}
      >
        <PageBuilderRender data={page.content.data} pageContainer />
      </BlockData>
      <Hook code="cms.page.bottom" />
    </LocalizedCmsRenderProvider>
  );
}
