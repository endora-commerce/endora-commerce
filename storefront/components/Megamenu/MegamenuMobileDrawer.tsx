'use client';

import Link from 'next/link';
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
 * Mobile-first drill-down drawer (feature 015 / US6, refined in feature 044 /
 * US4 to the Industria Mobile design §02). Each level is a stacked list;
 * tapping a parent slides to the next level via component state. A drilled-in
 * level shows a breadcrumb and an "All <department>" shortcut to the parent
 * category; the root level shows a Quick Order promo and an account footer.
 *
 * Purely client-side state — navigating to another page dismisses it; the
 * browser's native scroll restoration covers returning to a parent level.
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
  const atRoot = stack.length === 0;

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
        <div className="fixed inset-0 z-[60] flex flex-col bg-surface" role="dialog" aria-modal="true">
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            {currentLevel ? (
              <button
                type="button"
                className="inline-flex items-center gap-2 text-sm font-medium text-fg"
                onClick={back}
              >
                ← {currentLevel.label}
              </button>
            ) : (
              <span className="text-sm font-semibold text-fg">
                {megamenu.name || 'Wszystkie kategorie'}
              </span>
            )}
            <button
              type="button"
              className="icon-btn"
              onClick={reset}
              aria-label="Close menu"
            >
              ✕
            </button>
          </header>

          {currentLevel ? (
            <div className="border-b border-line px-4 py-[10px] font-mono text-[11px] text-subtle">
              Kategorie
              {stack.map((s) => (
                <span key={s.id}> › {s.label}</span>
              ))}
            </div>
          ) : null}

          <ul className="flex-1 list-none overflow-y-auto p-0">
            {currentLevel && currentLevel.url ? (
              <li className="border-b border-line bg-surface-alt">
                <Link
                  href={currentLevel.url}
                  className="flex items-center justify-between px-4 py-3 text-sm font-semibold text-accent"
                  onClick={reset}
                >
                  Wszystkie: {currentLevel.label}
                  <span aria-hidden="true">→</span>
                </Link>
              </li>
            ) : null}
            {items.map((item) => (
              <li key={item.id} className="border-b border-line">
                {renderRow(item, drillInto, reset)}
              </li>
            ))}
          </ul>

          {atRoot ? (
            <div className="border-t border-line">
              <Link
                href="/quick-order"
                className="flex flex-col gap-1 bg-accent-soft px-4 py-3"
                onClick={reset}
              >
                <strong className="text-[13px] text-accent">⚡ Quick Order</strong>
                <span className="text-[12px] text-muted">
                  Wklej listę SKU + ilości z ERP/CSV i utwórz zamówienie w 30 sekund.
                </span>
              </Link>
              <Link
                href="/account"
                className="flex items-center gap-2 border-t border-line px-4 py-3 text-sm font-medium text-fg"
                onClick={reset}
              >
                <UserIcon /> Konto
              </Link>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function renderRow(
  item: ResolvedMenuItem,
  drillInto: (item: ResolvedMenuItem) => void,
  onNavigate: () => void,
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
            className="flex w-full items-center justify-between px-4 py-3 text-sm text-fg"
            onClick={() => drillInto(item)}
          >
            <span>{item.label}</span>
            <span className="text-subtle">›</span>
          </button>
        );
      }
      return (
        <MenuLink
          item={item}
          className="flex w-full px-4 py-3 text-sm text-fg"
          onClick={onNavigate}
        />
      );
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

function UserIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={16}
      height={16}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}
