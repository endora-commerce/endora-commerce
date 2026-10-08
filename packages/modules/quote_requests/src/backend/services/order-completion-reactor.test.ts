import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { OrderReadPort, OrderRecord } from '@endora-commerce/contracts';
import { createOrderCompletionReactor } from './order-completion-reactor.js';
import type { RfqEventService } from './rfq-event-service.js';
import type { RfqNotificationService } from './rfq-notification-service.js';

const ORG = '00000000-0000-4000-8000-0000000000aa';
const OTHER_ORG = '00000000-0000-4000-8000-0000000000ab';
const ORDER_ID = '00000000-0000-4000-8000-000000000001';
const QUOTE_ID = '00000000-0000-4000-8000-000000000002';

const order = (overrides: Partial<OrderRecord> = {}): OrderRecord =>
  ({ id: ORDER_ID, organizationId: ORG, sourceQuoteRequestId: QUOTE_ID, ...overrides }) as OrderRecord;

/**
 * The reactor against doubles: what it does with an order that is there, one
 * that is not there yet, and one that never arrives
 * (`specs/143-crm-sales-opportunities/`, FR-104).
 */
function rig(options: { reads: Array<OrderRecord | null>; quoteOrganizationId?: string; present?: () => boolean }) {
  const quote = {
    id: QUOTE_ID,
    organizationId: options.quoteOrganizationId ?? ORG,
    customerAccountId: 'customer',
    status: 'Approved',
    completedAt: null as Date | null,
    convertedOrderId: null as string | null,
    version: 3,
  };
  const reads = [...options.reads];
  const findById = vi.fn(async () => (reads.length > 0 ? (reads.shift() ?? null) : null));
  const slept: number[] = [];
  const append = vi.fn(async () => ({ id: 'event' }));
  const enqueue = vi.fn(async () => undefined);
  const reactor = createOrderCompletionReactor({
    emFactory: () => ({ findOne: async () => quote, flush: async () => undefined }) as unknown as EntityManager,
    orders: { findById } as unknown as OrderReadPort,
    eventService: { append } as unknown as RfqEventService,
    notificationService: { enqueue } as unknown as RfqNotificationService,
    defer: async (work) => {
      await work();
    },
    stillPresent: options.present ?? (() => true),
    sleep: async (milliseconds) => {
      slept.push(milliseconds);
    },
  });
  return { reactor, quote, findById, slept, append, enqueue };
}

describe('order completion reactor', () => {
  it('completes the request of an order it can read at once, without waiting', async () => {
    const r = rig({ reads: [order()] });
    await r.reactor.onOrderCreated({ orderId: ORDER_ID });
    expect(r.quote).toMatchObject({ status: 'Completed', convertedOrderId: ORDER_ID, version: 4 });
    expect(r.slept).toEqual([]);
    expect(r.append).toHaveBeenCalledTimes(1);
    expect(r.enqueue).toHaveBeenCalledTimes(1);
  });

  it('looks again for an order whose commit was still in flight, and completes when it appears', async () => {
    const r = rig({ reads: [null, null, order()] });
    await r.reactor.onOrderCreated({ orderId: ORDER_ID });
    await r.reactor.idle();
    expect(r.quote).toMatchObject({ status: 'Completed', convertedOrderId: ORDER_ID });
    expect(r.slept).toEqual([10, 25]);
    expect(r.findById).toHaveBeenCalledTimes(3);
  });

  it('gives up on an order that never commits — a bounded wait, and nothing written', async () => {
    const r = rig({ reads: [] });
    await r.reactor.onOrderCreated({ orderId: ORDER_ID });
    await r.reactor.idle();
    expect(r.quote.status).toBe('Approved');
    expect(r.slept).toEqual([10, 25, 75, 150, 250, 500, 1000]);
    expect(r.findById).toHaveBeenCalledTimes(8);
    expect(r.append).not.toHaveBeenCalled();
  });

  it('stops looking once the module is switched off', async () => {
    let present = true;
    const r = rig({ reads: [null, null, order()], present: () => present });
    present = false;
    await r.reactor.onOrderCreated({ orderId: ORDER_ID });
    await r.reactor.idle();
    expect(r.quote.status).toBe('Approved');
    // The read the handler made itself, and none after.
    expect(r.findById).toHaveBeenCalledTimes(1);
  });

  it('does nothing for an order that names no request', async () => {
    const r = rig({ reads: [order({ sourceQuoteRequestId: null })] });
    await r.reactor.onOrderCreated({ orderId: ORDER_ID });
    expect(r.quote.status).toBe('Approved');
  });

  it('never completes a request of another Organization, whatever the order names', async () => {
    const r = rig({ reads: [order()], quoteOrganizationId: OTHER_ORG });
    await r.reactor.onOrderCreated({ orderId: ORDER_ID });
    expect(r.quote).toMatchObject({ status: 'Approved', convertedOrderId: null });
    expect(r.append).not.toHaveBeenCalled();
    expect(r.enqueue).not.toHaveBeenCalled();
  });
});
