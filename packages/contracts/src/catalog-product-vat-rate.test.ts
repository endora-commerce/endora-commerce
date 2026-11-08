import { describe, expect, it } from 'vitest';
import { productDetailSchema, productSummarySchema } from './catalog.js';

/**
 * Issue #852 — a catalogue product carries the VAT rate the buyer is charged
 * for it, so the storefront derives its gross from that rate and not from a
 * flat 23 %. Additive: a reply without it parses as before, and the storefront
 * reads its absence as "no rate", showing the net.
 */

const SUMMARY = {
  id: '11111111-2222-4333-8444-555555555555',
  sku: 'VAT-852',
  type: 'simple',
  name: 'Reduced-rate product',
  slug: 'reduced-rate-product',
  categorySlugs: [],
  primaryAssetUrl: null,
  price: { amount: 100, currency: 'PLN' },
  stockIndicator: null,
  stockLevel: null,
} as const;

describe('ProductSummary.vatRate (issue #852)', () => {
  it('carries a fraction', () => {
    expect(productSummarySchema.parse({ ...SUMMARY, vatRate: 0.08 }).vatRate).toBe(0.08);
  });

  it('carries 0 for an exempt or reverse-charge buyer', () => {
    expect(productSummarySchema.parse({ ...SUMMARY, vatRate: 0 }).vatRate).toBe(0);
  });

  it('carries null where the resolution failed', () => {
    expect(productSummarySchema.parse({ ...SUMMARY, vatRate: null }).vatRate).toBeNull();
  });

  it('parses a reply without it, as an older backend sends', () => {
    expect(productSummarySchema.parse(SUMMARY).vatRate).toBeUndefined();
  });

  it('refuses a negative rate', () => {
    expect(productSummarySchema.safeParse({ ...SUMMARY, vatRate: -0.01 }).success).toBe(false);
  });

  it('is on the product detail too', () => {
    expect(productDetailSchema.shape.vatRate).toBeDefined();
  });
});
