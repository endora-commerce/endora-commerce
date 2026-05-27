import type { EntityManager } from '@mikro-orm/postgresql';
import { DeliveryMethod } from '../../src/modules/delivery_methods/entities/delivery-method.entity.js';
import { PaymentMethod } from '../../src/modules/payment_methods/entities/payment-method.entity.js';
import { Address } from '../../src/modules/addresses/entities/address.entity.js';
import { Cart } from '../../src/modules/carts/entities/cart.entity.js';
import { CartItem } from '../../src/modules/carts/entities/cart-item.entity.js';
import { StockLevel } from '../../src/modules/inventory/entities/stock-level.entity.js';
import { Order } from '../../src/modules/orders/entities/order.entity.js';
import { Invoice } from '../../src/modules/invoices/entities/invoice.entity.js';
import { CustomerAccount } from '../../src/modules/customer_accounts/entities/customer-account.entity.js';
import { Organization } from '../../src/modules/organizations/entities/organization.entity.js';
import { hashPassword } from '../../src/modules/auth/services/password-hasher.js';
import {
  TEST_CUSTOMER_ID,
  TEST_ORGANIZATION_ID,
} from './test-actors.js';
import { SEED_PRODUCT_101_ID } from './seed-catalog.js';
import { STUB_CUSTOMER_PASSWORD } from './seed-organizations.js';

/**
 * Deterministic fixture IDs referenced by the US2 contract tests.
 */
export const SEED_DELIVERY_METHOD_ID = '00000000-0000-4000-8000-0000000000e1';
export const SEED_PAYMENT_METHOD_ID = '00000000-0000-4000-8000-0000000000f1';
export const SEED_ADDRESS_DELIVERY_ID = '00000000-0000-4000-8000-0000000000d1';
export const SEED_ADDRESS_BILLING_ID = '00000000-0000-4000-8000-0000000000d2';

export const RFQ_SHIPPED_ORDER_ID = '00000000-0000-4000-8000-0000000003ff';
export const RFQ_ORDER_INVOICE_PENDING_ID = '00000000-0000-4000-8000-000000000301';
export const RFQ_ORDER_INVOICE_READY_ID = '00000000-0000-4000-8000-000000000302';

export const TEST_RACE_CUSTOMER_A_ID = '00000000-0000-4000-8000-000000000aa1';
export const TEST_RACE_CUSTOMER_B_ID = '00000000-0000-4000-8000-000000000aa2';
export const TEST_SUSPENDED_CUSTOMER_ID = '00000000-0000-4000-8000-0000000000a4';
export const TEST_SUSPENDED_ORGANIZATION_ID = '00000000-0000-4000-8000-0000000000ab';

/**
 * Minimum commerce fixtures shared across every US2 test:
 *   - one DeliveryMethod (courier), one PaymentMethod (bank_transfer).
 *   - two addresses bound to the test Organization (one delivery + one billing).
 *   - a StockLevel for SEED_PRODUCT_101_ID with onHand=100.
 */
export async function seedUs2Commerce(em: EntityManager): Promise<void> {
  const delivery = em.create(DeliveryMethod, {
    id: SEED_DELIVERY_METHOD_ID,
    code: 'in_person_pickup',
    name: { 'en-US': 'In-person pickup', 'pl-PL': 'Odbiór osobisty' },
    cost: '0.00',
    currency: 'PLN',
  });
  const payment = em.create(PaymentMethod, {
    id: SEED_PAYMENT_METHOD_ID,
    code: 'bank_transfer',
    name: { 'en-US': 'Bank transfer', 'pl-PL': 'Przelew bankowy' },
    kind: 'bank_transfer',
    adapter: 'bank_transfer',
    statusOnPending: 'new',
    statusOnSuccess: 'confirmed',
    statusOnFailure: 'cancelled',
  });
  await em.persistAndFlush([delivery, payment]);

  const deliveryAddress = em.create(Address, {
    id: SEED_ADDRESS_DELIVERY_ID,
    organizationId: TEST_ORGANIZATION_ID,
    kind: 'delivery',
    recipientName: 'Stub Customer',
    street: 'ul. Odbioru 1',
    city: 'Warszawa',
    postalCode: '00-100',
    country: 'PL',
    isDefault: true,
  });
  const billingAddress = em.create(Address, {
    id: SEED_ADDRESS_BILLING_ID,
    organizationId: TEST_ORGANIZATION_ID,
    kind: 'billing',
    recipientName: 'Stub Customer',
    street: 'ul. Rozliczeń 2',
    city: 'Warszawa',
    postalCode: '00-101',
    country: 'PL',
    isDefault: true,
  });
  await em.persistAndFlush([deliveryAddress, billingAddress]);

  const stock = em.create(StockLevel, {
    productId: SEED_PRODUCT_101_ID,
    warehouseId: '00000000-0000-4000-8000-00000000d017',
    onHand: 100,
    reserved: 0,
  });
  await em.persistAndFlush(stock);
}

/**
 * T099 fixture — a second Organization in status=suspended plus a customer
 * account tied to the `stub-customer-session-suspended` cookie (added below to
 * the stub map). Placing an order must return 423.
 */
export async function seedSuspendedOrganization(em: EntityManager): Promise<void> {
  const passwordHash = await hashPassword(STUB_CUSTOMER_PASSWORD);
  const org = em.create(Organization, {
    id: TEST_SUSPENDED_ORGANIZATION_ID,
    name: 'Suspended Co',
    taxId: 'PL0000000098',
    // Feature 026 (Organizations) renamed `suspended` → `blocked`; the
    // existing fixture name + test semantics are preserved (cannot-transact),
    // only the literal value changes.
    status: 'blocked',
    vatStatus: 'vat_payer',
    registeredAddress: {
      street: 'ul. Wstrzymanych 1',
      city: 'Warszawa',
      postalCode: '00-700',
      country: 'PL',
    },
  });
  await em.persistAndFlush(org);
  const customer = em.create(CustomerAccount, {
    id: TEST_SUSPENDED_CUSTOMER_ID,
    organizationId: TEST_SUSPENDED_ORGANIZATION_ID,
    email: 'suspended@example.com',
    passwordHash,
    firstName: 'Suspended',
    lastName: 'Customer',
    role: 'organization_admin',
    emailVerifiedAt: new Date(),
  });
  // Needs a non-empty cart so the order-place path passes the CART_EMPTY check
  // and reaches the suspended guard.
  await em.persistAndFlush(customer);
  const cart = em.create(Cart, {
    customerAccountId: customer.id,
    organizationId: org.id,
    status: 'active',
  });
  await em.persistAndFlush(cart);
  const item = em.create(CartItem, {
    cartId: cart.id,
    productId: SEED_PRODUCT_101_ID,
    quantity: 1,
    unitPrice: '19.99',
    currency: 'PLN',
  });
  await em.persistAndFlush(item);
}

/**
 * T100 fixture — two customers with one-item carts each pointing at the same
 * stock-1 product. Exactly one order wins.
 */
export async function seedStockRaceFixture(em: EntityManager): Promise<void> {
  const passwordHash = await hashPassword(STUB_CUSTOMER_PASSWORD);
  const a = em.create(CustomerAccount, {
    id: TEST_RACE_CUSTOMER_A_ID,
    organizationId: TEST_ORGANIZATION_ID,
    email: 'race-a@example.com',
    passwordHash,
    firstName: 'Race',
    lastName: 'A',
    role: 'regular_user',
    emailVerifiedAt: new Date(),
  });
  const b = em.create(CustomerAccount, {
    id: TEST_RACE_CUSTOMER_B_ID,
    organizationId: TEST_ORGANIZATION_ID,
    email: 'race-b@example.com',
    passwordHash,
    firstName: 'Race',
    lastName: 'B',
    role: 'regular_user',
    emailVerifiedAt: new Date(),
  });
  await em.persistAndFlush([a, b]);

  // Cap stock at 1 — overwrite whatever seedUs2Commerce wrote.
  await em.getConnection().execute(
    `update stock_levels set on_hand = 1, reserved = 0 where product_id = ?`,
    [SEED_PRODUCT_101_ID],
  );

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
      quantity: 1,
      unitPrice: '19.99',
      currency: 'PLN',
    });
    await em.persistAndFlush(item);
  }
}

/** Cart seed for the primary stub customer — used by T098 (empty) inverse and T103 happy path. */
export async function seedCartForStubCustomer(em: EntityManager): Promise<void> {
  const cart = em.create(Cart, {
    customerAccountId: TEST_CUSTOMER_ID,
    organizationId: TEST_ORGANIZATION_ID,
    status: 'active',
  });
  await em.persistAndFlush(cart);
  const item = em.create(CartItem, {
    cartId: cart.id,
    productId: SEED_PRODUCT_101_ID,
    quantity: 2,
    unitPrice: '19.99',
    currency: 'PLN',
  });
  await em.persistAndFlush(item);
}

/** T101 fixture — an Order already in status=shipped. Admin shipped→new → 409. */
export async function seedShippedOrder(em: EntityManager): Promise<void> {
  const order = em.create(Order, {
    id: RFQ_SHIPPED_ORDER_ID,
    organizationId: TEST_ORGANIZATION_ID,
    placedByCustomerAccountId: TEST_CUSTOMER_ID,
    salesChannelId: '00000000-0000-4000-8000-0000000000c1',
    status: 'shipped',
    paymentStatus: 'paid',
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
    subtotal: '39.98',
    taxTotal: '9.20',
    deliveryTotal: '0.00',
    total: '49.18',
    currency: 'PLN',
    placedAt: new Date(),
  });
  await em.persistAndFlush(order);
}

/** T102 fixture — two Orders plus their invoice rows in different states. */
export async function seedOrdersForInvoiceTests(em: EntityManager): Promise<void> {
  const baseOrder = (id: string) =>
    em.create(Order, {
      id,
      organizationId: TEST_ORGANIZATION_ID,
      placedByCustomerAccountId: TEST_CUSTOMER_ID,
      salesChannelId: '00000000-0000-4000-8000-0000000000c1',
      status: 'confirmed',
      paymentStatus: 'paid',
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
      subtotal: '19.99',
      taxTotal: '4.60',
      deliveryTotal: '0.00',
      total: '24.59',
      currency: 'PLN',
      placedAt: new Date(),
    });

  const pendingOrder = baseOrder(RFQ_ORDER_INVOICE_PENDING_ID);
  const readyOrder = baseOrder(RFQ_ORDER_INVOICE_READY_ID);
  await em.persistAndFlush([pendingOrder, readyOrder]);

  const pendingInvoice = em.create(Invoice, {
    orderId: pendingOrder.id,
    kind: 'proforma',
    number: 'INV-TEST-PENDING',
    currency: 'PLN',
    total: '24.59',
    status: 'pending',
  });
  const readyInvoice = em.create(Invoice, {
    orderId: readyOrder.id,
    kind: 'invoice',
    number: 'INV-TEST-READY',
    currency: 'PLN',
    total: '24.59',
    status: 'ready',
  });
  await em.persistAndFlush([pendingInvoice, readyInvoice]);
}
