import { describe, expect, it } from 'vitest';
import { formatInvoiceNumber } from '../../../src/modules/invoices/services/invoice-number-generator.js';

/**
 * D-95.3 move 1 — `{channel}` renders the sales channel's code, uppercased and
 * otherwise verbatim, and `channel` is a **required** member of the render
 * context. An optional discriminator defaulting to `''` makes every channel
 * render identically again, which is the defect this feature exists to remove.
 */

const date = new Date('2026-05-04T10:00:00.000Z');

describe('formatInvoiceNumber — {channel}', () => {
  it('renders the shipped default with the channel discriminator', () => {
    expect(
      formatInvoiceNumber('FV {seq}/{channel}/{YYYY}', { seq: 1, date, channel: 'B2B' }),
    ).toBe('FV 1/B2B/2026');
  });

  it('ignores the discriminator when the pattern does not name it', () => {
    expect(formatInvoiceNumber('FV {seq}/{YYYY}', { seq: 1, date, channel: 'B2B' })).toBe(
      'FV 1/2026',
    );
  });

  it('keeps every character of the code, uppercased', () => {
    expect(
      formatInvoiceNumber('FV {seq}/{channel}/{YYYY}', { seq: 2, date, channel: 'B2B-PL' }),
    ).toBe('FV 2/B2B-PL/2026');
  });
});
