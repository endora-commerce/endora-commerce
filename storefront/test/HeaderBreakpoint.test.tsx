import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * Regression guard for the storefront header responsive flip.
 *
 * The desktop topbar + header only fit from ~877px upward; between 768 and
 * 876px the desktop rows overflowed the viewport. The compact (mobile) header
 * is therefore shown up to 876px and the desktop rows take over at 877px — the
 * flip boundary is 876/877, NOT Tailwind's `md` (768px) default.
 *
 * The three desktop rows are hidden by default (`hidden`) and revealed only at
 * `min-[877px]` (`:block` for the topbar/nav, `:grid` for the header inner,
 * whose base component class is `display: grid`). A bare `max-[876px]:hidden`
 * is NOT used: `.industria-header__inner` carries `display: grid` from its
 * component class, so relying on the component-vs-utility layer order to hide
 * it duplicated the header around the boundary. Starting from `hidden` and
 * opting back in at `min-[877px]` makes the flip robust regardless of layer
 * ordering. This test pins those exact variant classes so a refactor can't
 * silently revert the boundary back to `md` or re-introduce the overflow.
 *
 * It asserts on the component source (rather than a full SSR render) because
 * the header pulls in the dictionary-provider stack; the responsive boundary
 * lives entirely in these static class names.
 */

const headerSource = readFileSync(
  fileURLToPath(new URL('../components/Header.tsx', import.meta.url)),
  'utf8',
);

describe('Header responsive flip boundary', () => {
  it('hides the desktop topbar/header/nav rows at or below 876px', () => {
    // Three desktop rows (topbar, header inner, nav) each start hidden and are
    // revealed only from 877px up — `hidden min-[877px]:block` (topbar/nav) and
    // `hidden min-[877px]:grid` (header inner, whose base display is grid).
    const matches = headerSource.match(/hidden min-\[877px\]:(?:block|grid)/g) ?? [];
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  it('shows the compact header only up to 876px (hidden at 877px and up)', () => {
    expect(headerSource).toContain('min-[877px]:hidden');
  });

  it('no longer flips at the md (768px) default', () => {
    expect(headerSource).not.toContain('max-md:hidden');
    // The compact block must not use the bare `md:hidden` flip either.
    expect(headerSource).not.toMatch(/className="md:hidden"/);
  });
});

/**
 * `specs/179-rfq-and-customer-notifications/` WP-09a (T078, research R-24 (c)) —
 * the mobile tab bar and the megamenu drawer switch at the header's 877 px, not
 * at `md` (768 px). Before this, 768–876 px rendered the compact header but
 * neither the tab bar nor the drawer, so it had no account entry at all.
 *
 * Each boundary is read out of the source it lives in — the header's variant
 * classes, the `.m-tabbar` component rule and the `--m-tabbar-h` media block of
 * `globals.css`, the drawer's wrapper class — and evaluated at the four widths
 * either side of both candidate boundaries.
 */

const globalsCss = readFileSync(fileURLToPath(new URL('../app/globals.css', import.meta.url)), 'utf8');
const drawerSource = readFileSync(
  fileURLToPath(new URL('../components/Megamenu/MegamenuMobileDrawer.tsx', import.meta.url)),
  'utf8',
);

const WIDTHS = [767, 768, 876, 877] as const;

/** The width from which a Tailwind class list hides its element; `Infinity` = never hidden. */
function hiddenFrom(classList: string): number {
  if (/(?:^|\s)md:hidden(?:\s|$)/.test(classList)) return 768;
  const arbitrary = /(?:^|\s)min-\[(\d+)px\]:hidden(?:\s|$)/.exec(classList);
  return arbitrary ? Number(arbitrary[1]) : Number.POSITIVE_INFINITY;
}

/** The class list `@apply`-ed by a component rule in `globals.css`. */
function appliedClasses(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const rule = new RegExp(`${escaped}\\s*\\{\\s*@apply([^;]+);`).exec(globalsCss);
  if (!rule) throw new Error(`no @apply rule for ${selector}`);
  return rule[1]!.replace(/\s+/g, ' ');
}

/** The media block that sets the tab bar's reserved height: its `max-width` and its body. */
function tabbarHeightBlock(): { maxWidth: number; body: string } {
  for (const block of globalsCss.matchAll(/@media\s*\(max-width:\s*(\d+)px\)\s*\{([\s\S]*?)\n\}/g)) {
    if (/--m-tabbar-h:\s*56px/.test(block[2]!)) return { maxWidth: Number(block[1]), body: block[2]! };
  }
  throw new Error('no media block sets --m-tabbar-h: 56px');
}

const drawerWrapper = /<div className="([^"]*)">\s*<button[^>]*onClick=\{\(\) => setOpen\(true\)\}/.exec(drawerSource);
const compactHeader = /<div className="(min-\[877px\]:hidden)">/.exec(headerSource);
const desktopRowsFrom = Number(/industria-header__inner hidden min-\[(\d+)px\]:grid/.exec(headerSource)?.[1]);

describe('mobile tab bar and drawer flip at the header boundary (877 px)', () => {
  const tabbarHiddenFrom = hiddenFrom(appliedClasses('.m-tabbar'));
  const drawerHiddenFrom = hiddenFrom(drawerWrapper?.[1] ?? '');
  const compactHiddenFrom = hiddenFrom(compactHeader?.[1] ?? '');

  it('reads every boundary from its source', () => {
    expect(drawerWrapper, 'the drawer trigger wrapper').not.toBeNull();
    expect(compactHeader, 'the compact header').not.toBeNull();
    expect(compactHiddenFrom).toBe(877);
    expect(desktopRowsFrom).toBe(877);
  });

  it.each(WIDTHS)('at %i px the tab bar, the drawer and the compact header agree', (width) => {
    const compactShown = width < compactHiddenFrom;
    expect(width < tabbarHiddenFrom, 'tab bar').toBe(compactShown);
    expect(width < drawerHiddenFrom, 'drawer trigger').toBe(compactShown);
  });

  it.each(WIDTHS)('at %i px an account entry exists (tab bar or desktop header rows)', (width) => {
    const desktopRowsShown = width >= desktopRowsFrom;
    expect(width < tabbarHiddenFrom || desktopRowsShown).toBe(true);
  });

  it.each(WIDTHS)('at %i px --m-tabbar-h reserves the bar exactly while it is shown', (width) => {
    expect(width <= tabbarHeightBlock().maxWidth).toBe(width < tabbarHiddenFrom);
  });

  it('pads the body by --m-tabbar-h in the same media block', () => {
    expect(tabbarHeightBlock().body).toContain('padding-bottom: calc(var(--m-tabbar-h) + var(--m-safe-bottom))');
  });
  // The compact header (shown up to 876 px) holds the search field that opens
  // MobileSearchOverlay; its panel must exist wherever the field does, or a tap
  // at 768–876 px opens nothing visible.
  const searchOverlayHiddenFrom = hiddenFrom(appliedClasses('.m-search-overlay'));

  it.each(WIDTHS)('at %i px the search overlay panel is shown wherever its compact-header trigger is', (width) => {
    expect(width < searchOverlayHiddenFrom).toBe(width < compactHiddenFrom);
  });
});
