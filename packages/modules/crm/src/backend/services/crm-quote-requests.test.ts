import { describe, expect, it, vi } from 'vitest';
import type { QuoteRequestReadPort, QuoteRequestRecord } from '@endora-commerce/contracts';
import { createCrmQuoteRequests } from './crm-quote-requests.js';

/**
 * Issue #456 — CRM shows a Quote Request at the amount `quote_requests`
 * publishes, and does not re-derive it from the lines.
 */
const ID = '00000000-0000-4000-8000-0000000000b1';

function port(): QuoteRequestReadPort {
  return {
    findById: vi.fn(async () => ({ id: ID, businessId: 'QR-1', status: 'Pending' }) as unknown as QuoteRequestRecord),
    findByBusinessId: vi.fn(async () => null),
    listOpenForOrganizations: vi.fn(async () => []),
    // Lines that would add up to something else: they must not be read.
    listItems: vi.fn(async () => {
      throw new Error('the lines are quote_requests’ to value');
    }),
    amountOf: vi.fn(async () => ({ amount: '35.00', currency: 'PLN', partiallyAgreed: true })),
  };
}

describe('createCrmQuoteRequests — the published amount (issue #456)', () => {
  it('loads a Quote Request with its owner’s amount, currency and partially-agreed flag', async () => {
    const quotes = port();
    const document = await createCrmQuoteRequests(quotes).load(ID);
    expect(document).toMatchObject({ amount: '35.00', currency: 'PLN', partiallyAgreed: true });
    expect(quotes.amountOf).toHaveBeenCalledWith(ID);
    expect(quotes.listItems).not.toHaveBeenCalled();
  });

  it('asks for no amount of a Quote Request the reader cannot see', async () => {
    const quotes = port();
    vi.mocked(quotes.findById).mockResolvedValueOnce(null);
    expect(await createCrmQuoteRequests(quotes).load(ID)).toBeNull();
    expect(quotes.amountOf).not.toHaveBeenCalled();
  });
});
