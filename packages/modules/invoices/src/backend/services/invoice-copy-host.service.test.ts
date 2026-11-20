import { describe, expect, it } from 'vitest';
import type { OrderReadPort, OrderRecord } from '@endora-commerce/contracts';
import { InvoiceCopyHostService } from './invoice-copy-host.service.js';

/**
 * `specs/182-related-payers/` T040 (FR-080, FR-081, SC-010) — the invoice ledger keys an
 * invoice by the Organization billed: the order's payer when it has one, else the buyer.
 */
const X = '00000000-0000-4000-8000-0000000000b1';
const Y = '00000000-0000-4000-8000-0000000000b2';
const INVOICE = '00000000-0000-4000-8000-0000000000c1';
const ORDER = '00000000-0000-4000-8000-0000000000d1';

function host(order: Partial<OrderRecord>) {
  const em = {
    findOne: async () => ({ id: INVOICE, orderId: ORDER, number: 'FV/1', kind: 'invoice', currency: 'PLN', organizationId: null }),
    find: async () => [],
  };
  const orders = { findById: async () => ({ id: ORDER, organizationId: X, ...order }) as OrderRecord } as unknown as OrderReadPort;
  return new InvoiceCopyHostService(() => em as never, orders);
}

describe('InvoiceCopyHostService — the ledger client key', () => {
  it('is the payer for an order with a payer (FR-081)', async () => {
    expect((await host({ payerOrganizationId: Y }).getById(INVOICE))?.organizationId).toBe(Y);
  });

  it('is the buyer for an order without one, as before', async () => {
    expect((await host({ payerOrganizationId: null }).getById(INVOICE))?.organizationId).toBe(X);
    expect((await host({}).getById(INVOICE))?.organizationId).toBe(X);
  });
});
