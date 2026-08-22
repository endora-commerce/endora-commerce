'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { ResolvedMegamenu, ResolvedMenuItem } from '@endora-commerce/contracts';

interface CategoriesMegaProps {
  megamenu: ResolvedMegamenu | null;
}

/**
 * "Wszystkie kategorie" trigger + full-width dropdown panel, matching the
 * Industria storefront-ui design (`specs/b2b-platform-storefront-ui`).
 *
 * Layout (desktop): departments column (220px) │ active department's
 * subcategories in three columns (1fr) │ Quick Order promo (280px). The
 * panel opens on hover/click of the trigger and stays open while the
 * pointer is anywhere over the wrapper (the panel is a DOM descendant, so
 * moving onto it does not fire the wrapper's `mouseleave`).
 *
 * Data comes from the resolved megamenu (top-level items = departments,
 * their children = subcategories). When no menu is configured the trigger
 * degrades to a plain link to the catalog.
 */
export function CategoriesMega({ megamenu }: CategoriesMegaProps): ReactNode {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const switchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingSwitch = (): void => {
    if (switchTimer.current) {
      clearTimeout(switchTimer.current);
      switchTimer.current = null;
    }
  };
  // Hover-intent: defer switching the active department. Travelling
  // diagonally from a department toward its subcategories clips the
  // departments in between; without a delay their `mouseenter` would yank
  // the panel content out from under the pointer. A department only
  // becomes active if the pointer rests on it briefly; reaching the
  // subcategory column cancels any pending switch.
  const queueActive = (i: number): void => {
    cancelPendingSwitch();
    if (i === active) return;
    switchTimer.current = setTimeout(() => setActive(i), 140);
  };
  const setActiveNow = (i: number): void => {
    cancelPendingSwitch();
    setActive(i);
  };
  useEffect(() => cancelPendingSwitch, []);

  const items = megamenu?.items ?? [];

  if (items.length === 0) {
    return (
      <a href="/catalog" className="industria-nav__btn">
        <MenuIcon /> Wszystkie kategorie <ChevDownIcon />
      </a>
    );
  }

  const activeItem = items[Math.min(active, items.length - 1)] ?? items[0]!;
  const subItems = activeItem.children ?? [];
  const columns: ResolvedMenuItem[][] = [[], [], []];
  subItems.forEach((sub, i) => columns[i % 3]!.push(sub));

  return (
    <div
      className="industria-mega-wrap"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => {
        setOpen(false);
        cancelPendingSwitch();
      }}
    >
      <button
        type="button"
        className={'industria-nav__btn' + (open ? ' is-active' : '')}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
      >
        <MenuIcon /> Wszystkie kategorie <ChevDownIcon />
      </button>

      <div className={'industria-mega' + (open ? ' is-open' : '')}>
        <div className="mx-auto max-w-[1360px] px-[24px]">
          <div className="industria-mega__grid">
            {/* Departments */}
            <div className="industria-mega__col">
              <div className="industria-mega__heading">Działy</div>
              <ul className="industria-mega__list">
                {items.map((item, i) => (
                  <li key={item.id}>
                    <a
                      href={item.url ?? '/catalog'}
                      onMouseEnter={() => queueActive(i)}
                      onFocus={() => setActiveNow(i)}
                      aria-current={i === active ? 'true' : undefined}
                    >
                      {item.label}
                    </a>
                  </li>
                ))}
                <li>
                  <a href="/catalog">
                    <span style={{ color: 'var(--brand-700)', fontFamily: 'var(--font-sans)' }}>
                      Wszystkie kategorie →
                    </span>
                  </a>
                </li>
              </ul>
            </div>

            {/* Active department's subcategories */}
            <div className="industria-mega__col" onMouseEnter={cancelPendingSwitch}>
              <div className="industria-mega__heading">{activeItem.label}</div>
              {subItems.length > 0 ? (
                <div className="industria-mega__cols">
                  {columns.map((col, ci) => (
                    <ul className="industria-mega__list" key={ci}>
                      {col.map((sub) => (
                        <li key={sub.id}>
                          <a href={sub.url ?? '/catalog'}>{sub.label}</a>
                        </li>
                      ))}
                    </ul>
                  ))}
                </div>
              ) : (
                <ul className="industria-mega__list">
                  <li>
                    <a href={activeItem.url ?? '/catalog'}>Przeglądaj {activeItem.label} →</a>
                  </li>
                </ul>
              )}
            </div>

            {/* Promo */}
            <div className="industria-mega__col" onMouseEnter={cancelPendingSwitch}>
              <div className="industria-mega__promo">
                <LightningIcon />
                <h4>Quick Order — 200+ pozycji w 30 s</h4>
                <p>Wklej listę SKU + ilości z ERP/CSV i utwórz zamówienie jednym kliknięciem.</p>
                <a href="/quick-order" className="industria-mega__promo__cta">
                  Otwórz Quick Order <ArrowRightIcon />
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/* Inline SVG icons — consistent with the Industria icon set used in Header. */
function svg(children: ReactNode, size = 16): ReactNode {
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
      <line x1="3" y1="12" x2="21" y2="12" />
      <line x1="3" y1="6" x2="21" y2="6" />
      <line x1="3" y1="18" x2="21" y2="18" />
    </>,
    15,
  );
}
function ChevDownIcon(): ReactNode {
  return svg(<polyline points="6 9 12 15 18 9" />, 14);
}
function LightningIcon(): ReactNode {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={18}
      height={18}
      viewBox="0 0 24 24"
      fill="none"
      stroke="var(--brand-700)"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </svg>
  );
}
function ArrowRightIcon(): ReactNode {
  return svg(
    <>
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </>,
    13,
  );
}
