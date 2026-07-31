import { describe, expect, it } from 'vitest';
import { orderSummaryColumnLabels, orderTotalsLabels, sampleOrderSummaryText } from './order-labels.js';

describe('order-labels', () => {
  it('returns English totals by default', () => {
    expect(orderTotalsLabels('en-US').subtotal).toBe('Subtotal');
    expect(orderTotalsLabels(undefined).tax).toBe('Tax');
  });

  it('returns Polish totals for pl locales', () => {
    expect(orderTotalsLabels('pl-PL')).toMatchObject({
      subtotal: 'Suma częściowa',
      tax: 'VAT',
      delivery: 'Dostawa',
      total: 'Razem',
      none: 'brak',
    });
  });

  it('localizes order summary column headers', () => {
    expect(orderSummaryColumnLabels('pl-PL').item).toBe('Produkt');
    expect(orderSummaryColumnLabels('en-US').qty).toBe('Qty');
  });

  it('builds a sample summary in the requested language', () => {
    expect(sampleOrderSummaryText('pl-PL')).toContain('Suma częściowa:');
    expect(sampleOrderSummaryText('en-US')).toContain('Subtotal:');
  });
});
