import type { ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { cn } from '../lib/utils.js';

/**
 * A tab strip whose tabs are routes rather than component state.
 *
 * The admin already had in-page tabs (`useState` over a union), but several
 * surfaces are two sibling *pages* an operator switches between — product
 * feeds and their templates, the two order-entry modes, invoices and invoice
 * templates. Each of those used to spend a second sidebar row on the sibling;
 * a tab strip says "same place, other view" and the sidebar keeps one entry.
 *
 * Matching is prefix-based but **longest-wins**: `/product-feeds` is a prefix
 * of `/product-feeds/templates`, so a plain `startsWith` would light both tabs
 * at once. Selecting only the most specific match keeps a feed detail page on
 * *Feeds* and a template editor on *Templates*, which is what an operator
 * navigating deeper expects.
 */

export interface RouteTab {
  /** Absolute admin route this tab opens. */
  to: string;
  label: string;
}

export interface RouteTabsProps {
  tabs: RouteTab[];
  className?: string;
}

/**
 * The tab whose `to` is the longest prefix of `pathname`, or null when the
 * route belongs to none of them.
 */
export function activeTabPath(tabs: RouteTab[], pathname: string): string | null {
  const matches = tabs.filter(
    (tab) => pathname === tab.to || pathname.startsWith(`${tab.to}/`),
  );
  if (matches.length === 0) return null;
  return matches.reduce((best, tab) => (tab.to.length > best.to.length ? tab : best)).to;
}

export function RouteTabs({ tabs, className }: RouteTabsProps): ReactNode {
  const { pathname } = useLocation();
  const active = activeTabPath(tabs, pathname);

  return (
    <div className={cn('b2b-tabs-scroll', className)}>
      <div className="b2b-tabs" role="tablist">
        {tabs.map((tab) => {
          const isActive = tab.to === active;
          return (
            <NavLink
              key={tab.to}
              to={tab.to}
              role="tab"
              aria-selected={isActive}
              // `is-active` is the class the design system styles; NavLink's own
              // `isActive` is deliberately ignored because its prefix matching
              // is exactly what would light up two tabs at once.
              className={cn('b2b-tab', isActive && 'is-active')}
            >
              {tab.label}
            </NavLink>
          );
        })}
      </div>
    </div>
  );
}
