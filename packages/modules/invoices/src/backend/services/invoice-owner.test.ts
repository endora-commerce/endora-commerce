import { describe, expect, it } from 'vitest';
import { invoiceOwnerOrganizationId } from './invoice-owner.js';

/**
 * `specs/182-related-payers/` T040 (FR-080, RP-8) — the one expression the ledger key, the
 * admin list's reach and its organization filter share: who an invoice belongs to.
 */
describe('invoiceOwnerOrganizationId', () => {
  it('is the payer of a paid order, the buyer otherwise, and the stored organization for an ERP row', () => {
    expect(invoiceOwnerOrganizationId({ origin: 'platform', organizationId: null }, { organizationId: 'x', payerOrganizationId: 'y' })).toBe('y');
    expect(invoiceOwnerOrganizationId({ origin: 'platform', organizationId: null }, { organizationId: 'x', payerOrganizationId: null })).toBe('x');
    expect(invoiceOwnerOrganizationId({ origin: 'erp_import', organizationId: 'e' }, null)).toBe('e');
    expect(invoiceOwnerOrganizationId({ origin: 'platform', organizationId: null }, null)).toBe('');
  });
});
