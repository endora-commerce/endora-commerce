import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { FailurePanel } from '../../components/checkout/FailurePanel';

/**
 * Feature 036 (US4) — the Failure Page shows a reason-appropriate message, a
 * "Try again" button back to checkout, and reassures the buyer the cart is kept.
 */
describe('FailurePanel', () => {
  it('shows the specific reason and a retry link to checkout', () => {
    const html = renderToString(<FailurePanel reason="Insufficient stock for product X." locale="en-US" />);
    expect(html).toContain('Insufficient stock for product X.');
    expect(html).toContain('Try again');
    expect(html).toContain('href="/checkout"');
    expect(html).toContain('cart is unchanged');
  });

  it('falls back to a generic message when no reason is given', () => {
    const html = renderToString(<FailurePanel reason={null} locale="en-US" />);
    expect(html).toContain('Something went wrong');
    expect(html).toContain('Try again');
  });
});
