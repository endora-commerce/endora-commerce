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

/**
 * One tab of a strip whose tabs are contributed rather than listed.
 *
 * `RouteTabs` above takes the whole set and is the right primitive whenever one
 * component knows every tab. A **zone** strip (`<RouteTabsZone>`, feature 091
 * P4d) never does: each tab arrives as a separate module's contribution, loaded
 * behind its own dynamic import, so no component sees the set and the tab has
 * to decide its own selected state.
 *
 * **What that costs, stated rather than discovered.** `activeTabPath` resolves
 * a prefix collision by *longest wins*, which is why `/product-feeds` and
 * `/product-feeds/templates` do not light up together. A contributed tab cannot
 * do that — it has nothing to be longer *than* — so the rule here is the
 * per-tab half alone: this route, or a route below it. Two contributed tabs
 * whose paths are prefixes of one another would therefore both read as
 * selected. Measured for the one strip that exists: `/orders/new` and
 * `/orders/quick-order` are prefixes of neither, so the rendered result is
 * identical to `RouteTabs`'. A strip whose contributors *do* nest is the case
 * to bring back to this comment.
 */
export interface RouteTabLinkProps {
  /** Absolute admin route this tab opens. */
  to: string;
  label: string;
}

export function RouteTabLink({ to, label }: RouteTabLinkProps): ReactNode {
  const { pathname } = useLocation();
  const isActive = pathname === to || pathname.startsWith(`${to}/`);
  return (
    <NavLink
      to={to}
      role="tab"
      aria-selected={isActive}
      // `is-active` is the class the design system styles; NavLink's own
      // `isActive` is deliberately ignored, for `RouteTabs`' reason.
      className={cn('b2b-tab', isActive && 'is-active')}
    >
      {label}
    </NavLink>
  );
}
