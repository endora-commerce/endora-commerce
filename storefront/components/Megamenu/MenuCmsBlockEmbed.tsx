import type { ReactNode } from 'react';
import type { ResolvedMenuItem } from '@endora-commerce/contracts';
import { PageBuilderRender } from '../PageBuilderRender';

interface MenuCmsBlockEmbedProps {
  item: ResolvedMenuItem;
  className?: string;
}

/**
 * Renders the inlined CMS Block content carried by a menu item of kind
 * `cms-block-embed`. Reuses the storefront's one Page Builder render
 * boundary (`PageBuilderRender`) so a Block authored once renders identically
 * on a CMS Page, in a Hook, and inside a megamenu panel — with the installed
 * modules' blocks and the same presence rule.
 */
export function MenuCmsBlockEmbed({ item, className }: MenuCmsBlockEmbedProps): ReactNode {
  if (!item.block) return null;
  return (
    <aside className={className} aria-label={item.label}>
      <PageBuilderRender data={item.block.content.data} />
    </aside>
  );
}
