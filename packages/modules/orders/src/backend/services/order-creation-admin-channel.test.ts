import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import {
  ERROR_CODES,
  type AddressServicePort,
  type CartWritePort,
  type CustomerAccountReadPort,
} from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { OrderCreationAdminService } from './order-creation-admin-service.js';
import type { OrderService } from './order-service.js';

/**
 * Issue #515 — `OrderCreationAdminService.create` places the order on the
 * channel the operator names only when it is one of the customer's
 * Organization's active assigned channels, and refuses any other with `422
 * ORDER_SALES_CHANNEL_NOT_ALLOWED` **before anything is written**: no inline
 * address, no working basket, no placement. Service-free.
 */

const ORG_ID = '00000000-0000-4000-8000-0000000000a1';
const CUSTOMER_ID = '00000000-0000-4000-8000-0000000000b1';
const ASSIGNED = '00000000-0000-4000-8000-0000000000c1';
const INACTIVE = '00000000-0000-4000-8000-0000000000c2';
const UNASSIGNED = '00000000-0000-4000-8000-0000000000c3';

function build(
  membership:
    | { listChannelsForEntity: (type: 'organization', id: string) => Promise<Array<{ id: string; active: boolean }>> }
    | undefined,
) {
  const writes = {
    addItems: vi.fn(async (_actor: unknown, lines: readonly unknown[]) => ({
      cart: { id: 'working-1' },
      items: [],
      outcomes: lines.map((_line, index) => ({ index, status: 'added' })),
    })),
    createAddress: vi.fn(async () => ({ id: 'addr-1' })),
    placeOrder: vi.fn(async () => ({ id: 'order-1', businessId: 'ORD-1' })),
  };
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
    membership,
  );
  return { svc, writes };
}

const membership = () => ({
  listChannelsForEntity: vi.fn(async () => [
    { id: ASSIGNED, active: true },
    { id: INACTIVE, active: false },
  ]),
});

const input = (salesChannelId: string) => ({
  customerAccountId: CUSTOMER_ID,
  salesChannelId,
  items: [{ productId: '00000000-0000-4000-8000-000000000101', quantity: 1 }],
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

describe('OrderCreationAdminService.create — the Organization\'s channels bind the operator', () => {
  it('places the order on an active channel the Organization is assigned to', async () => {
    const port = membership();
    const { svc, writes } = build(port);

    const order = await svc.create(null, input(ASSIGNED));

    expect(order.id).toBe('order-1');
    expect(port.listChannelsForEntity).toHaveBeenCalledWith('organization', ORG_ID);
    expect(writes.placeOrder).toHaveBeenCalledOnce();
  });

  it.each([
    ['a channel the Organization is not assigned to', UNASSIGNED],
    ['an inactive channel the Organization is assigned to', INACTIVE],
    ['an id naming no channel', '00000000-0000-4000-8000-00000000dead'],
  ])('refuses %s with 422 ORDER_SALES_CHANNEL_NOT_ALLOWED, writing nothing', async (_label, channelId) => {
    const { svc, writes } = build(membership());

    const err = await refusal(svc.create(null, input(channelId)));

    expect(err.statusCode).toBe(422);
    expect(err.code).toBe(ERROR_CODES.ORDER_SALES_CHANNEL_NOT_ALLOWED);
    expect(writes.createAddress).not.toHaveBeenCalled();
    expect(writes.addItems).not.toHaveBeenCalled();
    expect(writes.placeOrder).not.toHaveBeenCalled();
  });

  it('fails closed with 500 INTERNAL when the membership port is not wired, writing nothing', async () => {
    const { svc, writes } = build(undefined);

    const err = await refusal(svc.create(null, input(ASSIGNED)));

    expect(err.statusCode).toBe(500);
    expect(err.code).toBe(ERROR_CODES.INTERNAL);
    expect(writes.createAddress).not.toHaveBeenCalled();
    expect(writes.addItems).not.toHaveBeenCalled();
  });
});
