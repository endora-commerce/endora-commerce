import type {
  CustomerAccountRecord,
  OrderReadPort,
  OrderRecord,
} from '@endora-commerce/contracts';
import { describe, expect, it } from 'vitest';
import { ModuleDisabledError } from '../../../src/kernel/lifecycle/plugin-helpers.js';
import {
  CustomerAdminQueryService,
  type CustomerAdminQueryPorts,
} from '../../../src/modules/customers/services/customer-admin-query-service.js';
import type { CustomerDefaultsService } from '../../../src/modules/customers/services/customer-defaults-service.js';

/**
 * Feature 080, T048 (D-169) — the customer-detail channel list comes from
 * `orders`' read port.
 *
 * It was `em.find(Order, { placedByCustomerAccountId }, { fields: [
 * 'salesChannelId'] })`, written inside `customers`: a plain read of another
 * module's table, and the last site in this module naming an `orders` entity.
 * A plain read takes a **read-port method** and never an `EntityManager`-taking
 * apply port — handing a read an `EntityManager` re-opens a write seam to serve
 * it.
 *
 * The service no longer holds an `EntityManager` at all, which is what the
 * first case measures: there is no constructor slot left to query a foreign
 * table from. The second is the substance of the gate — `orders` declares
 * itself `nonDeactivatable`, so there is no operator axis to drive here, and
 * what has to be proven at the call site is that a `ModuleDisabledError` from
 * the port arrives at the caller rather than being absorbed into an empty
 * channel list. The platform axis is driven for real, end to end, in
 * `test/contract/customers/cut-edges-fail-closed.test.ts`.
 */

function customerRecord(over: Partial<CustomerAccountRecord> = {}): CustomerAccountRecord {
  return {
    id: 'cust-1',
    organizationId: 'org-1',
    email: 'buyer@example.test',
    firstName: 'Buyer',
    lastName: 'One',
    role: 'regular_user',
    emailVerifiedAt: null,
    twoFactorEnabled: false,
    lastLoginAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
    customFieldValues: {},
    deletedAt: null,
    customerGroupId: null,
    subtreeRollupEnabled: false,
    blockedAt: null,
    blockReason: null,
    blockSource: null,
    blockedByAdminUserId: null,
    blockedByCustomerAccountId: null,
    deletionRequestedByAdminUserId: null,
    anonymizedAt: null,
    ...over,
  };
}

/** Only the methods `OrderReadPort` publishes — never `orders`' entities. */
function readPort(
  salesChannelIdsForCustomer: OrderReadPort['salesChannelIdsForCustomer'],
): OrderReadPort {
  const unreachable = (name: string) => () => {
    throw new Error(`customers reached OrderReadPort.${name}`);
  };
  return {
    findById: unreachable('findById') as unknown as OrderReadPort['findById'],
    findByIds: unreachable('findByIds') as unknown as OrderReadPort['findByIds'],
    listAll: unreachable('listAll') as unknown as () => Promise<OrderRecord[]>,
    listItems: unreachable('listItems') as unknown as OrderReadPort['listItems'],
    findIdsByBusinessIdLike:
      unreachable('findIdsByBusinessIdLike') as unknown as OrderReadPort['findIdsByBusinessIdLike'],
    salesChannelIdsForCustomer,
  };
}

function ports(orders: OrderReadPort): CustomerAdminQueryPorts {
  return {
    accounts: {
      findById: async (id: string) => (id === 'cust-1' ? customerRecord() : null),
    } as CustomerAdminQueryPorts['accounts'],
    accountSearch: {} as CustomerAdminQueryPorts['accountSearch'],
    organizations: {
      findByIds: async () => [],
    } as unknown as CustomerAdminQueryPorts['organizations'],
    customerGroups: {
      findByIds: async () => [],
    } as unknown as CustomerAdminQueryPorts['customerGroups'],
    orders,
  };
}

const defaults = {
  getForCustomer: async () => ({
    paymentMethodId: null,
    deliveryMethodId: null,
    billingAddressId: null,
    shippingAddressId: null,
  }),
} as unknown as CustomerDefaultsService;

describe('customers — the customer-detail channel list is orders’ published read', () => {
  it('asks the port once and reports every channel it answers, without deduping again', async () => {
    const calls: string[] = [];
    const service = new CustomerAdminQueryService(
      defaults,
      ports(
        readPort(async (customerAccountId) => {
          calls.push(customerAccountId);
          return ['ch-b', 'ch-a'];
        }),
      ),
    );

    const detail = await service.getDetail('cust-1');

    expect(calls).toEqual(['cust-1']);
    // The owner answers distinct ids in its own order; the consumer passes
    // them through. Re-sorting or re-deduping here would be a second answer to
    // a question the owner already answered.
    expect(detail?.salesChannelIds).toEqual(['ch-b', 'ch-a']);
  });

  it('lets a MODULE_DISABLED answer through instead of an empty channel list', async () => {
    const service = new CustomerAdminQueryService(
      defaults,
      ports(
        readPort(async () => {
          throw new ModuleDisabledError('orders');
        }),
      ),
    );

    // No bare `catch` anywhere on the path: the refusal reaches the route,
    // which renders it as the 503 `MODULE_DISABLED` envelope. Absorbing it
    // would report "this buyer has ordered on no channel", which is a
    // statement about the buyer and not about the platform.
    await expect(service.getDetail('cust-1')).rejects.toBeInstanceOf(ModuleDisabledError);
  });
});
