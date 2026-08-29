import type { EntityManager } from '@mikro-orm/postgresql';
import { Cart, CartItem, CreditLimit, CreditLimitReservation, Invoice, PaymentMethod } from './package-entities.js';
import { CustomerAccount } from './package-entities.js';
import { hashPassword } from '@endora-commerce/platform/kernel';
import { TEST_CUSTOMER_ID, TEST_ORGANIZATION_ID } from './test-actors.js';
import { SEED_PRODUCT_101_ID } from './seed-catalog.js';
import { STUB_CUSTOMER_PASSWORD } from './seed-organizations.js';
import {
  SEED_DELIVERY_METHOD_ID,
} from './seed-commerce.js';
import { Order } from './package-entities.js';
import { Payment } from './package-entities.js';

/**
 * US6 fixture IDs.
 */
export const SEED_CREDIT_LIMIT_PAYMENT_METHOD_ID = '00000000-0000-4000-8000-0000000000f2';
export const TEST_CL_CUSTOMER_A_ID = '00000000-0000-4000-8000-0000000000a5';
export const TEST_CL_CUSTOMER_B_ID = '00000000-0000-4000-8000-0000000000a6';
export const SEED_CREDIT_LIMIT_ORDER_ID = '00000000-0000-4000-8000-000000000c01';

/**
 * Race fixture (T207). Two customers in the same org, each with a cart whose
 * total exceeds half of the granted credit limit. The granted amount is set
 * so the sum of two carts > grantedAmount; only one order can succeed.
 */
export async function seedCreditLimitRaceFixture(em: EntityManager): Promise<void> {
  const passwordHash = await hashPassword(STUB_CUSTOMER_PASSWORD);

  // 1. credit_limit payment method (gets used by tests).
  const cl = em.create(PaymentMethod, {
    id: SEED_CREDIT_LIMIT_PAYMENT_METHOD_ID,
    code: 'credit_limit',
    name: { 'en-US': 'Credit limit', 'pl-PL': 'Limit kredytowy' },
    kind: 'credit_limit',
    adapter: 'credit_limit',
    statusOnPending: 'new',
    statusOnSuccess: 'paid',
    statusOnFailure: 'cancelled',
  });
  await em.persistAndFlush(cl);

  // 2. CreditLimit grant. Use 1500 → each cart of 1000 (50 unit @ 19.99 ≈ 999.50)
  //    fits individually, but two together = ~2000 > 1500.
  const limit = em.create(CreditLimit, {
    organizationId: TEST_ORGANIZATION_ID,
    grantedAmount: '1500.00',
    currency: 'PLN',
  });
  await em.persistAndFlush(limit);

  // 3. Two customer accounts inside the same org.
  const a = em.create(CustomerAccount, {
    id: TEST_CL_CUSTOMER_A_ID,
    organizationId: TEST_ORGANIZATION_ID,
    email: 'cl-a@example.com',
    passwordHash,
    firstName: 'CL',
    lastName: 'A',
    role: 'regular_user',
    emailVerifiedAt: new Date(),
  });
  const b = em.create(CustomerAccount, {
    id: TEST_CL_CUSTOMER_B_ID,
    organizationId: TEST_ORGANIZATION_ID,
    email: 'cl-b@example.com',
    passwordHash,
    firstName: 'CL',
    lastName: 'B',
    role: 'regular_user',
    emailVerifiedAt: new Date(),
  });
  await em.persistAndFlush([a, b]);

  // 4. Each gets a cart with quantity 50 of product 101 (price 19.99) → ~999.50.
  for (const cust of [a, b]) {
    const cart = em.create(Cart, {
      customerAccountId: cust.id,
      organizationId: TEST_ORGANIZATION_ID,
      status: 'active',
    });
    await em.persistAndFlush(cart);
    const item = em.create(CartItem, {
      cartId: cart.id,
      productId: SEED_PRODUCT_101_ID,
      quantity: 50,
      unitPrice: '19.99',
      currency: 'PLN',
    });
    await em.persistAndFlush(item);
  }
}

/**
 * Active-reservation fixture (T208, T209, T210, T211). Seeds a CreditLimit +
 * an existing CreditLimitReservation tied to a placed Order. The reservation
 * sum is high enough to trigger ADJUSTMENT_BELOW_ACTIVE on a low PATCH.
 */
export async function seedCreditLimitWithActiveReservation(em: EntityManager): Promise<void> {
  const cl = em.create(PaymentMethod, {
    id: SEED_CREDIT_LIMIT_PAYMENT_METHOD_ID,
    code: 'credit_limit',
    name: { 'en-US': 'Credit limit', 'pl-PL': 'Limit kredytowy' },
    kind: 'credit_limit',
    adapter: 'credit_limit',
    statusOnPending: 'new',
    statusOnSuccess: 'paid',
    statusOnFailure: 'cancelled',
  });
  await em.persistAndFlush(cl);

  const limit = em.create(CreditLimit, {
    organizationId: TEST_ORGANIZATION_ID,
    grantedAmount: '10000.00',
    currency: 'PLN',
  });
  await em.persistAndFlush(limit);

  // Pre-existing Order (status='processing', payment_status='deferred') with
  // payment method credit_limit. The reservation amount is 5000 — enough so a
  // PATCH adjusting the limit to 1000 fails ADJUSTMENT_BELOW_ACTIVE.
  // 'processing' is a current, non-terminal default status that carries a
  // universal →cancelled edge (the order-status model overhaul replaced the
  // legacy 'confirmed' code).
  const order = em.create(Order, {
    id: SEED_CREDIT_LIMIT_ORDER_ID,
    organizationId: TEST_ORGANIZATION_ID,
    placedByCustomerAccountId: TEST_CUSTOMER_ID,
    salesChannelId: '00000000-0000-4000-8000-0000000000c1',
    status: 'processing',
    paymentStatus: 'deferred',
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
    paymentMethodId: SEED_CREDIT_LIMIT_PAYMENT_METHOD_ID,
    paymentMethodSnapshot: { code: 'credit_limit', name: 'CL', kind: 'credit_limit' },
    subtotal: '4065.04',
    taxTotal: '934.96',
    deliveryTotal: '0.00',
    total: '5000.00',
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persistAndFlush(order);

  const payment = em.create(Payment, {
    orderId: order.id,
    paymentMethodId: SEED_CREDIT_LIMIT_PAYMENT_METHOD_ID,
    amount: '5000.00',
    currency: 'PLN',
    status: 'deferred',
  });
  await em.persistAndFlush(payment);

  const invoice = em.create(Invoice, {
    orderId: order.id,
    kind: 'invoice',
    number: 'CL-FIXTURE-2026-1',
    currency: 'PLN',
    total: '5000.00',
    status: 'pending',
  });
  await em.persistAndFlush(invoice);

  const reservation = em.create(CreditLimitReservation, {
    creditLimitId: limit.id,
    orderId: order.id,
    reservingOrganizationId: TEST_ORGANIZATION_ID,
    amount: '5000.00',
    currency: 'PLN',
    status: 'active',
  });
  await em.persistAndFlush(reservation);
}
