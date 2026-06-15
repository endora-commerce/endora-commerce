import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import type { ResolvedMegamenu } from '@b2b/contracts';
import { MegamenuMobileDrawer } from '../../components/Megamenu/MegamenuMobileDrawer';

/**
 * T074 — Mobile drawer renders the burger trigger and (closed) is
 * `md:hidden` so it doesn't bleed into the desktop layout. The drill-
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
      children: [],
    },
  ],
};

describe('MegamenuMobileDrawer — SSR initial render', () => {
  it('renders the burger trigger (icon-button) and is marked md:hidden on the wrapper', () => {
    const html = renderToString(<MegamenuMobileDrawer megamenu={fixture} />);
    expect(html).toContain('aria-label="Menu"');
    expect(html).toContain('icon-btn');
    expect(html).toContain('md:hidden');
  });

  it('does not render the drawer body in the closed initial state', () => {
    const html = renderToString(<MegamenuMobileDrawer megamenu={fixture} />);
    // Top-level item labels appear inside the drawer body; closed initial
    // state hides the body so neither label appears in the SSR output.
    expect(html).not.toContain('Catalog');
    expect(html).not.toContain('Phone');
  });

  it('gates the feature-044 chrome (Quick Order promo, breadcrumb) behind the open state', () => {
    const html = renderToString(<MegamenuMobileDrawer megamenu={fixture} />);
    // The root promo + the drill-down breadcrumb only exist once the drawer is
    // opened (client interaction, exercised on device); closed → neither shows.
    expect(html).not.toContain('Quick Order');
    expect(html).not.toContain('Kategorie ›');
  });
});
