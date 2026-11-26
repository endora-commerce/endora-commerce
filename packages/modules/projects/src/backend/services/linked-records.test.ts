import { describe, expect, it, vi } from 'vitest';
import type {
  OpportunityReadPort,
  OpportunityRecord,
  OrderReadPort,
  QuoteRequestAmount,
  QuoteRequestReadPort,
  QuoteRequestRecord,
} from '@endora-commerce/contracts';
import { createLinkedRecordOwners } from './linked-records.js';

/**
 * Issue #456 — a Project shows a linked Quote Request at the amount
 * `quote_requests` publishes, with how far it is agreed, and does not
 * re-derive it from the lines.
 *
 * Issue #457 — linked Quote Requests and Opportunities are read in one batch
 * per kind through their owners' `findByIds` (and `amountsOf`), never one
 * record at a time.
 */
const ID = '00000000-0000-4000-8000-0000000000b1';
const ORG = '00000000-0000-4000-8000-0000000000c1';

const quoteId = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const opportunityId = (n: number) => `00000000-0000-4000-9000-${String(n).padStart(12, '0')}`;

function quoteRecord(id: string, n: number): QuoteRequestRecord {
  return { id, organizationId: ORG, businessId: `QR-${n}`, status: 'Pending' } as unknown as QuoteRequestRecord;
}

function opportunityRecord(id: string, n: number): OpportunityRecord {
  return {
    id,
    organizationId: ORG,
    number: `OPP-${n}`,
    statusCode: 'new',
    value: `${n}00.00`,
    currency: 'PLN',
  } as unknown as OpportunityRecord;
}

function owners(
  amount: QuoteRequestAmount = { amount: '35.00', currency: 'PLN', agreement: 'partial' },
  quotes: QuoteRequestRecord[] = [quoteRecord(ID, 1)],
  opportunities: OpportunityRecord[] = [],
) {
  const unbatched = (what: string) =>
    vi.fn(async () => {
      throw new Error(`${what}: a linked record is read in a batch (issue #457)`);
    });
  const quoteRequests = {
    findById: unbatched('quoteRequestReadPort.findById'),
    findByIds: vi.fn(async (ids: readonly string[]) => quotes.filter((quote) => ids.includes(quote.id))),
    findByBusinessId: vi.fn(async () => null),
    listOpenForOrganizations: vi.fn(async () => []),
    statusName: vi.fn(async (status: string) => status),
    listItems: vi.fn(async () => {
      throw new Error('the lines are quote_requests’ to value');
    }),
    amountOf: unbatched('quoteRequestReadPort.amountOf'),
    amountsOf: vi.fn(
      async (ids: readonly string[]) =>
        new Map(quotes.filter((quote) => ids.includes(quote.id)).map((quote) => [quote.id, amount] as const)),
    ),
  } satisfies QuoteRequestReadPort;
  const opportunityPort = {
    findById: unbatched('opportunityReadPort.findById'),
    findByIds: vi.fn(async (ids: readonly string[]) => opportunities.filter((record) => ids.includes(record.id))),
    findByDocument: vi.fn(async () => null),
    listOpenForOrganization: vi.fn(async () => []),
    search: vi.fn(async () => []),
    statusName: vi.fn(async (code: string) => code),
    listNotes: vi.fn(async () => {
      throw new Error('opportunityReadPort.listNotes: linked records read no note');
    }),
  } satisfies OpportunityReadPort;
  const subject = createLinkedRecordOwners({
    quoteRequests,
    orders: {} as OrderReadPort,
    opportunities: opportunityPort,
  });
  return { subject, quoteRequests, opportunities: opportunityPort };
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
    expect(quoteRequests.amountsOf).toHaveBeenCalledWith([ID]);
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

describe('linked records — one batch per kind (issue #457)', () => {
  const amount: QuoteRequestAmount = { amount: '10.00', currency: 'PLN', agreement: 'none' };

  it('reads N linked Quote Requests with one findByIds and one amountsOf, whatever N is', async () => {
    const quotes = [1, 2, 3, 4, 5].map((n) => quoteRecord(quoteId(n), n));
    const missing = quoteId(99);
    const { subject, quoteRequests } = owners(amount, quotes);

    const found = await subject.findMany('quote_request', [...quotes.map((quote) => quote.id), missing, quotes[0]!.id]);

    expect(quoteRequests.findByIds).toHaveBeenCalledTimes(1);
    expect(quoteRequests.amountsOf).toHaveBeenCalledTimes(1);
    expect(quoteRequests.findById).not.toHaveBeenCalled();
    expect(quoteRequests.amountOf).not.toHaveBeenCalled();
    // A missing (or out-of-scope) Quote Request is absent, as `findById` answered it.
    expect([...found.keys()].sort()).toEqual(quotes.map((quote) => quote.id).sort());
    expect(found.get(quoteId(3))).toEqual({
      kind: 'quote_request',
      id: quoteId(3),
      organizationId: ORG,
      number: 'QR-3',
      status: 'Pending',
      amount: '10.00',
      currency: 'PLN',
      agreement: 'none',
      href: `/quote-requests/${quoteId(3)}`,
    });
  });

  it('values only the Quote Requests findByIds answered', async () => {
    const quotes = [quoteRecord(quoteId(1), 1)];
    const { subject, quoteRequests } = owners(amount, quotes);
    await subject.findMany('quote_request', [quoteId(1), quoteId(2)]);
    expect(quoteRequests.amountsOf).toHaveBeenCalledWith([quoteId(1)]);
  });

  it('drops a Quote Request its owner no longer values, as a null amountOf did', async () => {
    const quotes = [quoteRecord(quoteId(1), 1), quoteRecord(quoteId(2), 2)];
    const { subject, quoteRequests } = owners(amount, quotes);
    quoteRequests.amountsOf.mockResolvedValueOnce(new Map([[quoteId(2), amount]]));
    expect([...(await subject.findMany('quote_request', quotes.map((quote) => quote.id))).keys()]).toEqual([quoteId(2)]);
  });

  it('reads N linked Opportunities with one findByIds, whatever N is', async () => {
    const records = [1, 2, 3, 4].map((n) => opportunityRecord(opportunityId(n), n));
    const { subject, opportunities } = owners(amount, [], records);

    const found = await subject.findMany('opportunity', [...records.map((record) => record.id), opportunityId(99)]);

    expect(opportunities.findByIds).toHaveBeenCalledTimes(1);
    expect(opportunities.findById).not.toHaveBeenCalled();
    expect([...found.keys()].sort()).toEqual(records.map((record) => record.id).sort());
    expect(found.get(opportunityId(2))).toEqual({
      kind: 'opportunity',
      id: opportunityId(2),
      organizationId: ORG,
      number: 'OPP-2',
      status: 'new',
      amount: '200.00',
      currency: 'PLN',
      href: `/crm/opportunities/${opportunityId(2)}`,
    });
  });

  it('answers one Opportunity through the same batched read', async () => {
    const { subject, opportunities } = owners(amount, [], [opportunityRecord(opportunityId(1), 1)]);
    expect(await subject.find('opportunity', opportunityId(1))).toMatchObject({ number: 'OPP-1' });
    expect(await subject.find('opportunity', opportunityId(2))).toBeNull();
    expect(opportunities.findById).not.toHaveBeenCalled();
  });

  it('asks nothing for an empty list', async () => {
    const { subject, quoteRequests, opportunities } = owners();
    expect((await subject.findMany('quote_request', [])).size).toBe(0);
    expect((await subject.findMany('opportunity', [])).size).toBe(0);
    expect(quoteRequests.findByIds).not.toHaveBeenCalled();
    expect(opportunities.findByIds).not.toHaveBeenCalled();
  });
});
