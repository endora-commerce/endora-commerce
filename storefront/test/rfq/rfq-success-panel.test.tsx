import { describe, expect, it } from 'vitest';
import { renderToString } from 'react-dom/server';
import { RfqSuccessPanel } from '../../components/rfq/RfqSuccessPanel';

/**
 * Feature 008 — the quote-request Success Page shows the customer-facing
 * business RFQ ID (never the database UUID) and a next-steps hint, mirroring
 * the checkout success page.
 */
describe('RfqSuccessPanel', () => {
  const rfqId = '11111111-2222-4333-8444-555555555555';

  it('shows the business RFQ ID as the request number (not the UUID as a label)', () => {
    const html = renderToString(
      <RfqSuccessPanel businessId="RFQ-1042-2026" rfqId={rfqId} locale="en-US" />,
    );
    expect(html).toContain('Your quote request number is <strong>RFQ-1042-2026</strong>');
    // The UUID never appears as visible text — only inside the detail link href.
    expect(html).not.toContain(`>${rfqId}<`);
    expect(html).toContain('your quote request is submitted');
  });

  it('renders the Polish copy when locale is pl-PL', () => {
    const html = renderToString(
      <RfqSuccessPanel businessId="RFQ-7" rfqId={rfqId} locale="pl-PL" />,
    );
    expect(html).toContain('Dziekujemy');
    expect(html).toContain('Numer Twojego zapytania ofertowego');
    expect(html).not.toContain('Thank you');
  });

  it('links to the full request detail using the internal id', () => {
    const html = renderToString(
      <RfqSuccessPanel businessId="RFQ-7" rfqId={rfqId} locale="en-US" />,
    );
    expect(html).toContain(`/quote-requests/${rfqId}`);
  });
});
