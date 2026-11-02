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
import { formsRenderContext } from '../lib/page-builder/forms-context';
import { collectBlockDataRequests } from '@endora-commerce/cms-components/utils/block-data';
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
 *
 * Feature 170 — a page holding a `forms.Form` block also gets the forms
 * context (`lib/page-builder/forms-context.ts`): the block's words, the
 * countries, the viewer, the page context of hidden fields and a refused
 * no-JS attempt addressed to it. Read only for such a page, and only while
 * `forms` is present, so every other page costs nothing more.
 */
export async function CmsPageRenderer({
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

  const documents = [
    page.content.data,
    ...Object.values(page.embeds.blocks).map((block) => block.content.data),
    ...Object.values(page.embeds.templates).map((template) => template.content.data),
  ];
  const hasForm = collectBlockDataRequests(documents).some((request) => request.kind === 'form');
  const forms =
    hasForm && (modules?.isPresent('forms') ?? true)
      ? await formsRenderContext({
          language: page.language,
          location: location ?? { path: `/${page.path ?? page.slug}`, query: {} },
          pageTitle: page.name,
          ctx,
        })
      : undefined;

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
      {...(forms ? { forms } : {})}
    >
      <Hook code="cms.page.top" />
      <BlockData
        ctx={ctx}
        {...(modules ? { modules } : {})}
        documents={documents}
      >
        <PageBuilderRender data={page.content.data} pageContainer />
      </BlockData>
      <Hook code="cms.page.bottom" />
    </LocalizedCmsRenderProvider>
  );
}
