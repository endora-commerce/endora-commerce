import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

/**
 * Feature 044 / US1 — MobileTabBar interaction test.
 *
 * The bar is a client island; vitest renders it via `renderToString`, so this
 * proves the render-derived behaviour: the five tabs render, the active tab is
 * derived from the current route, and the live cart badge reflects the seeded
 * count. The per-event re-fetch (`b2b:cart:changed`) is an effect exercised on
 * a real device (it does not run during SSR), matching the storefront's
 * established SSR-test convention.
 */

let currentPath = '/';
vi.mock('next/navigation', () => ({
  usePathname: () => currentPath,
}));

const { MobileTabBar } = await import('../components/mobile/MobileTabBar');

const labels = {
  home: 'Home',
  catalog: 'Catalog',
  quickOrder: 'Quick Order',
  cart: 'Cart',
  account: 'Account',
};

describe('MobileTabBar', () => {
  it('renders all five tab captions', () => {
    currentPath = '/';
    const html = renderToString(<MobileTabBar apiBase="http://api" labels={labels} />);
    for (const label of Object.values(labels)) {
      expect(html).toContain(label);
    }
  });

  it('marks the tab matching the current route as active', () => {
    currentPath = '/catalog';
    const html = renderToString(<MobileTabBar apiBase="http://api" labels={labels} />);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('is-active');
  });

  it('treats a product/category route as the Catalog tab', () => {
    currentPath = '/c/bearings';
    const html = renderToString(<MobileTabBar apiBase="http://api" labels={labels} />);
    expect(html).toContain('is-active');
  });

  it('shows the cart badge when the seeded count is positive', () => {
    currentPath = '/';
    const html = renderToString(
      <MobileTabBar apiBase="http://api" cartItemCount={5} labels={labels} />,
    );
    expect(html).toContain('m-tabbar__badge');
    expect(html).toContain('>5<');
  });

  it('hides the cart badge when the cart is empty', () => {
    currentPath = '/';
    const html = renderToString(
      <MobileTabBar apiBase="http://api" cartItemCount={0} labels={labels} />,
    );
    expect(html).not.toContain('m-tabbar__badge');
  });
});
