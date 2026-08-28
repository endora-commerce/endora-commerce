import type { EntityManager } from '@mikro-orm/postgresql';
import { CustomerAccount } from './package-entities.js';
import { hashPassword } from '@endora-commerce/platform/kernel';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from './test-actors.js';
import {
  SEED_ADDRESS_BILLING_ID,
  SEED_ADDRESS_DELIVERY_ID,
  SEED_DELIVERY_METHOD_ID,
  SEED_PAYMENT_METHOD_ID,
} from './seed-commerce.js';
import { STUB_CUSTOMER_PASSWORD } from './seed-organizations.js';
import { Order } from './package-entities.js';

/**
 * Fixture for T169 (Regular User scoping).
 *
 * Seeds a second customer (regular_user role) inside TEST_ORGANIZATION_ID + an
 * Order placed by TEST_CUSTOMER_ID (the org admin). The regular user must
 * receive 404 on GET /orders/:id for that order; the admin must receive 200.
 */

export const TEST_REGULAR_USER_ID = '00000000-0000-4000-8000-000000000a31';
export const SEED_ORDER_ROLE_FIXTURE_ID = '00000000-0000-4000-8000-000000000401';

export async function seedRoleScopingFixture(em: EntityManager): Promise<void> {
  const passwordHash = await hashPassword(STUB_CUSTOMER_PASSWORD);
  const regular = em.create(CustomerAccount, {
    id: TEST_REGULAR_USER_ID,
    organizationId: TEST_ORGANIZATION_ID,
    email: 'regular-user@example.com',
    passwordHash,
    firstName: 'Reg',
    lastName: 'Ular',
    role: 'regular_user',
    emailVerifiedAt: new Date(),
  });
  await em.persistAndFlush(regular);

  // Order owned by the org admin (TEST_CUSTOMER_ID). Used as the read target.
  const order = em.create(Order, {
    id: SEED_ORDER_ROLE_FIXTURE_ID,
    organizationId: TEST_ORGANIZATION_ID,
    placedByCustomerAccountId: TEST_CUSTOMER_ID,
    salesChannelId: '00000000-0000-4000-8000-0000000000c1',
    status: 'confirmed',
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
    subtotal: '49.00',
    taxTotal: '11.27',
    deliveryTotal: '0.00',
    total: '60.27',
    currency: 'PLN',
    placedAt: new Date(),
  });
  // Use stash addressIds to silence "unused" warnings — the snapshot above is
  // what the contract reads.
  void SEED_ADDRESS_BILLING_ID;
  void SEED_ADDRESS_DELIVERY_ID;
  await em.persistAndFlush(order);
}
