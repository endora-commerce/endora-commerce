import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { CheckoutHeader } from '../../components/checkout/CheckoutHeader';

/**
 * Feature 036 (US5) — on /checkout* routes the layout swaps the full
 * storefront header for a logo-only minimal header. The root layout's
 * pathname-based branch is integration-level; this test locks the minimal
 * header's output shape.
 */
describe('CheckoutHeader (minimal chrome)', () => {
  it('renders a single banner with a brand link to the home page', () => {
    const html = renderToString(<CheckoutHeader />);
    expect(html).toContain('role="banner"');
    expect(html).toContain('href="/"');
    // Brand mark shown in the minimal checkout chrome (Industria theme).
    expect(html).toContain('Industria');
  });

  it('contains no navigation, search, megamenu, or cart-icon affordances', () => {
    const html = renderToString(<CheckoutHeader />);
    expect(html).not.toMatch(/<nav\b/);
    expect(html.toLowerCase()).not.toContain('search');
    expect(html.toLowerCase()).not.toContain('megamenu');
    expect(html.toLowerCase()).not.toContain('cart');
  });
});
