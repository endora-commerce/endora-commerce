import type { ReactNode } from 'react';
import type { ResolvedMegamenu, ResolvedMenuItem } from '@b2b/contracts';
import { MegamenuPanel } from './MegamenuPanel';

interface MegamenuProps {
  megamenu: ResolvedMegamenu | null;
}

/**
 * Top-level navigation bar for the storefront (desktop). Renders one
 * "trigger" per top-level menu item; hovering opens the panel beneath.
 * Mobile rendering lands in Phase 8 (US6) via `<MegamenuMobileDrawer>`.
 *
 * When `megamenu` is `null` (no active configuration in the resolved
 * scope), this component renders an empty `<nav>` so layouts can fall
 * back to a stripped-down header without breaking the document tree.
 */
export function Megamenu({ megamenu }: MegamenuProps): ReactNode {
  if (!megamenu) {
    return <nav aria-label="Primary navigation" data-state="empty" />;
  }
  return (
    <nav aria-label="Primary navigation" className="border-b border-border bg-white">
      <div className="container mx-auto flex">
        <ul className="flex items-stretch">
          {megamenu.items.map((item) => (
            <li key={item.id} className="group relative">
              <TopLevelTrigger item={item} />
              {item.children.length > 0 ? <MegamenuPanel topLevelItem={item} /> : null}
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}

function TopLevelTrigger({ item }: { item: ResolvedMenuItem }): ReactNode {
  const className =
    'inline-flex h-12 items-center gap-2 px-4 text-sm font-medium text-foreground hover:text-primary';
  if (item.url) {
    return (
      <a href={item.url} className={className}>
        {item.label}
      </a>
    );
  }
  return <span className={className}>{item.label}</span>;
}
