import { describe, expect, it, vi } from 'vitest';
import { renderToString } from 'react-dom/server';

let locale = 'en-US';
vi.mock('../../lib/server-context', () => ({
  getServerContext: async () => ({ locale }),
}));

const { CheckoutHeader, CheckoutHeaderView } = await import('../../components/checkout/CheckoutHeader');

/**
 * Feature 036 (US5) — on /checkout* routes the layout swaps the full
 * storefront header for a logo-only minimal header. The root layout's
 * pathname-based branch is integration-level; this test locks the minimal
 * header's output shape.
 */
describe('CheckoutHeader (minimal chrome)', () => {
  it('renders a single banner with a brand link to the home page', () => {
    const html = renderToString(<CheckoutHeaderView locale="en-US" />);
    expect(html).toContain('role="banner"');
    expect(html).toContain('href="/"');
    // Brand mark shown in the minimal checkout chrome (Industria theme).
    expect(html).toContain('Industria');
  });

  it('contains no navigation, search, megamenu, or cart-icon affordances', () => {
    const html = renderToString(<CheckoutHeaderView locale="en-US" />);
    expect(html).not.toMatch(/<nav\b/);
    expect(html.toLowerCase()).not.toContain('search');
    expect(html.toLowerCase()).not.toContain('megamenu');
    expect(html.toLowerCase()).not.toContain('cart');
  });

  // Issue #85 — the tagline and the link's name are the page's language; the brand is not translated.
  it.each([
    ['en-US', 'aria-label="Industria — home page"', 'B2B · Industrial components'],
    ['pl-PL', 'aria-label="Industria — strona główna"', 'B2B · Komponenty przemysłowe'],
  ])('speaks %s, read from the request', async (requestLocale, label, tagline) => {
    locale = requestLocale;
    const html = renderToString(<>{await CheckoutHeader()}</>);
    expect(html).toContain(label);
    expect(html).toContain(tagline);
    expect(html).toContain('>IN<');
    if (requestLocale === 'en-US') expect(html).not.toMatch(/[ąćęłńóśźż]/i);
  });
});
