import { describe, expect, it } from 'vitest';
import { contributions } from './index.js';

describe('invoice_ledger admin contributions', () => {
  it('contributes the historical remote id to invoice detail', () => {
    const zones = contributions.zones ?? [];
    expect(zones.some((entry) => entry.zone === 'invoice.detail.after')).toBe(true);
  });
});
