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
