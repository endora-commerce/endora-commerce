import { describe, expect, it, vi } from 'vitest';
import type {
  OpportunityReadPort,
  OrderReadPort,
  QuoteRequestReadPort,
  QuoteRequestRecord,
} from '@endora-commerce/contracts';
import { createLinkedRecordOwners } from './linked-records.js';

/**
 * Issue #456 — a Project shows a linked Quote Request at the amount
 * `quote_requests` publishes, with how far it is agreed, and does not
 * re-derive it from the lines.
 */
const ID = '00000000-0000-4000-8000-0000000000b1';
const ORG = '00000000-0000-4000-8000-0000000000c1';

function owners(
  amount: { amount: string | null; currency: string | null; agreement: 'agreed' | 'partial' | 'none' } = {
    amount: '35.00',
    currency: 'PLN',
    agreement: 'partial',
  },
) {
  const quoteRequests = {
    findById: vi.fn(async () =>
      ({ id: ID, organizationId: ORG, businessId: 'QR-1', status: 'Pending' }) as unknown as QuoteRequestRecord,
    ),
    findByBusinessId: vi.fn(async () => null),
    listOpenForOrganizations: vi.fn(async () => []),
    listItems: vi.fn(async () => {
      throw new Error('the lines are quote_requests’ to value');
    }),
    amountOf: vi.fn(async () => amount),
  } satisfies QuoteRequestReadPort;
  const subject = createLinkedRecordOwners({
    quoteRequests,
    orders: {} as OrderReadPort,
    opportunities: {} as OpportunityReadPort,
  });
  return { subject, quoteRequests };
}

describe('linked records — a Quote Request’s amount (issue #456)', () => {
  it('is the one its owner publishes, with its agreement', async () => {
    const { subject, quoteRequests } = owners();
    expect(await subject.find('quote_request', ID)).toMatchObject({
      kind: 'quote_request',
      amount: '35.00',
      currency: 'PLN',
      agreement: 'partial',
    });
    expect(quoteRequests.amountOf).toHaveBeenCalledWith(ID);
    expect(quoteRequests.listItems).not.toHaveBeenCalled();
  });

  it('carries a fully agreed Quote Request as agreed', async () => {
    const { subject } = owners({ amount: '24.50', currency: 'PLN', agreement: 'agreed' });
    expect(await subject.find('quote_request', ID)).toMatchObject({ amount: '24.50', agreement: 'agreed' });
  });

  it('a Quote Request without any price has no amount', async () => {
    const { subject } = owners({ amount: null, currency: 'PLN', agreement: 'none' });
    expect(await subject.find('quote_request', ID)).toMatchObject({ amount: null, agreement: 'none' });
  });
});
