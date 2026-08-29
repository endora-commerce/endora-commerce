import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { PaymentFailurePanel } from '../../components/checkout/PaymentFailurePanel';
import { FailurePanel } from '../../components/checkout/FailurePanel';

/**
 * Issue #287 — the failure page has two readers, and they are told different
 * things.
 *
 * The one it was written for in feature 036 has **no order**: placement threw,
 * the transaction rolled back, the cart is intact and "Try again" belongs on
 * `/checkout`. The one the owner's ruling sends here **has an order**: the
 * placement completed the cart (`order-service.ts` sets `cart.status =
 * 'completed'`), so telling them the cart was kept is false, and offering them
 * `/checkout` would place a second order for goods they already owe for.
 */

async function payAgain(): Promise<void> {
  // Stands in for the page's server action; never invoked by `renderToString`.
}

describe('PaymentFailurePanel — the buyer whose order exists', () => {
  const props = {
    businessId: 'ORD-2026-000123',
    orderId: '11111111-2222-4333-8444-555555555555',
    locale: 'en-US',
    canRetry: true,
    payAgainAction: payAgain,
  } as const;

  it('names the order and says it is placed and unpaid', () => {
    const html = renderToString(<PaymentFailurePanel {...props} reason="failed" />);
    expect(html).toContain('ORD-2026-000123');
    expect(html).toContain('waiting to be paid');
    expect(html).toContain('did not go through');
  });

  it('never claims the cart was kept', () => {
    // The placement completed the cart. The buyer has an order, not a cart.
    const html = renderToString(<PaymentFailurePanel {...props} reason="failed" />);
    expect(html).not.toContain('cart is unchanged');
    expect(html).not.toContain('no order was created');
    expect(html.toLowerCase()).not.toContain('your cart');
  });

  it('offers no route that would place a second order', () => {
    for (const reason of ['failed', 'cancelled'] as const) {
      const html = renderToString(<PaymentFailurePanel {...props} reason={reason} />);
      expect(html).not.toContain('href="/checkout"');
      expect(html).not.toContain('href="/cart"');
      expect(html).not.toContain('Try again');
      expect(html).not.toContain('Back to cart');
    }
  });

  it('offers to pay this order again, carrying the order it means', () => {
    const html = renderToString(<PaymentFailurePanel {...props} reason="failed" />);
    expect(html).toContain('Pay for this order again');
    expect(html).toContain('<form');
    expect(html).toContain('value="11111111-2222-4333-8444-555555555555"');
    expect(html).toContain('href="/orders/11111111-2222-4333-8444-555555555555"');
  });

  it('says so, rather than offering a button, when this order cannot be paid online', () => {
    const html = renderToString(
      <PaymentFailurePanel {...props} canRetry={false} reason="failed" />,
    );
    expect(html).not.toContain('Pay for this order again');
    expect(html).toContain('href="/orders/11111111-2222-4333-8444-555555555555"');
  });

  it('does not accuse a gateway that never declined anything', () => {
    // Stripe's `cancel_url` is the *back button*. Nothing failed.
    const html = renderToString(<PaymentFailurePanel {...props} reason="cancelled" />);
    expect(html).toContain('was not completed');
    expect(html).not.toContain('did not go through');
  });

  it('renders in Polish too', () => {
    const html = renderToString(
      <PaymentFailurePanel {...props} locale="pl-PL" reason="failed" />,
    );
    expect(html).toContain('ORD-2026-000123');
    expect(html).toContain('czeka na opłacenie');
    expect(html).not.toContain('Pay for this order again');
  });
});

describe('FailurePanel — the buyer whose order was never created', () => {
  it('keeps the cart-kept promise and the route back to checkout', () => {
    // Still true on this path, and only on it: `checkout/page.tsx` sends a
    // buyer here when `placeOrder` threw, and the placement transaction rolled
    // back with the cart untouched.
    const html = renderToString(<FailurePanel reason="Insufficient stock." locale="en-US" />);
    expect(html).toContain('cart is unchanged');
    expect(html).toContain('href="/checkout"');
  });
});
