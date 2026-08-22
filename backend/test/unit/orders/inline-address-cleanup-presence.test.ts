import { describe, expect, it } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { AddressServicePort, CartWritePort, CustomerAccountReadPort } from '@endora-commerce/contracts';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import { OrderCreationAdminService } from '../../../src/modules/orders/services/order-creation-admin-service.js';
import { OrderApiIntakeService } from '../../../src/modules/orders/services/order-api-intake-service.js';
import type { OrderService } from '../../../src/modules/orders/services/order-service.js';

/**
 * Issue #197 — the one-time inline address both placement surfaces create is
 * dropped again afterwards in a `try { … } catch`. The tolerance is the narrow
 * kind AGENTS.md sanctions (a leftover soft-deletable row is harmless), but a
 * *bare* catch also swallows `ModuleDisabledError`, which turns the port's
 * fail-closed seam into fail-open. The two suites below pin both halves: the
 * presence answer reaches the caller, an ordinary cleanup failure does not.
 *
 * `addresses` is non-deactivatable today, so `check:port-catches` reports both
 * sites as D-63 `OWNER LOCKED` rather than as violations. That classification
 * is derived from the manifest on every run — these tests are what keeps the
 * seam honest the day the manifest changes.
 */

const ORG_ID = '00000000-0000-4000-8000-000000000010';
const CUSTOMER_ID = '00000000-0000-4000-8000-000000000011';
const CHANNEL_ID = '00000000-0000-4000-8000-000000000012';
const ADDRESS_ID = '00000000-0000-4000-8000-000000000013';
const ORDER_ID = '00000000-0000-4000-8000-000000000014';

const inlineAddress = {
  recipientName: 'Jan Kowalski',
  street: 'ul. Testowa 1',
  city: 'Warszawa',
  postalCode: '00-001',
  country: 'PL',
  saveToAddressBook: false,
};

/** A `deleteAddress` that fails the way the argument is about. */
function addressServiceFailingCleanupWith(error: unknown): AddressServicePort {
  return {
    list: async () => [],
    createAddress: async (organizationId, input) => ({
      id: ADDRESS_ID,
      organizationId,
      kind: input.kind,
      recipientName: input.recipientName,
      street: input.street,
      city: input.city,
      postalCode: input.postalCode,
      country: input.country,
      phone: input.phone ?? null,
      isDefault: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    }),
    updateAddress: async () => {
      throw new Error('not used');
    },
    deleteAddress: async () => {
      throw error;
    },
  };
}

const cartService = {
  clearForCustomer: async () => undefined,
  addItem: async () => undefined,
} as unknown as CartWritePort;

const placedOrder = { id: ORDER_ID, businessId: 'ORD-1' };

const orderService = {
  placeOrder: async () => placedOrder,
} as unknown as OrderService;

describe('OrderCreationAdminService — inline-address cleanup', () => {
  const customerAccountRead = {
    findById: async () => ({ id: CUSTOMER_ID, organizationId: ORG_ID, email: null }),
  } as unknown as CustomerAccountReadPort;

  const emFactory = () =>
    ({
      persist: () => undefined,
      create: () => ({}),
      flush: async () => undefined,
    }) as unknown as EntityManager;

  const serviceWith = (cleanupError: unknown) =>
    new OrderCreationAdminService(
      emFactory,
      cartService,
      orderService,
      addressServiceFailingCleanupWith(cleanupError),
      customerAccountRead,
    );

  const input = {
    customerAccountId: CUSTOMER_ID,
    salesChannelId: CHANNEL_ID,
    items: [{ productId: '00000000-0000-4000-8000-000000000020', quantity: 1 }],
    deliveryMethodId: '00000000-0000-4000-8000-000000000021',
    paymentMethodId: '00000000-0000-4000-8000-000000000022',
    deliveryAddress: inlineAddress,
    billingAddressId: '00000000-0000-4000-8000-000000000023',
  };

  it('lets a switched-off `addresses` reach the caller instead of swallowing it', async () => {
    await expect(serviceWith(new ModuleDisabledError('addresses')).create(null, input)).rejects.toBeInstanceOf(
      ModuleDisabledError,
    );
  });

  it('still tolerates an ordinary cleanup failure — the order is placed', async () => {
    const order = await serviceWith(new Error('transient delete failure')).create(null, input);
    expect(order.id).toBe(ORDER_ID);
  });
});

describe('OrderApiIntakeService — inline-address cleanup', () => {
  const product = {
    id: '00000000-0000-4000-8000-000000000030',
    sku: 'SKU-1',
    attributeValues: { defaultPrice: 10 },
  };

  const emFactory = () =>
    ({
      findOne: async (entity: unknown) => {
        const name = (entity as { name?: string }).name ?? '';
        if (name === 'SalesChannel') return { id: CHANNEL_ID, defaultCurrency: 'PLN' };
        return null;
      },
      create: (_entity: unknown, data: Record<string, unknown>) => ({
        id: '00000000-0000-4000-8000-000000000040',
        ...data,
      }),
      persistAndFlush: async () => undefined,
      flush: async () => undefined,
    }) as unknown as EntityManager;

  const serviceWith = (cleanupError: unknown) =>
    new OrderApiIntakeService({
      emFactory,
      cartService,
      orderService,
      addressService: addressServiceFailingCleanupWith(cleanupError),
      catalogProductRead: {
        findBySkus: async () => [product],
      } as never,
      organizationDetails: {
        findById: async () => null,
      } as never,
      salesChannelMembership: {
        listChannelsForEntity: async () => [{ id: CHANNEL_ID }],
      } as never,
      pricingService: {
        resolveLinePrice: async () => ({ unitPrice: '10.00' }),
      } as never,
    });

  const binding = {
    apiKeyId: '00000000-0000-4000-8000-000000000050',
    organizationId: ORG_ID,
    salesChannelId: CHANNEL_ID,
    customerAccountId: CUSTOMER_ID,
  };

  const body = {
    lines: [{ sku: 'SKU-1', quantity: 1 }],
    deliveryMethodId: '00000000-0000-4000-8000-000000000021',
    paymentMethodId: '00000000-0000-4000-8000-000000000022',
    deliveryAddress: inlineAddress,
    billingAddressId: '00000000-0000-4000-8000-000000000023',
  } as never;

  it('lets a switched-off `addresses` reach the caller instead of swallowing it', async () => {
    await expect(
      serviceWith(new ModuleDisabledError('addresses')).place(binding, 'idem-key-1', body),
    ).rejects.toBeInstanceOf(ModuleDisabledError);
  });

  it('still tolerates an ordinary cleanup failure — the order is placed', async () => {
    const result = await serviceWith(new Error('transient delete failure')).place(
      binding,
      'idem-key-2',
      body,
    );
    expect(result.order.id).toBe(ORDER_ID);
  });
});
