import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { Order } from './entities/order.entity.js';
import { serializeOrderForAdmin, serializeOrderForCustomer } from './order-response.js';

/**
 * The two audiences of an order reply, without a database. What only this file
 * holds is the fail-closed branch: with the `custom_fields` port not wired, a
 * customer or an external caller is answered no custom-field value at all.
 */
const ADMIN_ID = '00000000-0000-4000-8000-0000000000b1';
const em = { find: async () => [], findOne: async () => null } as unknown as EntityManager;
const order = {
  id: '00000000-0000-4000-8000-000000000001',
  businessId: '1',
  placedOnBehalfByAdminUserId: ADMIN_ID,
  status: 'new',
  customFieldValues: { gift_note: 'shown', internal_note: 'call first' },
  deliveryMethodSnapshot: { code: 'dm', name: 'DM', cost: 0 },
  paymentMethodSnapshot: { code: 'pm', name: 'PM', kind: 'bank_transfer' },
  placedAt: new Date('2026-01-01T00:00:00Z'),
} as unknown as Order;

describe('serializeOrderForCustomer', () => {
  it('answers no custom-field value when no port is wired', async () => {
    const reply = await serializeOrderForCustomer(em, order, undefined);
    expect(reply.customFieldValues).toEqual({});
  });

  it('answers what the port says a customer may read, asked about an order', async () => {
    const asked: string[] = [];
    const reply = await serializeOrderForCustomer(em, order, {
      projectForCustomer: async (entityType, bag) => {
        asked.push(entityType);
        return { gift_note: bag.gift_note };
      },
    });
    expect(asked).toEqual(['order']);
    expect(reply.customFieldValues).toEqual({ gift_note: 'shown' });
  });

  it('says the order was placed on the customer\'s behalf and does not name the administrator', async () => {
    const reply = await serializeOrderForCustomer(em, order, undefined);
    expect(reply.placedOnBehalf).toBe(true);
    expect(reply).not.toHaveProperty('placedOnBehalfByAdminUserId');
    expect(JSON.stringify(reply)).not.toContain(ADMIN_ID);
  });
});

describe('serializeOrderForAdmin', () => {
  it('answers every stored value and the administrator', async () => {
    const reply = await serializeOrderForAdmin(em, order);
    expect(reply.customFieldValues).toEqual(order.customFieldValues);
    expect(reply.placedOnBehalfByAdminUserId).toBe(ADMIN_ID);
  });
});
