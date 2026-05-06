'use client';

import { useState, type ReactNode } from 'react';
import type { ResolvedMegamenu, ResolvedMenuItem } from '@b2b/contracts';
import { MenuAsset } from './MenuAsset';
import { MenuButton } from './MenuButton';
import { MenuCmsBlockEmbed } from './MenuCmsBlockEmbed';
import { MenuLink } from './MenuLink';

interface MegamenuMobileDrawerProps {
  megamenu: ResolvedMegamenu;
}

/**
 * Mobile-first drill-down drawer (feature 015 / US6). Each level is a
 * stacked list; tapping a parent slides to the next level via component
 * state. Embedded CMS Blocks, Buttons, and Assets render stacked inline
 * (no off-canvas side-by-side), per FR-023 / US6 #3.
 *
 * The drawer is purely client-side state — no `next/router` integration
 * — so navigating to another page dismisses it. The browser's native
 * scroll restoration covers SC-006 ("preserves scroll on parent levels"
 * after tapping Back).
 */
export function MegamenuMobileDrawer({ megamenu }: MegamenuMobileDrawerProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [stack, setStack] = useState<ResolvedMenuItem[]>([]);

  const reset = (): void => {
    setOpen(false);
    setStack([]);
  };

  const drillInto = (item: ResolvedMenuItem): void => {
    if (item.children.length === 0) return;
    setStack((prev) => [...prev, item]);
  };

  const back = (): void => setStack((prev) => prev.slice(0, -1));

  const currentLevel = stack[stack.length - 1];
  const items = currentLevel ? currentLevel.children : megamenu.items;

  return (
    <div className="md:hidden">
      <button
        type="button"
        className="inline-flex h-10 items-center gap-2 px-4 text-sm font-medium"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
      >
        ☰ Menu
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <header className="flex items-center justify-between border-b px-4 py-3">
            {currentLevel ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 text-sm font-medium"
                onClick={back}
              >
                ← {currentLevel.label}
              </button>
            ) : (
              <span className="text-sm font-semibold">{megamenu.name}</span>
            )}
            <button
              type="button"
              className="text-sm text-muted-foreground"
              onClick={reset}
              aria-label="Close menu"
            >
              ✕
            </button>
          </header>
          <ul className="flex-1 overflow-y-auto">
            {items.map((item) => (
              <li key={item.id} className="border-b">
                {renderRow(item, drillInto)}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

function renderRow(
  item: ResolvedMenuItem,
  drillInto: (item: ResolvedMenuItem) => void,
): ReactNode {
  const hasChildren = item.children.length > 0;
  switch (item.kind) {
    case 'category-link':
    case 'cms-page-link':
    case 'external-link':
      if (hasChildren) {
        return (
          <button
            type="button"
            className="flex w-full items-center justify-between px-4 py-3 text-sm"
            onClick={() => drillInto(item)}
          >
            <span>{item.label}</span>
            <span className="text-muted-foreground">›</span>
          </button>
        );
      }
      return <MenuLink item={item} className="flex w-full px-4 py-3 text-sm" />;
    case 'button':
      return (
        <div className="px-4 py-3">
          <MenuButton item={item} />
        </div>
      );
    case 'asset':
      return (
        <div className="px-4 py-3">
          <MenuAsset item={item} />
        </div>
      );
    case 'cms-block-embed':
      return (
        <div className="px-4 py-3">
          <MenuCmsBlockEmbed item={item} />
        </div>
      );
  }
}
