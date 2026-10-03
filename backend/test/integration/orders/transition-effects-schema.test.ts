import { randomUUID } from 'crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { withOrgScope } from '../../../src/tenancy/escape-hatch.js';
import { Order, OrderTransitionEffect, Organization } from '../../helpers/package-entities.js';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from '../../helpers/test-actors.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';

/**
 * `order_transition_effects` (`specs/142-order-transition-atomicity/`, data
 * model) — the table that makes "this order still owes a release" a fact in
 * the database rather than a step some request was about to take.
 *
 * Two properties are the schema's own and are asserted against the schema:
 * at most one **outstanding** row per order and effect, and the tenant filter.
 */
describe('order_transition_effects — schema (spec 142, T05)', () => {
  let h: BackendServerHandle;
  let orderId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    orderId = await seedOrder(h.em(), TEST_ORGANIZATION_ID);
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  async function seedOrder(em: EntityManager, organizationId: string): Promise<string> {
    const order = em.create(Order, {
      organizationId,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: '00000000-0000-4000-8000-0000000000c1',
      status: 'cancelled',
      paymentStatus: 'awaiting_payment',
      deliveryAddress: {
        recipientName: 'Stub', street: 'ul. Odbioru 1', city: 'Warszawa',
        postalCode: '00-100', country: 'PL',
      },
      billingAddress: {
        recipientName: 'Stub', street: 'ul. Rozliczeń 2', city: 'Warszawa',
        postalCode: '00-101', country: 'PL',
      },
      deliveryMethodId: SEED_DELIVERY_METHOD_ID,
      deliveryMethodSnapshot: { code: 'in_person_pickup', name: 'Pickup', cost: 0 },
      paymentMethodId: SEED_PAYMENT_METHOD_ID,
      paymentMethodSnapshot: { code: 'bank_transfer', name: 'BT', kind: 'bank_transfer' },
      subtotal: '100.00',
      taxTotal: '23.00',
      deliveryTotal: '0.00',
      total: '123.00',
      currency: 'PLN',
      placedAt: new Date(),
    });
    await em.persistAndFlush(order);
    return order.id;
  }

  const insertEffect = (
    forOrder: string,
    organizationId: string,
    effect: string,
    completed = false,
  ): Promise<unknown> =>
    h.em().getConnection().execute(
      `insert into "order_transition_effects"
         ("id", "organization_id", "order_id", "effect", "reason", "origin",
          "completed_at", "created_at", "updated_at")
       values (?, ?, ?, ?, 'order_cancelled', 'transition', ${completed ? 'now()' : 'null'}, now(), now())`,
      [randomUUID(), organizationId, forOrder, effect],
    );

  it('refuses a second outstanding row for one order and effect', async () => {
    await insertEffect(orderId, TEST_ORGANIZATION_ID, 'stock.release');
    await expect(
      insertEffect(orderId, TEST_ORGANIZATION_ID, 'stock.release'),
    ).rejects.toMatchObject({ code: '23505' });
  });

  it('accepts the other effect for the same order beside it', async () => {
    await expect(
      insertEffect(orderId, TEST_ORGANIZATION_ID, 'credit.release'),
    ).resolves.toBeDefined();
  });

  it('accepts a second row once the first has completed', async () => {
    await h.em().getConnection().execute(
      `update "order_transition_effects" set "completed_at" = now()
        where "order_id" = ? and "effect" = 'stock.release'`,
      [orderId],
    );
    await expect(
      insertEffect(orderId, TEST_ORGANIZATION_ID, 'stock.release'),
    ).resolves.toBeDefined();
  });

  it('refuses an effect, a reason or an origin outside the closed sets', async () => {
    const other = await seedOrder(h.em(), TEST_ORGANIZATION_ID);
    await expect(insertEffect(other, TEST_ORGANIZATION_ID, 'refund.issue')).rejects.toMatchObject({
      code: '23514',
    });
  });

  it('refuses a row for an order that does not exist', async () => {
    await expect(
      insertEffect(randomUUID(), TEST_ORGANIZATION_ID, 'stock.release'),
    ).rejects.toMatchObject({ code: '23503' });
  });

  it('is tenant-filtered: one organization never reads another`s rows', async () => {
    const em = h.em();
    const stranger = em.create(Organization, {
      name: 'Spec 142 stranger',
      taxId: `PL142${Date.now().toString().slice(-7)}`,
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: {
        street: 'ul. Obca 1', city: 'Warszawa', postalCode: '00-100', country: 'PL',
      },
    });
    await em.persistAndFlush(stranger);
    const strangerOrder = await seedOrder(h.em(), stranger.id);
    await insertEffect(strangerOrder, stranger.id, 'stock.release');

    const emFactory = h.container.resolve('emFactory') as () => EntityManager;
    const seenBy = (organizationId: string): Promise<string[]> =>
      withOrgScope(organizationId, 'spec 142 test — tenant filter', async () =>
        (await emFactory().find(OrderTransitionEffect, {})).map((row) => row.orderId),
      );

    const mine = await seenBy(TEST_ORGANIZATION_ID);
    expect(mine).toContain(orderId);
    expect(mine).not.toContain(strangerOrder);
    expect(await seenBy(stranger.id)).toEqual([strangerOrder]);
  });
});
