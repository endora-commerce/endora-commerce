import { describe, expect, it } from 'vitest';
import { formatInvoiceNumber } from '../../../../packages/modules/invoices/src/backend/services/invoice-number-generator.js';

const date = new Date('2026-05-04T10:00:00.000Z');

describe('formatInvoiceNumber', () => {
  it('renders the default pattern FV {seq}/{YYYY}', () => {
    expect(formatInvoiceNumber('FV {seq}/{YYYY}', { seq: 26, date, channel: 'B2B' })).toBe('FV 26/2026');
  });

  it('zero-pads with {seq:N}', () => {
    expect(formatInvoiceNumber('INV-{seq:5}', { seq: 7, date, channel: 'B2B' })).toBe('INV-00007');
  });

  it('supports {YY} and {MM} tokens', () => {
    expect(formatInvoiceNumber('{YY}/{MM}/{seq}', { seq: 3, date, channel: 'B2B' })).toBe('26/05/3');
  });

  it('treats non-token text as literal prefix/suffix', () => {
    expect(formatInvoiceNumber('PRE {seq} SUF', { seq: 1, date, channel: 'B2B' })).toBe('PRE 1 SUF');
  });

  it('handles a pattern with no seq token (degenerate but valid)', () => {
    expect(formatInvoiceNumber('{YYYY}', { seq: 9, date, channel: 'B2B' })).toBe('2026');
  });
});
