import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { RouteTabs } from '../../../packages/admin-shell/src/components/ui/route-tabs';
import { renderWithI18n } from '../helpers/render-with-i18n';

/**
 * Route-driven tabs, as opposed to the in-page `useState` tabs the admin
 * already had. Three surfaces need the same thing — feeds/templates, the two
 * order-entry modes, invoices/templates — so the "which one is current" rule
 * lives here once.
 *
 * `.b2b-tab.is-active` is the only active style the design system defines;
 * `b2b-tab--active` matches no rule at all, which is why this asserts the
 * exact class rather than merely "some active class".
 */

const TABS = [
  { to: '/product-feeds', label: 'Feeds' },
  { to: '/product-feeds/templates', label: 'Templates' },
];

function renderAt(path: string): void {
  renderWithI18n(
    <MemoryRouter initialEntries={[path]}>
      <RouteTabs tabs={TABS} />
    </MemoryRouter>,
  );
}

describe('RouteTabs', () => {
  it('renders one link per tab inside a tablist', () => {
    renderAt('/product-feeds');
    const list = screen.getByRole('tablist');
    const links = [...list.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      '/product-feeds',
      '/product-feeds/templates',
    ]);
  });

  it('marks the tab matching the current route as selected', () => {
    renderAt('/product-feeds');
    const feeds = screen.getByRole('tab', { name: 'Feeds' });
    expect(feeds.getAttribute('aria-selected')).toBe('true');
    expect(feeds.className).toContain('is-active');
    expect(screen.getByRole('tab', { name: 'Templates' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });

  it('uses the design system active class, not the one that matches no CSS rule', () => {
    renderAt('/product-feeds/templates');
    const templates = screen.getByRole('tab', { name: 'Templates' });
    expect(templates.className).toContain('b2b-tab');
    expect(templates.className).toContain('is-active');
    expect(templates.className).not.toContain('b2b-tab--active');
  });

  it('keeps a parent tab inactive while a sibling child route is open', () => {
    // `/product-feeds` is a prefix of `/product-feeds/templates`, so a default
    // prefix match would light up both tabs at once.
    renderAt('/product-feeds/templates');
    expect(screen.getByRole('tab', { name: 'Feeds' }).getAttribute('aria-selected')).toBe('false');
    expect(screen.getByRole('tab', { name: 'Templates' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('keeps a tab active on its own deeper routes', () => {
    // A template editor is still "Templates"; losing the highlight there would
    // tell the operator they had left the section.
    renderAt('/product-feeds/templates/abc-123');
    expect(screen.getByRole('tab', { name: 'Templates' }).getAttribute('aria-selected')).toBe(
      'true',
    );
  });

  it('treats a feed detail route as the Feeds tab', () => {
    renderAt('/product-feeds/some-feed-id');
    expect(screen.getByRole('tab', { name: 'Feeds' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Templates' }).getAttribute('aria-selected')).toBe(
      'false',
    );
  });
});
