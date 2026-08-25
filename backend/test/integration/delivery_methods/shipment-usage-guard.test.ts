import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { DeliveryMethod, Shipment, type DeliveryMethodRow } from '../../helpers/package-entities.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';

/**
 * Feature 075, the `delivery_methods` shard — the FR-003 delete guard, through
 * the composed HTTP surface, once the count comes from the module that owns the
 * rows.
 *
 * The guard was a `select count(*) from "shipments"` written inside this
 * module's own delete Command: a read of another module's table that names no
 * import specifier, so it compiled and returned rows with nothing declaring the
 * edge. It is `shipmentUsagePort` now, and this file is the off-state test the
 * `nonBindingDependencies` entry owes — the third case, which no unit test can
 * reach and which is the whole reason the degrade is a refusal:
 *
 *  1. a method a shipment references cannot be deleted;
 *  2. a method nothing references can;
 *  3. **with `shipments` switched off, neither can** — because nobody can count,
 *     `shipments.delivery_method_id` carries no foreign key, and a delete taken
 *     blind orphans history that comes back the moment the module does.
 *
 * The operator axis is the one driven: it is the case an operator actually
 * creates, and it is the one where the platform still holds every shipment row
 * the guard is protecting.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };

describe('delivery-method delete guard — the count comes from `shipments`', () => {
  let h: BackendServerHandle;

  beforeAll(async () => {
    h = await setupBackendServer();
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function seedMethod(): Promise<DeliveryMethodRow> {
    const em = h.em();
    const method = em.create(DeliveryMethod, {
      code: `guard_${randomUUID().slice(0, 8)}`,
      name: { default: 'Guarded method' },
      adapter: 'flat_rate',
      cost: '9.00',
      currency: 'PLN',
      status: 'active',
      statusOnSuccess: 'shipment_sent',
      statusOnFailure: 'processing',
    });
    await em.persistAndFlush(method);
    return method;
  }

  async function methodStillThere(id: string): Promise<boolean> {
    return (await h.em().findOne(DeliveryMethod, { id })) !== null;
  }

  /** `shipments.order_id` is a real foreign key, so the row needs a real order. */
  async function seedShipment(method: DeliveryMethodRow): Promise<void> {
    const em = h.em();
    const order = em.create(Order, {
      organizationId: randomUUID(),
      placedByCustomerAccountId: randomUUID(),
      salesChannelId: randomUUID(),
      deliveryAddress: {
        recipientName: 'A',
        street: 'S',
        city: 'C',
        postalCode: '00-000',
        country: 'PL',
      },
      billingAddress: {
        recipientName: 'A',
        street: 'S',
        city: 'C',
        postalCode: '00-000',
        country: 'PL',
      },
      deliveryMethodId: method.id,
      deliveryMethodSnapshot: { code: method.code, name: 'Guarded method', cost: 9 },
      paymentMethodId: randomUUID(),
      paymentMethodSnapshot: { code: 'bt', name: 'BT', kind: 'bank_transfer' },
      status: 'paid',
      subtotal: '100.00',
      taxTotal: '23.00',
      deliveryTotal: '9.00',
      total: '132.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    await em.persistAndFlush(
      em.create(Shipment, { orderId: order.id, deliveryMethodId: method.id }),
    );
  }

  it('refuses the delete while a shipment references the method, and names the count', async () => {
    const method = await seedMethod();
    await seedShipment(method);

    const response = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/delivery-methods/${method.id}`,
      cookies: ADMIN_COOKIE,
    });

    expect(response.statusCode).toBe(409);
    expect(response.json().error.message).toContain('1 shipment(s)');
    expect(await methodStillThere(method.id)).toBe(true);
  });

  it('deletes a method no shipment references', async () => {
    const method = await seedMethod();

    const response = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/delivery-methods/${method.id}`,
      cookies: ADMIN_COOKIE,
    });

    expect(response.statusCode).toBe(204);
    expect(await methodStillThere(method.id)).toBe(false);
  });

  it('refuses the delete while `shipments` is off, and allows it again once restored', async () => {
    const method = await seedMethod();

    await withModuleOff('shipments', 'deactivated', async () => {
      const response = await h.app.inject({
        method: 'DELETE',
        url: `/api/v1/admin/delivery-methods/${method.id}`,
        cookies: ADMIN_COOKIE,
      });

      // Refused by this module's own decision, taken before the port is
      // resolved — not a `MODULE_DISABLED` envelope a caught gate produced.
      expect(response.statusCode).toBe(409);
      expect(response.json().error.message).toContain('shipments');
      expect(await methodStillThere(method.id)).toBe(true);
    });

    // The restoration half: the method was never touched while the module was
    // off, so the delete that was refused now succeeds unchanged.
    const restored = await h.app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/delivery-methods/${method.id}`,
      cookies: ADMIN_COOKIE,
    });
    expect(restored.statusCode).toBe(204);
    expect(await methodStillThere(method.id)).toBe(false);
  });
});
