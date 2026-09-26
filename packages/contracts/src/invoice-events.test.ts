import { describe, expect, it } from 'vitest';
import * as invoices from './invoices.js';
import * as ksef from './ksef.js';

/**
 * `specs/134-paid-module-extraction/` T062 (FR-024, `research.md` §C.4).
 *
 * `invoice.issued.v1` and `invoice.corrected.v1` are raised by `invoices`, and
 * their payload schemas are therefore `invoices`' contract. They used to be
 * declared in the KSeF vendor file, which made a free consumer
 * (`invoice_ledger`) read a vendor's contract to understand a free module's
 * own events — and would have taken them out of this package with that file.
 *
 * The negative half is the point: a schema re-exported from both files would
 * pass the positive assertions and leave the misfiling in place.
 */
describe('invoices owns its domain event payloads', () => {
  it('declares both schemas in the invoices contract', () => {
    expect(invoices.invoiceIssuedEventSchema).toBeDefined();
    expect(invoices.invoiceCorrectedEventSchema).toBeDefined();
  });

  it('no longer declares them in the KSeF contract', () => {
    expect(Object.keys(ksef)).not.toContain('invoiceIssuedEventSchema');
    expect(Object.keys(ksef)).not.toContain('invoiceCorrectedEventSchema');
  });

  it('parses the payload invoices emits for an issued invoice', () => {
    const payload = {
      eventId: '1d7a1b0e-6c51-4c3e-9d8b-3d2b1e2f0a11',
      occurredAt: '2026-09-26T10:00:00.000Z',
      invoiceId: '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01',
      orderId: '6a3b1e9d-0c1f-4a8e-9a2d-4b7f0c5d2e02',
      kind: 'invoice' as const,
      salesChannelId: null,
    };
    expect(invoices.invoiceIssuedEventSchema.parse(payload)).toMatchObject({
      invoiceId: payload.invoiceId,
      kind: 'invoice',
      salesChannelId: null,
    });
  });

  it('parses the payload invoices emits for a correction', () => {
    const payload = {
      invoiceId: '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01',
      originalInvoiceId: '9c2d4e6f-1a3b-4c5d-8e7f-0a1b2c3d4e05',
      orderId: '6a3b1e9d-0c1f-4a8e-9a2d-4b7f0c5d2e02',
      salesChannelId: '2f4e6a8c-0b1d-4e3f-9a5b-7c9d1e3f5a07',
    };
    expect(invoices.invoiceCorrectedEventSchema.parse(payload)).toEqual(payload);
  });

  it('refuses a correction with no order', () => {
    expect(
      invoices.invoiceCorrectedEventSchema.safeParse({
        invoiceId: '0b8f5f0e-2a0e-4f55-8a53-0f3f7cbe0a01',
        originalInvoiceId: null,
        salesChannelId: null,
      }).success,
    ).toBe(false);
  });
});
