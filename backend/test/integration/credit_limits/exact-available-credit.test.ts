import { randomUUID } from 'node:crypto';
import type { EntityManager } from '@mikro-orm/postgresql';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { EventBus } from '@endora-commerce/platform/events';
import { CreditLimitService } from '../../../../packages/modules/credit_limits/src/backend/services/credit-limit-service.js';
import { CreditLimit, Order, Organization } from '../../helpers/package-entities.js';
import {
  setupBackendServer,
  teardownBackendServer,
  type BackendServerHandle,
} from '../../helpers/test-server.js';

/**
 * Issue #417 — a reservation decides on the available credit exactly. On
 * doubles a 0.30 limit with 0.10 reserved had 0.19999999999999998 available,
 * so an order of 0.20 — exactly the credit left — was refused as
 * `LIMIT_INSUFFICIENT`.
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

describe('credit-limit reservation compares exact amounts (#417)', () => {
  let h: BackendServerHandle;
  let service: CreditLimitService;
  let organizationId: string;

  beforeAll(async () => {
    h = await setupBackendServer();
    service = new CreditLimitService(h.em, new EventBus());
    const em = h.em();
    const org = em.create(Organization, {
      name: 'Issue 417 credit org',
      taxId: 'PL4170000001',
      status: 'active',
      vatStatus: 'vat_payer',
      registeredAddress: { street: '-', city: '-', postalCode: '-', country: 'PL' },
    });
    await em.persistAndFlush(org);
    organizationId = org.id;
    await em.persistAndFlush(em.create(CreditLimit, { organizationId, grantedAmount: '0.30', currency: 'PLN' }));
  });

  afterAll(async () => {
    await teardownBackendServer(h);
  });

  it('reserves an order equal to the credit left', async () => {
    const reserve = (amount: number) =>
      h.em().transactional(async (tx) => {
        const orderId = await seedOrder(tx, organizationId);
        return service.reserve({ organizationId, orderId, amount, currency: 'PLN', tx });
      });
    expect(await reserve(0.1)).toMatchObject({ ok: true, availableAmountAfter: 0.2 });
    expect(await reserve(0.2)).toMatchObject({ ok: true, availableAmountAfter: 0 });
    expect(await reserve(0.01)).toMatchObject({ ok: false, code: 'LIMIT_INSUFFICIENT', availableAmount: 0 });
  });
});
