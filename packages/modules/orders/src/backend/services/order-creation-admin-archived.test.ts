import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AddressServicePort,
  type CartWritePort,
  type CatalogProductReadPort,
  type CustomerAccountReadPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { OrderCreationAdminService } from './order-creation-admin-service.js';
import type { OrderService } from './order-service.js';

/**
 * Issue #829 — admin order create refuses a line whose product is archived
 * (`specs/163-product-data-scopes/` FR-019) with `409 PRODUCT_ARCHIVED`,
 * catalog's code and sentence, naming the archived products in
 * `details.productIds` — the reason the operator's quote request gives
 * (FR-115, P-3b) and the code the admin order preview reports for the same
 * line. Refused **before anything is written**: no inline address, no working
 * basket, no placement. A product id that does not exist, or a soft-deleted
 * product, is not decided here: the basket answers it `404
 * PRODUCT_NOT_FOUND`, as before. Service-free.
 */

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000b1';
const CHANNEL_ID = '00000000-0000-4000-8000-0000000000c1';
const LIVE = '00000000-0000-4000-8000-000000000101';
const ARCHIVED = '00000000-0000-4000-8000-000000000102';
const MISSING = '00000000-0000-4000-8000-0000000001ff';

function build() {
  const writes = {
    addItems: vi.fn(async (_actor: unknown, lines: readonly unknown[]) => ({
      cart: { id: 'working-1' },
      items: [],
      outcomes: lines.map((_line, index) => ({ index, status: 'added' })),
    })),
    createAddress: vi.fn(async () => ({ id: 'addr-1' })),
    placeOrder: vi.fn(async () => ({ id: 'order-1', businessId: 'ORD-1' })),
  };
  const findByIds = vi.fn(async (ids: readonly string[]) =>
    ids.flatMap((id) =>
      id === LIVE
        ? [{ id, archivedAt: null }]
        : id === ARCHIVED
          ? [{ id, archivedAt: new Date('2026-11-01T00:00:00Z') }]
          : [],
    ),
  );
  const svc = new OrderCreationAdminService(
    () => ({ persist: () => undefined, create: () => ({}), flush: async () => undefined }) as unknown as EntityManager,
    { addItems: writes.addItems } as unknown as CartWritePort,
    {
      placeOrder: writes.placeOrder,
      assertMethodsAllowedForOrganization: async () => undefined,
      assertMethodsOfferedInChannel: async () => undefined,
    } as unknown as OrderService,
    {
      createAddress: writes.createAddress,
      deleteAddress: async () => undefined,
    } as unknown as AddressServicePort,
    {
      findById: async () => ({ id: CUSTOMER_ID, organizationId: ORG_ID, email: null }),
    } as unknown as CustomerAccountReadPort,
    { listChannelsForEntity: async () => [{ id: CHANNEL_ID, active: true }] },
    { findByIds } as unknown as Pick<CatalogProductReadPort, 'findByIds'>,
  );
  return { svc, writes, findByIds };
}

const input = (productIds: readonly string[]) => ({
  customerAccountId: CUSTOMER_ID,
  salesChannelId: CHANNEL_ID,
  items: productIds.map((productId) => ({ productId, quantity: 1 })),
  deliveryMethodId: '00000000-0000-4000-8000-000000000201',
  paymentMethodId: '00000000-0000-4000-8000-000000000301',
  // An inline address: the first write the service would make.
  deliveryAddress: {
    recipientName: 'Jan Kowalski',
    street: 'ul. Testowa 1',
    city: 'Warszawa',
    postalCode: '00-001',
    country: 'PL',
    saveToAddressBook: true,
  },
  billingAddressId: '00000000-0000-4000-8000-000000000401',
});

async function refusal(promise: Promise<unknown>): Promise<HttpError> {
  try {
    await promise;
  } catch (err) {
    if (err instanceof HttpError) return err;
    throw err;
  }
  throw new Error('expected a refusal');
}

describe('OrderCreationAdminService.create — an archived product (issue #829)', () => {
  it('refuses it with 409 PRODUCT_ARCHIVED naming the archived products, writing nothing', async () => {
    const { svc, writes } = build();

    const err = await refusal(svc.create(null, input([LIVE, ARCHIVED, ARCHIVED])));

    expect(err.statusCode).toBe(409);
    expect(err.code).toBe(ERROR_CODES.PRODUCT_ARCHIVED);
    expect(err.message).toBe('Product is archived.');
    expect(err.details).toEqual({ productIds: [ARCHIVED] });
    expect(writes.createAddress).not.toHaveBeenCalled();
    expect(writes.addItems).not.toHaveBeenCalled();
    expect(writes.placeOrder).not.toHaveBeenCalled();
  });

  it('reads the lines\' products once, live only, so a soft-deleted one stays the basket\'s 404', async () => {
    const { svc, findByIds } = build();

    await svc.create(null, input([LIVE, LIVE]));

    expect(findByIds).toHaveBeenCalledOnce();
    expect(findByIds).toHaveBeenCalledWith([LIVE], { liveOnly: true });
  });

  it('leaves an id naming no product to the basket, which answers it as before', async () => {
    const { svc, writes } = build();

    await svc.create(null, input([LIVE, MISSING]));

    expect(writes.addItems).toHaveBeenCalledOnce();
  });

  it('control — live products are placed', async () => {
    const { svc, writes } = build();

    const order = await svc.create(null, input([LIVE]));

    expect(order.id).toBe('order-1');
    expect(writes.placeOrder).toHaveBeenCalledOnce();
  });
});
