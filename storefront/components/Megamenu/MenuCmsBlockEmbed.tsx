import type { ReactNode } from 'react';
import { Render } from '@measured/puck';
import { defaultPageBuilderConfig } from '@endora-commerce/cms-components';
import type { ResolvedMenuItem } from '@endora-commerce/contracts';

interface MenuCmsBlockEmbedProps {
  item: ResolvedMenuItem;
  className?: string;
}

/**
 * Renders the inlined CMS Block content carried by a menu item of kind
 * `cms-block-embed`. Reuses the platform-wide Page Builder render
 * pipeline (`@measured/puck` + `defaultPageBuilderConfig`) so a Block
 * authored once renders identically on a CMS Page, in a Hook, and inside
 * a megamenu panel.
 */
export function MenuCmsBlockEmbed({ item, className }: MenuCmsBlockEmbedProps): ReactNode {
  if (!item.block) return null;
  return (
    <aside className={className} aria-label={item.label}>
      <Render config={defaultPageBuilderConfig} data={item.block.content.data as never} />
    </aside>
  );
}
