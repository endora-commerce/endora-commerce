import { describe, expect, it } from 'vitest';
import type { InvoiceLedgerDeliveryListItem } from '@endora-commerce/contracts';
import { mergeLedgerDeliveryPages } from './merge-delivery-pages.js';

function item(id: string): InvoiceLedgerDeliveryListItem {
  return {
    id,
    invoiceId: '11111111-1111-4111-8111-111111111111',
    invoiceNumber: id,
    adapterId: 'infakt',
    status: 'queued',
    lastError: null,
    environment: 'sandbox',
    remoteDocumentId: null,
    updatedAt: '2026-09-08T12:00:00.000Z',
  };
}

describe('mergeLedgerDeliveryPages', () => {
  it('appends unseen ids when the cursor moves', () => {
    const first = [item('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')];
    const second = [item('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')];
    expect(mergeLedgerDeliveryPages(first, second)).toEqual([...first, ...second]);
  });

  it('does not duplicate an id that already landed', () => {
    const first = [item('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')];
    expect(mergeLedgerDeliveryPages(first, first)).toEqual(first);
  });
});
