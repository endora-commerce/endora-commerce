import { describe, expect, it } from 'vitest';
import { rfqStatusSchema } from '@endora-commerce/contracts';
import { orderStatusName, quoteRequestStatusLabels } from './labels.js';

/**
 * Issues #1434, #1476 — the customer detail's enum labels. That every key is in
 * both shipped bundles is held by
 * `admin/test/modules/customers/history-panels-labels.test.tsx`.
 */
describe('customer detail enum labels', () => {
  it('declares every published quote request status', () => {
    expect([...quoteRequestStatusLabels.values].sort()).toEqual([...rfqStatusSchema.options].sort());
  });

  it("names an order status in the reader's language, then a regional variant, then any name, then the code", () => {
    expect(orderStatusName({ status: 'new', statusName: { en: 'New', pl: 'Nowe' } }, 'pl')).toBe('Nowe');
    expect(orderStatusName({ status: 'new', statusName: { 'pl-PL': 'Nowe' } }, 'pl')).toBe('Nowe');
    expect(orderStatusName({ status: 'new', statusName: { en: 'New' } }, 'pl')).toBe('New');
    expect(orderStatusName({ status: 'new', statusName: {} }, 'pl')).toBe('new');
    expect(orderStatusName({ status: 'new' }, 'pl')).toBe('new');
  });
});
