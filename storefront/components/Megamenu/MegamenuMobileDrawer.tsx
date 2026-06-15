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
 * US4 to the Industria Mobile design §02). The trigger is an icon-button that
 * matches the rest of the mobile header; each level is a stacked list with
 * hover/active affordances. A drilled-in level shows a breadcrumb and an
 * "All <department>" shortcut; the root shows a Quick Order promo + account
 * footer.
 *
 * Purely client-side state — navigating to another page dismisses it.
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
      <button type="button" className="icon-btn" onClick={() => setOpen(true)} aria-label="Menu">
        <MenuIcon />
      </button>
      {open ? (
        <div
          className="m-drawer fixed inset-0 z-[60] flex flex-col bg-surface"
          role="dialog"
          aria-modal="true"
        >
          <header className="flex items-center justify-between gap-2 border-b border-line px-[12px] py-[10px]">
            {currentLevel ? (
              <button
                type="button"
                className="inline-flex h-[40px] items-center gap-1 rounded-md px-[8px] text-[14px] font-semibold text-fg hover:bg-surface-alt"
                onClick={back}
              >
                <ChevLeftIcon /> {currentLevel.label}
              </button>
            ) : (
              <span className="px-[8px] text-[15px] font-semibold text-fg">
                {megamenu.name || 'Wszystkie kategorie'}
              </span>
            )}
            <button type="button" className="icon-btn" onClick={reset} aria-label="Zamknij">
              <XIcon />
            </button>
          </header>

          {currentLevel ? (
            <div className="border-b border-line px-[16px] py-[10px] font-mono text-[11px] text-subtle">
              Kategorie
              {stack.map((s) => (
                <span key={s.id}> › {s.label}</span>
              ))}
            </div>
          ) : null}

          <ul key={stack.length} className="m-drawer__level flex-1 list-none overflow-y-auto p-0">
            {currentLevel && currentLevel.url ? (
              <li className="border-b border-line">
                <Link
                  href={currentLevel.url}
                  className="flex items-center justify-between bg-accent-soft px-[16px] py-[13px] text-[14px] font-semibold text-accent hover:brightness-95"
                  onClick={reset}
                >
                  Wszystkie: {currentLevel.label}
                  <ArrowRightIcon />
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
                className="flex items-start gap-3 bg-accent-soft px-[16px] py-[14px] hover:brightness-95"
                onClick={reset}
              >
                <span className="mt-[2px] text-accent" aria-hidden="true">
                  <LightningIcon />
                </span>
                <span className="flex flex-col gap-[2px]">
                  <strong className="text-[13px] text-accent">Quick Order</strong>
                  <span className="text-[12px] leading-[1.4] text-muted">
                    Wklej listę SKU + ilości z ERP/CSV i utwórz zamówienie w 30 sekund.
                  </span>
                </span>
              </Link>
              <Link
                href="/account"
                className="flex items-center gap-2 border-t border-line px-[16px] py-[13px] text-[14px] font-medium text-fg hover:bg-surface-alt"
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
            className="flex w-full items-center justify-between px-[16px] py-[13px] text-[14px] text-fg transition-colors duration-100 hover:bg-surface-alt active:bg-surface-alt"
            onClick={() => drillInto(item)}
          >
            <span>{item.label}</span>
            <span className="text-subtle transition-transform duration-150 group-active:translate-x-[2px]" aria-hidden="true">
              <ChevRightIcon />
            </span>
          </button>
        );
      }
      return (
        <MenuLink
          item={item}
          className="w-full px-[16px] py-[13px] text-[14px] text-fg transition-colors duration-100 hover:bg-surface-alt"
          onClick={onNavigate}
        />
      );
    case 'button':
      return (
        <div className="px-[16px] py-[12px]">
          <MenuButton item={item} />
        </div>
      );
    case 'asset':
      return (
        <div className="px-[16px] py-[12px]">
          <MenuAsset item={item} />
        </div>
      );
    case 'cms-block-embed':
      return (
        <div className="px-[16px] py-[12px]">
          <MenuCmsBlockEmbed item={item} />
        </div>
      );
  }
}

/* Inline SVG icons — consistent stroke set with the Industria header icons. */
function svg(children: ReactNode, size = 18): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}
function MenuIcon(): ReactNode {
  return svg(
    <>
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </>,
    22,
  );
}
function ChevLeftIcon(): ReactNode {
  return svg(<polyline points="15 18 9 12 15 6" />, 20);
}
function ChevRightIcon(): ReactNode {
  return svg(<polyline points="9 18 15 12 9 6" />, 18);
}
function XIcon(): ReactNode {
  return svg(
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>,
    20,
  );
}
function ArrowRightIcon(): ReactNode {
  return svg(
    <>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </>,
    16,
  );
}
function LightningIcon(): ReactNode {
  return svg(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />, 18);
}
function UserIcon(): ReactNode {
  return svg(
    <>
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </>,
    16,
  );
}
