import { describe, expect, it } from 'vitest';
import type { Config } from '@measured/puck';
import { defaultEmailBuilderConfig, filterEmailPaletteByVariables } from './config.js';

/**
 * Feature 096, T302 — the config this filter runs over no longer carries a
 * `categories` map of its own: sections are declared by their owning modules
 * and merged by the server. The filter still has to prune both halves of
 * whatever config it is handed, or a hidden block stays reachable through its
 * section and Puck dumps the rest into *Other*. So the sections are supplied
 * here, in the shape the derived palette produces.
 */
const ORDER_SECTION: Config['categories'] = {
  order: {
    title: 'Order',
    components: ['orders.EmailOrderSummary', 'orders.EmailOrderId'],
  },
  content: { title: 'Content', components: ['transactional_emails.EmailText'] },
};

const sectioned: Config = { ...defaultEmailBuilderConfig, categories: ORDER_SECTION };

describe('filterEmailPaletteByVariables', () => {
  it('removes order blocks from components and categories when order vars are missing', () => {
    const filtered = filterEmailPaletteByVariables(sectioned, ['customer.email', 'verifyUrl']);
    expect(filtered.components?.['orders.EmailOrderSummary']).toBeUndefined();
    expect(filtered.components?.['orders.EmailOrderId']).toBeUndefined();
    expect(filtered.categories?.['order']).toBeUndefined();
    expect(filtered.components?.['transactional_emails.EmailText']).toBeDefined();
  });

  it('keeps order blocks when required variables are present', () => {
    const filtered = filterEmailPaletteByVariables(sectioned, [
      'order.items',
      'order.businessId',
      'order.billingAddressText',
      'order.shippingAddressText',
      'order.summaryText',
      'order.discountsText',
      'order.shippingLine',
      'order.paymentLine',
    ]);
    expect(filtered.components?.['orders.EmailOrderSummary']).toBeDefined();
    expect(filtered.categories?.['order']?.components).toContain('orders.EmailOrderSummary');
  });
});
