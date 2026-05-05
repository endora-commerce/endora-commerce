import { Render } from '@measured/puck';
import { defaultPageBuilderConfig, CmsRenderProvider } from '@b2b/cms-components';
import type { CmsResolvedPage, CmsResolvedBlock, CmsResolvedTemplate } from '@b2b/contracts';

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
      <Render config={defaultPageBuilderConfig} data={page.content.data as never} />
    </CmsRenderProvider>
  );
}
