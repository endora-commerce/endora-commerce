import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ERROR_CODES } from '@endora-commerce/contracts';
import { AuditLogEntry } from '@endora-commerce/platform/kernel';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { systemDefaultSalesChannelId } from '../../helpers/sales-channel-fixtures.js';
import { SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { SEED_PRODUCT_101_ID } from '../../helpers/seed-catalog.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';

/**
 * Feature 175 (`specs/175-buyer-input-custom-fields/` US4, FR-015, FR-017,
 * FR-021, contracts/registration-and-admin-create.md §5) — the admin order
 * create accepts the order's custom-field values: validated with the
 * administrator's rules before anything is written, stored on the new order by
 * the placement, carried by the placement's audit row, and a refused value
 * creates no order.
 */
const ADMIN = { cookies: { b2b_session: 'stub-admin-session' } };
const DEFINITIONS_URL = '/api/v1/admin/custom-fields/definitions';
const DELIVERY_ADDRESS_ID = '00000000-0000-4000-8000-0000000000d1';
const BILLING_ADDRESS_ID = '00000000-0000-4000-8000-0000000000d2';
const DELIVERY_METHOD_ID = '00000000-0000-4000-8000-0000000000e1';

describe('POST /api/v1/admin/orders — custom-field values (feature 175)', () => {
  let h: BackendServerHandle;
  let channelId: string;
  const created: string[] = [];
  const stamp = randomUUID().replace(/-/g, '').slice(0, 6);
  const key = (name: string): string => `cf175o_${name}_${stamp}`;

  beforeAll(async () => {
    h = await setupBackendServer();
    channelId = await systemDefaultSalesChannelId(h.em());
    await define({ key: key('ref'), labelDefault: 'Internal reference', audience: 'internal' });
    await define({ key: key('pallets'), labelDefault: 'Pallets', valueType: 'number' });
  });

  afterAll(async () => {
    for (const id of created) {
      await h.app.inject({ method: 'DELETE', url: `${DEFINITIONS_URL}/${id}`, ...ADMIN });
    }
    await teardownBackendServer(h);
  });

  async function define(payload: Record<string, unknown>): Promise<string> {
    const res = await h.app.inject({
      method: 'POST',
      url: DEFINITIONS_URL,
      ...ADMIN,
      payload: {
        entityType: 'order',
        label: {},
        valueType: 'text',
        required: false,
        audience: 'customer',
        sortOrder: 0,
        config: {},
        carryTo: [],
        options: [],
        ...payload,
      },
    });
    expect(res.statusCode, res.body).toBe(201);
    const id = (res.json().data as { id: string }).id;
    created.push(id);
    return id;
  }

  async function undefine(id: string): Promise<void> {
    await h.app.inject({ method: 'DELETE', url: `${DEFINITIONS_URL}/${id}`, ...ADMIN });
    created.splice(created.indexOf(id), 1);
  }

  function createOrder(extra: Record<string, unknown> = {}) {
    return h.app.inject({
      method: 'POST',
      url: '/api/v1/admin/orders',
      ...ADMIN,
      payload: {
        customerAccountId: TEST_CUSTOMER_ID,
        salesChannelId: channelId,
        items: [{ productId: SEED_PRODUCT_101_ID, quantity: 1 }],
        deliveryMethodId: DELIVERY_METHOD_ID,
        paymentMethodId: SEED_PAYMENT_METHOD_ID,
        deliveryAddressId: DELIVERY_ADDRESS_ID,
        billingAddressId: BILLING_ADDRESS_ID,
        ...extra,
      },
    });
  }

  const orderCount = async (): Promise<number> => {
    const [row] = await h.em().getKnex()('orders').where({ organization_id: TEST_ORGANIZATION_ID }).count({ n: '*' });
    return Number(row?.n);
  };

  it('stores the values, answers them and carries them in the audit row', async () => {
    const values = { [key('ref')]: 'PO-17', [key('pallets')]: 3 };
    const res = await createOrder({ customFieldValues: values });
    expect(res.statusCode, res.body).toBe(201);
    const order = res.json().data as { id: string; customFieldValues: Record<string, unknown> };
    expect(order.customFieldValues).toEqual(values);

    const row = await h.em().getKnex()('orders').where({ id: order.id }).first('custom_field_values');
    expect(row.custom_field_values).toEqual(values);

    h.em().clear();
    const [entry] = await h.em().find(AuditLogEntry, { action: 'order.place_on_behalf', objectId: order.id });
    expect(entry?.stateAfter).toMatchObject({ customFieldValues: values });
  });

  it('refuses an invalid value with the per-field 422 and creates no order', async () => {
    const before = await orderCount();
    const res = await createOrder({ customFieldValues: { [key('pallets')]: 'many' } });
    expect(res.statusCode, res.body).toBe(422);
    const body = res.json() as { error: { code: string; details: Array<{ path: string }> } };
    expect(body.error.code).toBe(ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID);
    expect(body.error.details.map((d) => d.path)).toContain(key('pallets'));
    expect(await orderCount()).toBe(before);
  });

  it('refuses a missing required field — also when no values are sent — and creates no order', async () => {
    const id = await define({ key: key('required'), labelDefault: 'Cost centre', required: true, audience: 'internal' });
    try {
      const before = await orderCount();
      const res = await createOrder({ customFieldValues: { [key('ref')]: 'x' } });
      expect(res.statusCode, res.body).toBe(422);
      const body = res.json() as { error: { code: string; details: Array<{ path: string }> } };
      expect(body.error.code).toBe(ERROR_CODES.CUSTOM_FIELD_VALUE_INVALID);
      expect(body.error.details.map((d) => d.path)).toContain(key('required'));

      const bare = await createOrder();
      expect(bare.statusCode, bare.body).toBe(422);
      expect(await orderCount()).toBe(before);
    } finally {
      await undefine(id);
    }
  });
});
