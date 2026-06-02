import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { Address } from '../../../src/modules/addresses/entities/address.entity.js';

const SALES_CHANNEL_ID = '00000000-0000-4000-8000-0000000000c1';

interface OrderBody {
  data: {
    id: string;
    deliveryAddress: { recipientName: string; street: string; city: string };
    billingAddress: { recipientName: string };
  };
}

/**
 * Feature 038 (US3) — the sales rep can type a brand-new address inline. The
 * address is always snapshotted onto the order; the `saveToAddressBook` flag
 * controls whether it also persists to the org address book for reuse.
 */
describe('Admin create order with inline addresses (US3)', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });
  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('saves a new address when flagged, and keeps a non-saved one off the book', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: SALES_CHANNEL_ID,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        deliveryAddress: {
          recipientName: 'Transient Tina',
          street: 'One-Time St 1',
          city: 'Warsaw',
          postalCode: '00-001',
          country: 'PL',
          saveToAddressBook: false,
        },
        billingAddress: {
          recipientName: 'Saved Sam',
          street: 'Keep Ave 2',
          city: 'Krakow',
          postalCode: '30-002',
          country: 'PL',
          saveToAddressBook: true,
        },
      },
    });
    expect(res.statusCode).toBe(201);
    const { data } = res.json() as OrderBody;

    // The order keeps a standalone snapshot of BOTH typed addresses.
    expect(data.deliveryAddress.recipientName).toBe('Transient Tina');
    expect(data.deliveryAddress.street).toBe('One-Time St 1');
    expect(data.billingAddress.recipientName).toBe('Saved Sam');

    // The saved (billing) address remains in the org book; the one-time
    // (delivery) address was soft-deleted and no longer appears.
    const live = await h
      .em()
      .find(Address, { organizationId: TEST_ORGANIZATION_ID, deletedAt: null });
    const recipients = live.map((a) => a.recipientName);
    expect(recipients).toContain('Saved Sam');
    expect(recipients).not.toContain('Transient Tina');
  });

  it('rejects supplying both an id and an inline address for the same side', async () => {
    const res = await h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders',
      cookies: { b2b_session: 'stub-admin-session' },
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: SALES_CHANNEL_ID,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
        deliveryMethodId: SEED_DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        deliveryAddressId: '00000000-0000-4000-8000-0000000000d1',
        deliveryAddress: {
          recipientName: 'Both Bob',
          street: 'Conflict Rd 3',
          city: 'Gdansk',
          postalCode: '80-003',
          country: 'PL',
          saveToAddressBook: false,
        },
        billingAddressId: '00000000-0000-4000-8000-0000000000d2',
      },
    });
    expect(res.statusCode).toBe(400);
  });
});
