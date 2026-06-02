import { Render } from '@measured/puck';
import { defaultPageBuilderConfig, CmsRenderProvider } from '@b2b/cms-components';
// Self-contained, prefix-isolated stylesheet for the CMS Page Builder components
// (feature 041, FR-012a). SSR-safe — bundled globally by Next at build time.
import '@b2b/cms-components/styles.css';
import type { CmsResolvedPage, CmsResolvedBlock, CmsResolvedTemplate } from '@b2b/contracts';
import { Hook } from './Hook';

function embedNode(item: CmsResolvedBlock | CmsResolvedTemplate) {
  return <Render config={defaultPageBuilderConfig} data={item.content.data as never} />;
}

export function CmsPageRenderer({ page }: { page: CmsResolvedPage }) {
  const embeds = {
    blocks: Object.fromEntries(
      Object.entries(page.embeds.blocks).map(([code, block]) => [code, embedNode(block)]),
    ),
    templates: Object.fromEntries(
      Object.entries(page.embeds.templates).map(([code, template]) => [code, embedNode(template)]),
    ),
  };

  return (
    <CmsRenderProvider embeds={embeds}>
      <Hook code="cms.page.top" />
      <Render config={defaultPageBuilderConfig} data={page.content.data as never} />
      <Hook code="cms.page.bottom" />
    </CmsRenderProvider>
  );
}
