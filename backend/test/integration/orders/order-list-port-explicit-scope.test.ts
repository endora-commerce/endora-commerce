import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { OrderListPort } from '@endora-commerce/contracts';
import { Order, Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { TEST_CUSTOMER_ID } from '../../helpers/test-actors.js';
import { SEED_DELIVERY_METHOD_ID, SEED_PAYMENT_METHOD_ID } from '../../helpers/seed-commerce.js';
import { withSystemScope } from '../../../src/tenancy/escape-hatch.js';

/**
 * Issue #955, architect ruling Q3 — the admin orders list no longer spells the
 * **ambient** reach a second time (the `@OrgScoped` filter carries it), but an
 * **explicit** scope is not the ambient one and must still narrow:
 * `orderListPort.list(query, { allowedOrganizationIds })` under a scope wider
 * than that set — here the system scope, which reaches every organization —
 * answers the named organizations' orders only.
 */
describe('orderListPort.list — an explicit scope narrows a wider ambient one (#955 Q3)', () => {
  let h: BackendServerHandle;
  const stamp = Date.now().toString().slice(-7);
  const orgIds: string[] = [];
  const orderIds: string[] = [];

  beforeAll(async () => {
    h = await setupBackendServer();
    await withSystemScope('#955 Q3: two organizations with one order each', async () => {
      const em = h.orm.em.fork();
      for (const label of ['a', 'b']) {
        const org = em.create(Organization, {
          name: `R955 Q3 ${label}`,
          taxId: `PL955Q3${label.toUpperCase()}${stamp}`,
          status: 'active',
          vatStatus: 'vat_payer',
          registeredAddress: { street: 'ul. Q3 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' },
        });
        await em.persistAndFlush(org);
        orgIds.push(org.id);
      }
      const address = { recipientName: 'Q3', street: 'ul. Odbioru 1', city: 'Warszawa', postalCode: '00-100', country: 'PL' };
      for (const organizationId of orgIds) {
        const id = randomUUID();
        orderIds.push(id);
        em.create(Order, {
          id,
          organizationId,
          placedByCustomerAccountId: TEST_CUSTOMER_ID,
          salesChannelId: '00000000-0000-4000-8000-0000000000c1',
          status: 'new',
          paymentStatus: 'pending',
          deliveryAddress: address,
          billingAddress: address,
          deliveryMethodId: SEED_DELIVERY_METHOD_ID,
          deliveryMethodSnapshot: { code: 'in_person_pickup', name: 'Pickup', cost: 0 },
          paymentMethodId: SEED_PAYMENT_METHOD_ID,
          paymentMethodSnapshot: { code: 'bank_transfer', name: 'BT', kind: 'bank_transfer' },
          subtotal: '10.00',
          taxTotal: '2.30',
          deliveryTotal: '0.00',
          total: '12.30',
          currency: 'PLN',
          placedAt: new Date(),
        } as never);
      }
      await em.flush();
    });
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('answers only the explicitly allowed organization', async () => {
    const port = (h.container.cradle as unknown as { orderListPort: OrderListPort }).orderListPort;
    const result = await withSystemScope('#955 Q3: a wider ambient scope', () =>
      port.list({ pageSize: 200 } as never, { allowedOrganizationIds: [orgIds[0]!] }),
    );
    const mine = result.rows.filter((row) => orderIds.includes(row.id));
    expect(mine.map((row) => row.organizationId)).toEqual([orgIds[0]]);
    expect(result.rows.every((row) => row.organizationId === orgIds[0])).toBe(true);
  });
});
