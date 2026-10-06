import { describe, expect, it, vi } from 'vitest';
import type { OrderRecord } from '@endora-commerce/contracts';
import {
  OpportunityAutoCreateService,
  type OpportunityAutoCreateServiceDeps,
} from './opportunity-auto-create-service.js';

const ORDER_ID = '00000000-0000-4000-8000-0000000000a1';
const ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000b1';
const CHANNEL_ID = '00000000-0000-4000-8000-0000000000c1';
const QUOTE_ID = '00000000-0000-4000-8000-0000000000d1';

const order = {
  id: ORDER_ID,
  businessId: 'ORD-1',
  organizationId: ORGANIZATION_ID,
  salesChannelId: CHANNEL_ID,
  currency: 'PLN',
  sourceQuoteRequestId: null,
} as OrderRecord;

function service(overrides: Partial<OpportunityAutoCreateServiceDeps> = {}) {
  const deps = {
    orders: { findById: vi.fn(async () => order) },
    organizations: { findById: vi.fn(async () => ({ id: ORGANIZATION_ID, name: 'Acme' })) },
    settings: { get: vi.fn(async () => true) },
    quoteRequests: {
      isPresent: vi.fn(() => true),
      load: vi.fn(async () => ({
        record: { id: QUOTE_ID, businessId: 'QR-1', organizationId: ORGANIZATION_ID },
        lines: [],
        amount: '10.00',
        currency: 'EUR',
      })),
    },
    links: {
      linkOrderPlacedFromQuoteRequest: vi.fn(async () => null),
      opportunityIdOf: vi.fn(async () => null),
    },
    createForDocument: vi.fn(async () => ({ id: 'opp', number: 'OPP-000001' })),
    events: { emit: vi.fn() },
    // Off the bus's chain in the composed module; here it simply runs.
    defer: vi.fn((work: () => Promise<unknown>) => work().then(() => undefined)),
    sleep: vi.fn(async () => undefined),
    ...overrides,
  };
  return { deps, subject: new OpportunityAutoCreateService(deps as never as OpportunityAutoCreateServiceDeps) };
}

describe('OpportunityAutoCreateService — a placed Order', () => {
  it('creates an Opportunity for the Order’s Organization, channel and currency, and announces the link', async () => {
    const { deps, subject } = service();
    expect(await subject.onOrderCreated(ORDER_ID)).toBe('created');
    expect(deps.settings.get).toHaveBeenCalledWith('crm.auto_create_from_orders', CHANNEL_ID, expect.anything());
    expect(deps.createForDocument).toHaveBeenCalledWith({
      title: 'ORD-1 — Acme',
      organizationId: ORGANIZATION_ID,
      currency: 'PLN',
      salesChannelId: CHANNEL_ID,
      source: 'order',
      document: { kind: 'order', id: ORDER_ID },
    });
    expect(deps.events.emit).toHaveBeenCalledWith(
      'crm.opportunity.document_linked.v1',
      expect.objectContaining({ opportunityId: 'opp', documentKind: 'order', documentId: ORDER_ID, linkSource: 'auto' }),
    );
  });

  it('handles an Order that is readable at once without deferring anything', async () => {
    const { deps, subject } = service();
    expect(await subject.onOrderCreated(ORDER_ID)).toBe('created');
    expect(deps.defer).not.toHaveBeenCalled();
    expect(deps.sleep).not.toHaveBeenCalled();
  });

  it('does not wait on the bus for a commit still in flight: it answers at once and looks again, deferred', async () => {
    const findById = vi
      .fn<() => Promise<OrderRecord | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValue(order);
    // Held back, as the composed module holds it off the dispatch chain.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const defer = vi.fn((work: () => Promise<unknown>) => held.then(work).then(() => undefined));
    const { deps, subject } = service({ orders: { findById } as never, defer });

    // The handler's answer: one read, nothing slept through, nothing created yet.
    expect(await subject.onOrderCreated(ORDER_ID)).toBe('deferred');
    expect(findById).toHaveBeenCalledTimes(1);
    expect(deps.sleep).not.toHaveBeenCalled();
    expect(deps.createForDocument).not.toHaveBeenCalled();

    release();
    await subject.idle();
    expect(findById).toHaveBeenCalledTimes(3);
    expect(deps.sleep).toHaveBeenCalledTimes(2);
    expect(deps.createForDocument).toHaveBeenCalledTimes(1);
  });

  it('gives up on an Order that never appears — it was rolled back — and creates nothing', async () => {
    const findById = vi.fn(async () => null);
    const { deps, subject } = service({ orders: { findById } as never });
    expect(await subject.onOrderCreated(ORDER_ID)).toBe('deferred');
    await subject.idle();
    // A bounded wait: a little over two seconds in all, then no more reads.
    const waited = (deps.sleep.mock.calls as unknown as number[][]).reduce((sum, [ms = 0]) => sum + ms, 0);
    expect(waited).toBeGreaterThan(1000);
    expect(waited).toBeLessThan(5000);
    expect(findById).toHaveBeenCalledTimes(deps.sleep.mock.calls.length + 1);
    expect(deps.createForDocument).not.toHaveBeenCalled();
  });

  it('joins the Opportunity of its Quote Request whatever the setting says', async () => {
    const { deps, subject } = service({
      settings: { get: vi.fn(async () => false) } as never,
      links: {
        linkOrderPlacedFromQuoteRequest: vi.fn(async () => 'existing'),
        opportunityIdOf: vi.fn(async () => null),
      } as never,
    });
    expect(await subject.onOrderCreated(ORDER_ID)).toBe('joined');
    expect(deps.createForDocument).not.toHaveBeenCalled();
    expect(deps.settings.get).not.toHaveBeenCalled();
  });

  it('creates nothing for an Order that is linked already, without reading the setting', async () => {
    const { deps, subject } = service({
      links: {
        linkOrderPlacedFromQuoteRequest: vi.fn(async () => null),
        opportunityIdOf: vi.fn(async () => 'existing'),
      } as never,
    });
    expect(await subject.onOrderCreated(ORDER_ID)).toBe('already-linked');
    expect(deps.createForDocument).not.toHaveBeenCalled();
    expect(deps.settings.get).not.toHaveBeenCalled();
  });

  it('creates nothing while the setting is off', async () => {
    const { deps, subject } = service({ settings: { get: vi.fn(async () => false) } as never });
    expect(await subject.onOrderCreated(ORDER_ID)).toBe('setting-off');
    expect(deps.createForDocument).not.toHaveBeenCalled();
  });

  it('reports a lost race as already-linked and announces nothing', async () => {
    const { deps, subject } = service({ createForDocument: vi.fn(async () => 'already-linked' as const) });
    expect(await subject.onOrderCreated(ORDER_ID)).toBe('already-linked');
    expect(deps.events.emit).not.toHaveBeenCalled();
  });
});

describe('OpportunityAutoCreateService — a submitted Quote Request', () => {
  it('creates an Opportunity in the request’s currency, with no Sales Channel, reading the platform-wide setting', async () => {
    const { deps, subject } = service();
    expect(await subject.onQuoteRequestCreated(QUOTE_ID)).toBe('created');
    expect(deps.settings.get).toHaveBeenCalledWith('crm.auto_create_from_quote_requests', null, expect.anything());
    expect(deps.createForDocument).toHaveBeenCalledWith({
      title: 'QR-1 — Acme',
      organizationId: ORGANIZATION_ID,
      currency: 'EUR',
      salesChannelId: null,
      source: 'quote_request',
      document: { kind: 'quote_request', id: QUOTE_ID },
    });
  });

  it('decides the owner’s presence before asking its port', async () => {
    const load = vi.fn();
    const { deps, subject } = service({
      quoteRequests: { isPresent: vi.fn(() => false), load } as never,
    });
    expect(await subject.onQuoteRequestCreated(QUOTE_ID)).toBe('owner-absent');
    expect(load).not.toHaveBeenCalled();
    expect(deps.createForDocument).not.toHaveBeenCalled();
  });

  it('a deferred look asks for the owner’s presence again before every read', async () => {
    let present = true;
    const load = vi.fn(async () => null);
    const { subject } = service({
      quoteRequests: { isPresent: vi.fn(() => present), load } as never,
      sleep: vi.fn(async () => {
        // Switched off while the look was waiting.
        present = false;
      }),
    });
    expect(await subject.onQuoteRequestCreated(QUOTE_ID)).toBe('deferred');
    await subject.idle();
    // Read once while present; never again once it was not.
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('creates nothing for a request that is linked already, or while the setting is off', async () => {
    const linked = service({
      links: {
        linkOrderPlacedFromQuoteRequest: vi.fn(async () => null),
        opportunityIdOf: vi.fn(async () => 'existing'),
      } as never,
    });
    expect(await linked.subject.onQuoteRequestCreated(QUOTE_ID)).toBe('already-linked');
    const off = service({ settings: { get: vi.fn(async () => false) } as never });
    expect(await off.subject.onQuoteRequestCreated(QUOTE_ID)).toBe('setting-off');
    expect(off.deps.createForDocument).not.toHaveBeenCalled();
  });
});
