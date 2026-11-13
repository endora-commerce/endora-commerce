import { describe, expect, it } from 'vitest';
import { invoiceListPath, NO_INVOICE_FILTERS } from './invoice-list-path.js';

/** Issue #1120 — the admin list asks for the next page with the cursor the last one answered. */
describe('invoiceListPath (issue #1120)', () => {
  it('asks for the first page with no query when nothing is filtered', () => {
    expect(invoiceListPath(NO_INVOICE_FILTERS)).toBe('/api/v1/admin/invoices');
  });

  it('carries the filters and, for a later page, the cursor', () => {
    const path = invoiceListPath({ ...NO_INVOICE_FILTERS, kind: 'wz', orderNumber: ' ORD-1 ' }, 'abc_-');
    const query = new URLSearchParams(path.split('?')[1]);
    expect(path.startsWith('/api/v1/admin/invoices?')).toBe(true);
    expect(query.get('filter[kind]')).toBe('wz');
    expect(query.get('filter[orderNumber]')).toBe('ORD-1');
    expect(query.get('cursor')).toBe('abc_-');
  });

  it('bounds an issued-date range to whole days in UTC', () => {
    const query = new URLSearchParams(
      invoiceListPath({ ...NO_INVOICE_FILTERS, issuedFrom: '2026-11-01', issuedTo: '2026-11-13' }).split('?')[1],
    );
    expect(query.get('filter[issuedFrom]')).toBe('2026-11-01T00:00:00.000Z');
    expect(query.get('filter[issuedTo]')).toBe('2026-11-13T23:59:59.999Z');
  });
});
