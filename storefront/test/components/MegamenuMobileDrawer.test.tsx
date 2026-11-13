import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ResolvedMegamenu } from '@endora-commerce/contracts';
import { DrawerRows, MegamenuMobileDrawer, featuredRowText } from '../../components/Megamenu/MegamenuMobileDrawer';

/**
 * T074 — Mobile drawer renders the burger trigger and (closed) is
 * hidden from 877 px (`min-[877px]:hidden`, the header's own boundary since
 * feature 179 WP-09a) so it doesn't bleed into the desktop layout. The drill-
 * down + back-stack interaction is end-state behaviour exercised on a
 * real device; this SSR test proves the structural skeleton renders.
 */

const fixture: ResolvedMegamenu = {
  megamenuId: '11111111-1111-4111-8111-111111111111',
  name: 'Test',
  language: 'en-US',
  items: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      parentId: null,
      kind: 'category-link',
      label: 'Catalog',
      url: '/catalog',
      presentation: 'catalog',
      alignment: 'start',
      children: [
        {
          id: '33333333-3333-4333-8333-333333333333',
          parentId: '22222222-2222-4222-8222-222222222222',
          kind: 'category-link',
          label: 'Garden',
          url: '/catalog/garden',
          children: [],
        },
      ],
    },
    {
      id: '44444444-4444-4444-8444-444444444444',
      parentId: null,
      kind: 'external-link',
      label: 'Phone',
      url: 'tel:+48123',
      presentation: 'link',
      alignment: 'start',
      children: [],
    },
  ],
};

const labels = {
  open: 'Open menu',
  close: 'Close menu',
  title: 'Menu',
  seeAll: 'See all',
  allIn: 'All in {label}',
  account: 'Account',
  login: 'Sign in',
  go: 'Go',
};

describe('MegamenuMobileDrawer — SSR initial render', () => {
  it('renders the burger trigger (icon-button) and is marked min-[877px]:hidden on the wrapper', () => {
    const html = renderToString(<MegamenuMobileDrawer megamenu={fixture} labels={labels} />);
    expect(html).toContain('aria-label="Open menu"');
    expect(html).toContain('icon-btn');
    expect(html).toContain('class="min-[877px]:hidden"');
    expect(html).not.toContain('md:hidden');
  });

  it('does not render the drawer body in the closed initial state', () => {
    const html = renderToString(<MegamenuMobileDrawer megamenu={fixture} labels={labels} />);
    // Top-level item labels appear inside the drawer body; closed initial
    // state hides the body so neither label appears in the SSR output.
    expect(html).not.toContain('Catalog');
    expect(html).not.toContain('Phone');
  });

  it('gates the feature-044 chrome (Quick Order promo, breadcrumb) behind the open state', () => {
    const html = renderToString(<MegamenuMobileDrawer megamenu={fixture} labels={labels} />);
    // The root promo + the drill-down breadcrumb only exist once the drawer is
    // opened (client interaction, exercised on device); closed → neither shows.
    expect(html).not.toContain('Quick Order');
    expect(html).not.toContain('Kategorie ›');
  });
});

/**
 * `specs/168-megamenu-navigation-bar/` US6 — the drawer lists the tabs at its
 * root and drills into a tab's panel, with groups as section headings.
 */
describe('DrawerRows (feature 168)', () => {
  const noop = (): void => {};

  it('navigates on a link tab and drills into a tab with a panel', () => {
    const html = renderToString(<DrawerRows items={fixture.items} onDrill={noop} onNavigate={noop} />);
    expect(html).toMatch(/<a[^>]*href="tel:\+48123"/);
    expect(html).toMatch(/<button[^>]*>.*Catalog/);
  });

  it('renders a link tab as a link even when the drawer could drill into it', () => {
    const tab = { ...fixture.items[0]!, presentation: 'link' as const, children: [] };
    const html = renderToString(<DrawerRows items={[tab]} onDrill={noop} onNavigate={noop} />);
    expect(html).toMatch(/<a[^>]*href="\/catalog"/);
  });

  it('shows a group as a section heading with its links under it', () => {
    const group = {
      id: 'g',
      parentId: 'tab',
      kind: 'group' as const,
      label: 'Consulting',
      children: [{ id: 'a', parentId: 'g', kind: 'external-link' as const, label: 'Audit', url: '/audit', children: [] }],
    };
    const html = renderToString(<DrawerRows items={[group]} onDrill={noop} onNavigate={noop} />);
    expect(html).not.toMatch(/<(a|button)[^>]*>[^<]*Consulting/);
    expect(html).toContain('Consulting');
    expect(html).toMatch(/<a[^>]*href="\/audit"/);
  });
});

describe('featuredRowText (feature 168 review)', () => {
  it('says "All in" for a category and names a page or a link by itself', () => {
    const base = { id: 'x', parentId: null, label: 'Tools', url: '/c/tools', children: [] };
    expect(featuredRowText({ ...base, kind: 'category-link' }, labels)).toEqual({ title: 'All in Tools', hint: 'See all' });
    expect(featuredRowText({ ...base, kind: 'external-link', label: 'Partner' }, labels)).toEqual({ title: 'Partner', hint: 'Go' });
  });
});
