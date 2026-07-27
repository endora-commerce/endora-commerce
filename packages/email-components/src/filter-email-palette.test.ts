import { describe, expect, it } from 'vitest';
import { defaultEmailBuilderConfig, filterEmailPaletteByVariables } from './config.js';

describe('filterEmailPaletteByVariables', () => {
  it('removes order blocks from components and categories when order vars are missing', () => {
    const filtered = filterEmailPaletteByVariables(defaultEmailBuilderConfig, [
      'customer.email',
      'verifyUrl',
    ]);
    expect(filtered.components?.['EmailOrderSummary']).toBeUndefined();
    expect(filtered.components?.['EmailOrderId']).toBeUndefined();
    expect(filtered.categories?.['order']).toBeUndefined();
    expect(filtered.components?.['EmailText']).toBeDefined();
  });

  it('keeps order blocks when required variables are present', () => {
    const filtered = filterEmailPaletteByVariables(defaultEmailBuilderConfig, [
      'order.items',
      'order.businessId',
      'order.billingAddressText',
      'order.shippingAddressText',
      'order.summaryText',
      'order.discountsText',
      'order.shippingLine',
      'order.paymentLine',
    ]);
    expect(filtered.components?.['EmailOrderSummary']).toBeDefined();
    expect(filtered.categories?.['order']?.components).toContain('EmailOrderSummary');
  });
});
