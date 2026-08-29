'use client';

import Link from 'next/link';
import { Fragment, useState, type ReactNode } from 'react';
import type { ResolvedMegamenu, ResolvedMenuItem } from '@endora-commerce/contracts';
import { MenuAsset } from './MenuAsset';
import { MenuButton } from './MenuButton';
import { MenuCmsBlockEmbed } from './MenuCmsBlockEmbed';

interface MegamenuMobileDrawerProps {
  megamenu: ResolvedMegamenu;
  /** Logged-in buyer summary for the footer (null when signed out). */
  account?: { initials: string; name: string; subtitle: string } | null;
}

/**
 * Mobile drill-down mega-menu drawer (feature 015 / US6, restyled in feature
 * 044 to the Industria Mobile design §02 — `.mm*` in globals.css). The trigger
 * is an icon-button in the header; the panel slides in, each level animates,
 * and rows render as icon + name + chevron. The root shows a Quick Order promo
 * and an account footer; a drilled-in level shows a breadcrumb and a featured
 * "All <department>" shortcut.
 */
export function MegamenuMobileDrawer({ megamenu, account }: MegamenuMobileDrawerProps): ReactNode {
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
        <div className="m-drawer mm fixed inset-0 z-[60]" role="dialog" aria-modal="true">
          <div className="mm__head">
            {currentLevel ? (
              <button type="button" className="mm__back" onClick={back}>
                <ChevLeftIcon /> {currentLevel.label}
              </button>
            ) : (
              <span className="mm__title">{megamenu.name || 'Wszystkie kategorie'}</span>
            )}
            <button type="button" className="mm__close" onClick={reset} aria-label="Zamknij">
              <XIcon />
            </button>
          </div>

          {currentLevel ? (
            <div className="mm__crumb">
              Kategorie
              {stack.map((s) => (
                <Fragment key={s.id}>
                  <ChevRightIcon size={11} /> {s.label}
                </Fragment>
              ))}
            </div>
          ) : null}

          <div className="mm__scroll">
            <ul key={stack.length} className="m-drawer__level mm__list">
              {currentLevel && currentLevel.url ? (
                <li>
                  <Link href={currentLevel.url} className="mm__row feat" onClick={reset}>
                    <span className="mm__row__ic">
                      <LayersIcon />
                    </span>
                    <span className="mm__row__main">
                      <b>Wszystkie: {currentLevel.label}</b>
                      <span>Zobacz wszystko →</span>
                    </span>
                  </Link>
                </li>
              ) : null}
              {items.map((item) => (
                <li key={item.id}>{renderRow(item, drillInto, reset)}</li>
              ))}
            </ul>

            {atRoot ? (
              <div className="mm__promo">
                <span className="mm__promo__head">
                  <LightningIcon />
                  <b>Quick Order</b>
                </span>
                <p>Wklej listę SKU + ilości z ERP/CSV i utwórz zamówienie w 30 sekund.</p>
                <Link href="/quick-order" className="mm__promo__cta" onClick={reset}>
                  Otwórz Quick Order <ArrowRightIcon />
                </Link>
              </div>
            ) : null}
          </div>

          {atRoot ? (
            <div className="mm__foot">
              {account ? (
                <>
                  <Link href="/account" className="mm__login" onClick={reset}>
                    <span className="mm__login__av">{account.initials}</span>
                    <span className="min-w-0">
                      <b>{account.name}</b>
                      <span>{account.subtitle}</span>
                    </span>
                  </Link>
                  <Link href="/account" className="btn btn--ghost btn--sm" onClick={reset}>
                    <UserIcon /> Konto
                  </Link>
                </>
              ) : (
                <Link
                  href="/login"
                  className="btn btn--outline btn--sm w-full justify-center"
                  onClick={reset}
                >
                  <UserIcon /> Zaloguj się
                </Link>
              )}
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
          <button type="button" className="mm__row" onClick={() => drillInto(item)}>
            <span className="mm__row__ic">
              <RowIcon item={item} />
            </span>
            <span className="mm__row__main">
              <b>{item.label}</b>
              {item.description ? <span>{item.description}</span> : null}
            </span>
            <span className="mm__row__chev">
              <ChevRightIcon />
            </span>
          </button>
        );
      }
      if (!item.url) return null;
      return (
        <a href={item.url} className="mm__row" onClick={onNavigate}>
          <span className="mm__row__ic">
            <RowIcon item={item} />
          </span>
          <span className="mm__row__main">
            <b>{item.label}</b>
            {item.description ? <span>{item.description}</span> : null}
          </span>
          <span className="mm__row__chev">
            <ArrowUpRightIcon />
          </span>
        </a>
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

/** Row icon: the item's resolved icon image when set, else a default glyph. */
function RowIcon({ item }: { item: ResolvedMenuItem }): ReactNode {
  if (item.icon?.url) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={item.icon.url} alt="" />;
  }
  return <TagIcon />;
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
function ChevRightIcon({ size = 18 }: { size?: number } = {}): ReactNode {
  return svg(<polyline points="9 18 15 12 9 6" />, size);
}
function XIcon(): ReactNode {
  return svg(
    <>
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </>,
    18,
  );
}
function LayersIcon(): ReactNode {
  return svg(
    <>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </>,
  );
}
function TagIcon(): ReactNode {
  return svg(
    <>
      <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <line x1="7" y1="7" x2="7.01" y2="7" />
    </>,
  );
}
function LightningIcon(): ReactNode {
  return svg(<polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />, 18);
}
function ArrowRightIcon(): ReactNode {
  return svg(
    <>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </>,
    14,
  );
}
function ArrowUpRightIcon(): ReactNode {
  return svg(
    <>
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </>,
    16,
  );
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
