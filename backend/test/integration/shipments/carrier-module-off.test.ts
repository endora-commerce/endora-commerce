import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ShippingAdapter } from '@endora-commerce/contracts';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withModuleOff } from '../../helpers/off-state.js';
import { registryCache } from '../../../src/kernel/lifecycle/registry-cache.js';
import type { DeliveryMethodsCradle } from '../../../../packages/modules/delivery_methods/src/backend/index.js';
import { AuditLogEntry } from '../../../src/kernel/audit/audit-log-entry.entity.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { carrierNotContactedReason } from '../../../../packages/modules/shipments/src/backend/services/shipment-service.js';
import { DeliveryMethod } from '../../helpers/package-entities.js';

/**
 * Issue #250 — the off-state test Principle XVII item 6 requires for the
 * shipment-generation path, end to end through the composed HTTP surface.
 *
 * **Why a synthetic module.** The state under test is "the module that
 * contributed this adapter is not present", and the only shipping adapters
 * this repository ships are `delivery_methods`' own two offline ones. With
 * `delivery_methods` off the operation never reaches the registry at all —
 * `deliveryMethodReadPort` is a gated port and refuses first, which is the
 * right answer and a different one. So the test contributes a carrier adapter
 * the way `docs/docs/modules/delivery_methods.md` tells a carrier module to,
 * names itself as its owner, and drives *that* module's operator axis. The
 * registry, the presence probe, the service, the routes and the serializer are
 * all the real ones.
 *
 * Both halves are asserted, in order: the carrier is asked while its module is
 * on, is never asked while it is off — and is asked again the moment it comes
 * back, which is the restoration half Principle XVII item 6 calls for and the
 * half a test of the off state alone cannot see.
 */

const ADMIN_COOKIE = { b2b_session: 'stub-admin-session' };
const CARRIER_MODULE = 'demo_carrier';
const CARRIER_ADAPTER_KEY = 'demo_carrier_express';

interface ShipmentPayload {
  id: string;
  status: string;
  failureReason: string | null;
  attemptNo: number;
}

/** Every call the carrier received, in order. */
const asked: string[] = [];

const carrierAdapter: ShippingAdapter = {
  adapterKey: CARRIER_ADAPTER_KEY,
  validateUseOnStorefront: async () => true,
  validateUseOnAdmin: async () => true,
  validateUseInApi: async () => true,
  onOrderCreated: async () => {},
  onShipmentCreated: async (ctx) => {
    asked.push(ctx.shipmentId);
    return { kind: 'pending' };
  },
  onReceiveShipment: async () => ({ result: 'success' }),
};

async function seedOrder(em: EntityManager): Promise<Order> {
  const method = em.create(DeliveryMethod, {
    code: `dc_${randomUUID().slice(0, 8)}`,
    name: { default: 'Demo carrier' },
    adapter: CARRIER_ADAPTER_KEY,
    cost: '15.00',
    currency: 'PLN',
    status: 'active',
    statusOnSuccess: 'shipment_sent',
    statusOnFailure: 'processing',
  });
  await em.persistAndFlush(method);

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
    deliveryMethodSnapshot: { code: method.code, name: 'Demo carrier', cost: 15 },
    paymentMethodId: randomUUID(),
    paymentMethodSnapshot: { code: 'bt', name: 'BT', kind: 'bank_transfer' },
    status: 'paid',
    subtotal: '100.00',
    taxTotal: '23.00',
    deliveryTotal: '15.00',
    total: '138.00',
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persistAndFlush(order);
  return order;
}

describe('shipments — generating a shipment while the carrier module is off (#250)', () => {
  let h: BackendServerHandle;
  let baseline: readonly string[];
  /** The one the platform composed — see the note in `beforeAll`. */
  let shippingAdapterRegistry: DeliveryMethodsCradle['shippingAdapterRegistry'];

  const generate = async (orderId: string): Promise<ShipmentPayload> => {
    const res = await h.app.inject({
      method: 'POST',
      url: `/api/v1/admin/orders/${orderId}/shipments`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(201);
    return (res.json() as { data: ShipmentPayload }).data;
  };

  beforeAll(async () => {
    h = await setupBackendServer();
    // **The registry comes from the container, not from an import** (D-160.6,
    // T061). `delivery_methods` is a module package since T040b's second batch,
    // so the platform resolves it at `dist` while a relative specifier into the
    // package's `src` builds a *second* `ShippingAdapterRegistry` — module-scope
    // state, one process, two copies. Registering the carrier into the wrong one
    // is silent: the adapter is simply never found, the first `generate` returns
    // `pending` without asking anybody, and the off-state assertion below reads
    // `pending` where it should read `pending_manual` — a switched-off module
    // looking present, which is the one thing this file exists to refuse.
    //
    // A duplicated **entity** fails as an ORM lookup miss; a duplicated
    // module-scope **value** fails as an empty table, which is why this is
    // resolved rather than imported.
    shippingAdapterRegistry = (h.container.cradle as unknown as DeliveryMethodsCradle)
      .shippingAdapterRegistry;
    shippingAdapterRegistry.register(carrierAdapter, CARRIER_MODULE);
    baseline = registryCache.enabledIds();
    // The carrier module is installed and switched on, exactly as a deployment
    // that installed it would have it.
    registryCache.__setEnabledForTesting([...baseline, CARRIER_MODULE]);
  });

  afterAll(async () => {
    registryCache.__setEnabledForTesting(baseline);
    shippingAdapterRegistry.unregister(CARRIER_ADAPTER_KEY);
    await teardownBackendServer(h);
  });

  it('opens pending_manual naming the module while it is off, and pending again once it is back', async () => {
    const order = await seedOrder(h.em());

    const askedBefore = asked.length;
    const first = await generate(order.id);
    expect(first.status).toBe('pending');
    expect(first.failureReason).toBeNull();
    expect(asked).toHaveLength(askedBefore + 1);

    const whileOff = await withModuleOff(CARRIER_MODULE, 'deactivated', async () =>
      generate(order.id),
    );

    expect(whileOff.status).toBe('pending_manual');
    expect(whileOff.attemptNo).toBe(2);
    expect(whileOff.failureReason).toBe(carrierNotContactedReason(CARRIER_MODULE));
    // No request left the platform: the adapter was never invoked.
    expect(asked).toHaveLength(askedBefore + 1);

    // Restoration — the operator switches the module back on and generates the
    // shipment again. Nothing else has to happen for the carrier to be asked.
    const afterRestore = await generate(order.id);
    expect(afterRestore.status).toBe('pending');
    expect(afterRestore.failureReason).toBeNull();
    expect(afterRestore.attemptNo).toBe(3);
    expect(asked).toHaveLength(askedBefore + 2);
  });

  it('shows the state and its reason on the order shipment history', async () => {
    const order = await seedOrder(h.em());
    await withModuleOff(CARRIER_MODULE, 'deactivated', async () => generate(order.id));

    const res = await h.app.inject({
      method: 'GET',
      url: `/api/v1/admin/orders/${order.id}/shipments`,
      cookies: ADMIN_COOKIE,
    });
    expect(res.statusCode).toBe(200);
    const rows = (res.json() as { data: ShipmentPayload[] }).data;
    expect(rows).toHaveLength(1);
    expect(rows[0]!.status).toBe('pending_manual');
    expect(rows[0]!.failureReason).toContain(CARRIER_MODULE);
  });

  it('records the attempt in the audit log, co-transactionally with the row', async () => {
    const order = await seedOrder(h.em());
    const shipment = await withModuleOff(CARRIER_MODULE, 'deactivated', async () =>
      generate(order.id),
    );

    const entries = await h
      .em()
      .find(AuditLogEntry, { objectType: 'shipment', objectId: shipment.id });
    expect(entries).toHaveLength(1);
    expect(entries[0]!.action).toBe('shipment.carrier_not_contacted');
    expect(entries[0]!.stateAfter).toMatchObject({
      absentModule: CARRIER_MODULE,
      status: 'pending_manual',
    });
  });
});
