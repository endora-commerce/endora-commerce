import { describe, expect, it } from 'vitest';
import { QuoteRequest } from '../entities/quote-request.entity.js';
import { toQuoteRequestRecord } from './quote-request-read-port.js';

/**
 * `specs/192-quote-request-draft-share/` T006 (research R-3) — the read-port
 * record says whether the customer may see the quote. Operator-side readers
 * (`crm`, `projects`, `organizations`) keep reading unshared quotes; `carts`
 * reads the flag to refuse a customer's conversion of one.
 */
function quote(overrides: Partial<QuoteRequest> = {}): QuoteRequest {
  return Object.assign(new QuoteRequest(), {
    organizationId: '00000000-0000-4000-8000-000000000001',
    customerAccountId: '00000000-0000-4000-8000-000000000002',
    ...overrides,
  });
}

describe('toQuoteRequestRecord — sharing', () => {
  it('a new row is shared by default (every creation path but the operator create)', () => {
    expect(new QuoteRequest().sharedWithCustomer).toBe(true);
    expect(toQuoteRequestRecord(quote()).sharedWithCustomer).toBe(true);
  });

  it('maps an unshared quote as unshared', () => {
    expect(toQuoteRequestRecord(quote({ sharedWithCustomer: false })).sharedWithCustomer).toBe(false);
  });
});
