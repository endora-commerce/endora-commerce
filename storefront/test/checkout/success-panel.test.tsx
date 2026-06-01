import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { SuccessPanel } from '../../components/checkout/SuccessPanel';

/**
 * Feature 036 (US1) — the checkout Success Page shows the customer-facing
 * business Order ID (never the database UUID) and a payment-method hint.
 */
describe('SuccessPanel', () => {
  const orderId = '11111111-2222-4333-8444-555555555555';

  it('shows the business Order ID as the order number (not the UUID as a label)', () => {
    const html = renderToString(
      <SuccessPanel businessId="ORD-1042-2026" orderId={orderId} paymentKind="pickup" locale="en-US" />,
    );
    // The business ID is the displayed order number.
    expect(html).toContain('Your order number is <strong>ORD-1042-2026</strong>');
    // The UUID never appears as visible text — only inside the details link href.
    expect(html).not.toContain(`>${orderId}<`);
    expect(html).toContain('your order is placed');
  });

  it('shows the bank-transfer next-step hint for a transfer payment', () => {
    const html = renderToString(
      <SuccessPanel businessId="ORD-7" orderId={orderId} paymentKind="bank_transfer" locale="en-US" />,
    );
    expect(html).toContain('bank transfer');
  });

  it('renders the Polish copy when locale is pl-PL (feature 036 T039)', () => {
    const html = renderToString(
      <SuccessPanel
        businessId="ORD-1042"
        orderId={orderId}
        paymentKind="bank_transfer"
        locale="pl-PL"
      />,
    );
    expect(html).toContain('Dziekujemy');
    expect(html).toContain('Numer Twojego zamowienia');
    expect(html).toContain('Prosimy o przelew');
    expect(html).not.toContain('Thank you');
  });

  it('links to the full order detail using the internal id', () => {
    const html = renderToString(
      <SuccessPanel businessId="ORD-7" orderId={orderId} paymentKind="pickup" locale="en-US" />,
    );
    expect(html).toContain(`/orders/${orderId}`);
  });
});
