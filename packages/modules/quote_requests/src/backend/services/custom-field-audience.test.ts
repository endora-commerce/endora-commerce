import { describe, expect, it } from 'vitest';
import { quoteCustomFieldValuesFor } from './rfq-service.js';

/**
 * Which of a quote's custom-field values each reader is answered. The case that
 * matters most is the one nothing else exercises: with the `custom_fields`
 * port not wired, a customer is answered nothing — never the whole bag.
 */
describe('quoteCustomFieldValuesFor', () => {
  const bag = { gift_note: 'shown', internal_note: 'call first' };

  it('answers a customer nothing when no port is wired', async () => {
    expect(await quoteCustomFieldValuesFor(undefined, bag, false)).toEqual({});
  });

  it('answers a customer what the port says they may read', async () => {
    const port = {
      projectForCustomer: async (entityType: string, values: Record<string, unknown>) => ({
        entityType,
        gift_note: values.gift_note,
      }),
    };
    expect(await quoteCustomFieldValuesFor(port, bag, false)).toEqual({
      entityType: 'quote_request',
      gift_note: 'shown',
    });
  });

  it('answers an administrator the whole bag, port or no port', async () => {
    expect(await quoteCustomFieldValuesFor(undefined, bag, true)).toEqual(bag);
  });
});
