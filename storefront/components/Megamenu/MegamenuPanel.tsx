import type { ReactNode } from 'react';
import type { ResolvedMenuItem } from '@endora-commerce/contracts';
import { MenuAsset } from './MenuAsset';
import { MenuButton } from './MenuButton';
import { MenuCmsBlockEmbed } from './MenuCmsBlockEmbed';
import { MenuLink } from './MenuLink';

interface MegamenuPanelProps {
  topLevelItem: ResolvedMenuItem;
}

/**
 * The desktop drop-down panel shown when a top-level item is hovered.
 * Layout per the design handoff (`research.md` § R1):
 *
 *   ┌────────────────────────────────────────────────────┐
 *   │  link list (220px) │ sub-link grid (1fr) │ embed (280px) │
 *   └────────────────────────────────────────────────────┘
 *
 * The third column is filled by the first `cms-block-embed` child whose
 * `embedSide` is `right` (or `left` when both sides are populated).
 */
export function MegamenuPanel({ topLevelItem }: MegamenuPanelProps): ReactNode {
  const children = topLevelItem.children ?? [];
  const linkChildren = children.filter((child) => child.kind !== 'cms-block-embed');
  const leftEmbed = children.find((child) => child.kind === 'cms-block-embed' && child.embedSide === 'left');
  const rightEmbed = children.find((child) => child.kind === 'cms-block-embed' && child.embedSide === 'right');

  return (
    <div
      className="absolute inset-x-0 top-full z-40 hidden bg-white shadow-lg group-hover:block"
      style={{ borderTop: '1px solid #e5e7eb' }}
    >
      <div className="mx-auto max-w-[1360px] px-[24px] mx-auto grid grid-cols-12 gap-8 px-6 py-7">
        {leftEmbed ? <CmsBlockEmbedSlot item={leftEmbed} className="col-span-3" /> : null}
        <div className={leftEmbed ? 'col-span-6' : 'col-span-9'}>
          {linkChildren.length === 0 ? (
            <p className="text-sm text-muted-foreground">{topLevelItem.label}</p>
          ) : (
            <ul className="grid grid-cols-3 gap-x-6 gap-y-1">
              {linkChildren.map((child) => (
                <li key={child.id}>{renderChild(child)}</li>
              ))}
            </ul>
          )}
        </div>
        {rightEmbed ? <CmsBlockEmbedSlot item={rightEmbed} className="col-span-3" /> : null}
      </div>
    </div>
  );
}

function CmsBlockEmbedSlot({
  item,
  className,
}: {
  item: ResolvedMenuItem;
  className: string;
}): ReactNode {
  return (
    <MenuCmsBlockEmbed item={item} className={`${className} rounded-md bg-muted p-4 text-sm`} />
  );
}

function renderChild(child: ResolvedMenuItem): ReactNode {
  switch (child.kind) {
    case 'category-link':
    case 'cms-page-link':
    case 'external-link':
      return <MenuLink item={child} className="rounded px-3 py-2 text-sm hover:bg-muted" />;
    case 'button':
      return <MenuButton item={child} />;
    case 'asset':
      return <MenuAsset item={child} />;
    case 'cms-block-embed':
      // Inline embeds are slot-targeted (left/right column) at the panel
      // root; rendering one inside the link grid would duplicate it.
      return null;
  }
}
