import { describe, expect, it } from 'vitest';
import { buildSampleVariableContext, DEFAULT_ORDER_ITEMS_SAMPLE } from './sample-variables.js';

describe('buildSampleVariableContext', () => {
  it('nests dotted keys and parses JSON samples', () => {
    const ctx = buildSampleVariableContext([
      { key: 'customer.firstName', sampleValue: 'Ada' },
      {
        key: 'order.items',
        sampleValue: JSON.stringify(DEFAULT_ORDER_ITEMS_SAMPLE),
      },
    ]);
    expect(ctx).toEqual({
      customer: { firstName: 'Ada' },
      order: { items: DEFAULT_ORDER_ITEMS_SAMPLE },
    });
  });
});
