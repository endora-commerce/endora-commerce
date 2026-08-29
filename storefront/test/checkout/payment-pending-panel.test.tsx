import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { PaymentPendingPanel } from '../../components/checkout/PaymentPendingPanel';

/**
 * Issue #287 — the webhook race, which is the hard case.
 *
 * A buyer can be back from the gateway before its confirmation has reached us,
 * so the order is legitimately neither paid nor failed. Showing "payment
 * failed" to someone whose money is in flight is the worst outcome available,
 * so this is a third answer rather than a default to either page.
 */
describe('PaymentPendingPanel', () => {
  const props = {
    businessId: 'ORD-2026-000123',
    orderId: '11111111-2222-4333-8444-555555555555',
    locale: 'en-US',
    checkAgainUrl: '/checkout/return?id=11111111-2222-4333-8444-555555555555&outcome=returned',
  } as const;

  it('says the payment is being confirmed, and never that it failed', () => {
    const html = renderToString(<PaymentPendingPanel {...props} poll={{ url: '/x', delayMs: 3000 }} />);
    expect(html).toContain('confirming your payment');
    expect(html).toContain('ORD-2026-000123');
    expect(html.toLowerCase()).not.toContain('failed');
    expect(html.toLowerCase()).not.toContain('did not go through');
  });

  it('says the order is placed, so the buyer does not re-order', () => {
    const html = renderToString(<PaymentPendingPanel {...props} poll={{ url: '/x', delayMs: 3000 }} />);
    expect(html).toContain('order is placed');
    expect(html).not.toContain('href="/checkout"');
    expect(html).not.toContain('href="/cart"');
  });

  it('leaves a way to look again that needs no JavaScript', () => {
    const html = renderToString(<PaymentPendingPanel {...props} poll={{ url: '/x', delayMs: 3000 }} />);
    expect(html).toContain(`href="${props.checkAgainUrl.replace(/&/g, '&amp;')}"`);
    expect(html).toContain('href="/orders/11111111-2222-4333-8444-555555555555"');
  });

  it('stops re-checking once the budget is spent, and still does not call it a failure', () => {
    const html = renderToString(<PaymentPendingPanel {...props} poll={null} />);
    expect(html).toContain('longer than usual');
    expect(html).toContain('e-mail you');
    expect(html.toLowerCase()).not.toContain('failed');
    // The manual check stays: the buyer is never left without a next step.
    expect(html).toContain(`href="${props.checkAgainUrl.replace(/&/g, '&amp;')}"`);
  });

  it('renders in Polish too', () => {
    const html = renderToString(
      <PaymentPendingPanel {...props} locale="pl-PL" poll={{ url: '/x', delayMs: 3000 }} />,
    );
    expect(html).toContain('ORD-2026-000123');
    expect(html).toContain('potwierdzenie płatności');
  });
});
