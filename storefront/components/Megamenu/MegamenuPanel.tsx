import type { ReactNode } from 'react';
import type { ResolvedMenuItem } from '@b2b/contracts';
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
      <div className="container mx-auto grid grid-cols-12 gap-8 px-6 py-7">
        {leftEmbed ? <CmsBlockEmbedSlot item={leftEmbed} className="col-span-3" /> : null}
        <div className={leftEmbed ? 'col-span-6' : 'col-span-9'}>
          {linkChildren.length === 0 ? (
            <p className="text-sm text-muted-foreground">{topLevelItem.label}</p>
          ) : (
            <ul className="grid grid-cols-3 gap-x-6 gap-y-1">
              {linkChildren.map((child) => (
                <li key={child.id}>
                  <MenuLink item={child} className="rounded px-3 py-2 text-sm hover:bg-muted" />
                </li>
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
  // The block content tree is the existing CMS Page Builder tree shape.
  // Storefront render delegates to `<CmsPageRenderer>` (or any future
  // shared CMS renderer) — for v1 we surface a placeholder so the slot
  // is visible. A follow-up task wires the real CMS renderer in.
  if (!item.block) return null;
  return (
    <aside className={`${className} rounded-md bg-muted p-4 text-sm`} aria-label={item.label}>
      <h4 className="font-semibold">{item.label}</h4>
      <p className="text-muted-foreground">CMS Block: <code>{item.block.code}</code></p>
    </aside>
  );
}
