import { randomUUID } from 'node:crypto';
import { Organization } from '../../helpers/package-entities.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';
import { CreditLimitService } from '../../../../packages/modules/credit_limits/src/backend/services/credit-limit-service.js';
import { CreditLimit, CreditLimitReservation } from '../../helpers/package-entities.js';
import { Order } from '../../../src/modules/orders/entities/order.entity.js';
import { EventBus } from '../../../src/events/bus.js';

/**
 * `releaseByOrder` reports the credit its own transaction has just freed
 * (issue #207).
 *
 * The method opens a transaction, flips the reservation to `released`, flushes,
 * and only then asks "how much is still reserved?" to answer
 * `availableAmountAfter`. That sum used to be issued through
 * `em.getConnection().execute(sql, params)` — a connection, not the
 * EntityManager's transaction — so it could not see the `released` the same
 * transaction had just written and went on counting the freed reservation as
 * active. Every release therefore understated the available credit by exactly
 * the amount it had released, and nothing pinned the number, which is why the
 * defect stood.
 *
 * The two sibling sums in the same file (`#sumReservationsForLimit`,
 * `#sumReservationsForOrg`, both feature 056) already passed
 * `em.getTransactionContext()` and say "transaction-scoped" in their doc
 * comments — one question asked three ways, two of them right.
 */
async function seedOrder(em: EntityManager, organizationId: string): Promise<string> {
  const order = em.create(Order, {
    organizationId,
    placedByCustomerAccountId: randomUUID(),
    salesChannelId: randomUUID(),
    status: 'paid',
    paymentStatus: 'paid',
    deliveryAddress: {
      recipientName: 'S',
      street: 's',
      city: 'c',
      postalCode: '00-000',
      country: 'PL',
    },
    billingAddress: {
      recipientName: 'S',
      street: 's',
      city: 'c',
      postalCode: '00-000',
      country: 'PL',
    },
    deliveryMethodId: randomUUID(),
    deliveryMethodSnapshot: { code: 'p', name: 'P', cost: 0 },
    paymentMethodId: randomUUID(),
    paymentMethodSnapshot: { code: 'bt', name: 'BT', kind: 'bank_transfer' },
    subtotal: '10.00',
    taxTotal: '0.00',
    deliveryTotal: '0.00',
    total: '10.00',
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persistAndFlush(order);
  return order.id;
}

describe('credit-limit release reads its own transaction (issue #207)', () => {
  let h: BackendServerHandle;
  let service: CreditLimitService;
  let organizationId: string;
  let creditLimitId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    service = new CreditLimitService(h.em, new EventBus());
    const em = h.em();
    const org = em.create(Organization, {
      name: 'Issue 207 release org',
      taxId: 'PL2070000001',
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    });
    await em.persistAndFlush(org);
    organizationId = org.id;
    const limit = em.create(CreditLimit, {
      organizationId,
      grantedAmount: '1000.00',
      currency: 'PLN',
    });
    await em.persistAndFlush(limit);
    creditLimitId = limit.id;
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('reports the whole grant as available once the only reservation is released', async () => {
    const em = h.em();
    const orderId = await seedOrder(em, organizationId);
    const reservation = em.create(CreditLimitReservation, {
      creditLimitId,
      orderId,
      reservingOrganizationId: organizationId,
      amount: '400.00',
      currency: 'PLN',
      status: 'active',
    });
    await em.persistAndFlush(reservation);

    const result = await service.releaseByOrder({ orderId, reason: 'order_cancelled' });

    expect(result.ok).toBe(true);
    // 1000 granted, nothing reserved any more. Read on a connection instead of
    // the transaction this answer is computed in, the released 400 still counted
    // as active and this was 600.
    expect(result.ok && result.availableAmountAfter).toBe(1000);
  });

  it('still counts a reservation the release did not touch', async () => {
    const em = h.em();
    const keptOrderId = await seedOrder(em, organizationId);
    const releasedOrderId = await seedOrder(em, organizationId);
    em.create(CreditLimitReservation, {
      creditLimitId,
      orderId: keptOrderId,
      reservingOrganizationId: organizationId,
      amount: '250.00',
      currency: 'PLN',
      status: 'active',
    });
    em.create(CreditLimitReservation, {
      creditLimitId,
      orderId: releasedOrderId,
      reservingOrganizationId: organizationId,
      amount: '100.00',
      currency: 'PLN',
      status: 'active',
    });
    await em.flush();

    const result = await service.releaseByOrder({
      orderId: releasedOrderId,
      reason: 'invoice_paid',
    });

    expect(result.ok).toBe(true);
    // The 100 released is free again, the 250 that was not released is not:
    // the sum is transaction-scoped, not blind.
    expect(result.ok && result.availableAmountAfter).toBe(750);
  });
});
