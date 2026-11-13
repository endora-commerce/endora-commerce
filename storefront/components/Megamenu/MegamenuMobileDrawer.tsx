'use client';

import { Fragment, useState, type ReactNode } from 'react';
import type { ResolvedMegamenu, ResolvedMenuItem } from '@endora-commerce/contracts';
import { MenuAsset } from './MenuAsset';
import { MenuButton } from './MenuButton';
import { MenuCmsBlockEmbed } from './MenuCmsBlockEmbed';
import { LocalizedLink, LocalizedAnchor } from '../../lib/i18n/localized-link';

/** The drawer's own chrome text, translated by the server (feature 168, FR-011). */
export interface DrawerLabels {
  /** The burger trigger's accessible name. */
  open: string;
  close: string;
  /** The root level's title and the breadcrumb's first step. */
  title: string;
  seeAll: string;
  /** The featured link to a drilled-into item itself; `{label}` is its name. */
  allIn: string;
  account: string;
  login: string;
  /** The hint under a drilled-into page or link's own row. */
  go: string;
}

/**
 * The featured row at the top of a drilled-into level: the way to the item
 * itself, whose own row only drills. "All in …" names what is under a
 * category; a page or an external link is named by itself.
 */
export function featuredRowText(
  item: ResolvedMenuItem,
  labels: Pick<DrawerLabels, 'allIn' | 'seeAll' | 'go'>,
): { title: string; hint: string } {
  return item.kind === 'category-link'
    ? { title: labels.allIn.replace('{label}', item.label), hint: labels.seeAll }
    : { title: item.label, hint: labels.go };
}

interface MegamenuMobileDrawerProps {
  megamenu: ResolvedMegamenu;
  labels: DrawerLabels;
  /** Logged-in buyer summary for the footer (null when signed out). */
  account?: { initials: string; name: string; subtitle: string } | null;
}

/**
 * Mobile drill-down mega-menu drawer (feature 015 / US6, restyled in feature
 * 044 to the Industria Mobile design §02 — `.mm*` in globals.css). The trigger
 * is an icon-button in the header; the panel slides in, each level animates,
 * and rows render as icon + name + chevron. A drilled-in level shows a
 * breadcrumb and a featured "All <item>" shortcut; the root shows an account
 * footer.
 *
 * Feature 168 (US6, FR-026): the root lists the navigation bar's tabs — a
 * `link` tab navigates, any other drills into its panel — and a group renders
 * as a section heading with its items under it, as its column does on desktop.
 * The root's Quick Order promo is gone with the hard-coded chrome: it is a tab
 * an operator configures.
 */
export function MegamenuMobileDrawer({ megamenu, labels, account }: MegamenuMobileDrawerProps): ReactNode {
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
    // Hidden where the desktop header rows take over (877px, the header's own
    // boundary — `specs/179-rfq-and-customer-notifications/` WP-09a), not at
    // `md`: the compact header that holds this trigger is shown up to 876px.
    <div className="min-[877px]:hidden">
      <button type="button" className="icon-btn" onClick={() => setOpen(true)} aria-label={labels.open}>
        <MenuIcon />
      </button>
      {open ? (
        <div className="m-drawer mm fixed inset-0 z-[60]" role="dialog" aria-modal="true" aria-label={labels.title}>
          <div className="mm__head">
            {currentLevel ? (
              <button type="button" className="mm__back" onClick={back}>
                <ChevLeftIcon /> {currentLevel.label}
              </button>
            ) : (
              <span className="mm__title">{labels.title}</span>
            )}
            <button type="button" className="mm__close" onClick={reset} aria-label={labels.close}>
              <XIcon />
            </button>
          </div>

          {currentLevel ? (
            <div className="mm__crumb">
              {labels.title}
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
                  <LocalizedLink href={currentLevel.url} className="mm__row feat" onClick={reset}>
                    <span className="mm__row__ic">
                      <LayersIcon />
                    </span>
                    <span className="mm__row__main">
                      <b>{featuredRowText(currentLevel, labels).title}</b>
                      <span>{featuredRowText(currentLevel, labels).hint}</span>
                    </span>
                  </LocalizedLink>
                </li>
              ) : null}
              <DrawerRows items={items} onDrill={drillInto} onNavigate={reset} />
            </ul>
          </div>

          {atRoot ? (
            <div className="mm__foot">
              {account ? (
                <>
                  <LocalizedLink href="/account" className="mm__login" onClick={reset}>
                    <span className="mm__login__av">{account.initials}</span>
                    <span className="min-w-0">
                      <b>{account.name}</b>
                      <span>{account.subtitle}</span>
                    </span>
                  </LocalizedLink>
                  <LocalizedLink href="/account" className="btn btn--ghost btn--sm" onClick={reset}>
                    <UserIcon /> {labels.account}
                  </LocalizedLink>
                </>
              ) : (
                <LocalizedLink
                  href="/login"
                  className="btn btn--outline btn--sm w-full justify-center"
                  onClick={reset}
                >
                  <UserIcon /> {labels.login}
                </LocalizedLink>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * One level of the drawer, as list items. A group is a section heading with its
 * items under it rather than a level of its own; an item with children drills
 * in, unless it is a `link` tab, which always navigates.
 */
export function DrawerRows({
  items,
  onDrill,
  onNavigate,
}: {
  items: readonly ResolvedMenuItem[];
  onDrill: (item: ResolvedMenuItem) => void;
  onNavigate: () => void;
}): ReactNode {
  return (
    <>
      {items.map((item) =>
        item.kind === 'group' && (item.presentation === undefined || item.children.length === 0) ? (
          <Fragment key={item.id}>
            <li className="mm__crumb" role="presentation">
              {item.label}
            </li>
            <DrawerRows items={item.children} onDrill={onDrill} onNavigate={onNavigate} />
          </Fragment>
        ) : (
          <li key={item.id}>{renderRow(item, onDrill, onNavigate)}</li>
        ),
      )}
    </>
  );
}

function renderRow(
  item: ResolvedMenuItem,
  drillInto: (item: ResolvedMenuItem) => void,
  onNavigate: () => void,
): ReactNode {
  const drills = item.children.length > 0 && item.presentation !== 'link';
  switch (item.kind) {
    case 'category-link':
    case 'cms-page-link':
    case 'external-link':
    case 'group':
      if (drills) {
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
        <LocalizedAnchor href={item.url} className="mm__row" onClick={onNavigate}>
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
        </LocalizedAnchor>
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
