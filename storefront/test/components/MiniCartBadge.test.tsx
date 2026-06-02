import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { MiniCartBadge } from '../../components/MiniCartBadge';

/**
 * Feature 027 US1 — SSR contract for MiniCartBadge.
 *
 * Renders the cart-icon link + a count badge. The badge only appears
 * when `itemCount > 0`; clicking goes to `/cart`.
 */

describe('MiniCartBadge — SSR rendering', () => {
  it('omits the count badge when itemCount is 0', () => {
    const html = renderToString(
      <MiniCartBadge itemCount={0} label="Cart" ariaLabel="Cart" />,
    );
    expect(html).toContain('href="/cart"');
    expect(html).toContain('Cart');
    // Badge span carries the count text; assert absence at 0.
    expect(html).not.toMatch(/badge[^>]*>\s*0\s*</);
  });

  it('renders the count badge when itemCount > 0', () => {
    const html = renderToString(
      <MiniCartBadge itemCount={3} label="Cart" ariaLabel="Your cart with items" />,
    );
    expect(html).toContain('href="/cart"');
    expect(html).toContain('Your cart with items');
    expect(html).toContain('aria-label="3 items in cart"');
    expect(html).toMatch(/>3</);
  });

  it('renders the aria-label even on an empty cart', () => {
    const html = renderToString(
      <MiniCartBadge itemCount={0} label="Cart" ariaLabel="Empty cart" />,
    );
    expect(html).toContain('aria-label="Empty cart"');
  });
});
