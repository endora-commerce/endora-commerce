import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ShipmentUsagePort } from '@endora-commerce/contracts';
import { HttpError } from '../../../src/http/error-envelope.js';
import { makeShipmentUsageCounter } from '../../../src/modules/delivery_methods/services/shipment-usage-guard.js';
import {
  makeDeleteDeliveryMethodCommand,
  type ShipmentUsageCounter,
} from '../../../src/modules/delivery_methods/commands/delivery-method.commands.js';
import { DeliveryMethod } from '../../../src/modules/delivery_methods/entities/delivery-method.entity.js';

/**
 * The delete guard of FR-003, after feature 075 drained the `delivery_methods`
 * shard: this module counted `shipments`'s table in raw SQL, which named no
 * import specifier and so crossed the boundary invisibly.
 *
 * Two halves are worth separating, because they fail differently. The counter
 * answers "may I even ask?" — `shipments` off means nobody can count, and with
 * no foreign key on `shipments.delivery_method_id` a delete taken anyway
 * orphans history permanently. The Command answers "what does the count mean?"
 * — any row at all refuses the delete.
 */

const METHOD_ID = '11111111-1111-4111-8111-111111111111';

function fakeMethod(): DeliveryMethod {
  return Object.assign(new DeliveryMethod(), {
    id: METHOD_ID,
    code: 'courier',
    name: 'Courier',
    cost: '12.00',
    currency: 'PLN',
    adapter: 'courier',
    status: 'active' as const,
    statusOnSuccess: 'shipment_sent',
    statusOnFailure: 'processing',
  });
}

function fakeEm(row: DeliveryMethod | null): {
  em: EntityManager;
  removed: DeliveryMethod[];
} {
  const removed: DeliveryMethod[] = [];
  const em = {
    findOne: async () => row,
    removeAndFlush: async (entity: DeliveryMethod) => {
      removed.push(entity);
    },
  } as unknown as EntityManager;
  return { em, removed };
}

async function runDelete(counter: ShipmentUsageCounter, row: DeliveryMethod | null) {
  const { em, removed } = fakeEm(row);
  const command = makeDeleteDeliveryMethodCommand(METHOD_ID, counter);
  const outcome = await command.run({
    em,
    actor: { actorAdminUserId: null, impersonatedCustomerAccountId: null, kind: 'system' },
  });
  return { outcome, removed };
}

describe('delivery-method delete guard — the shipment count comes from its owner', () => {
  it('refuses the delete when a shipment references the method', async () => {
    const counter: ShipmentUsageCounter = async () => 2;
    await expect(runDelete(counter, fakeMethod())).rejects.toMatchObject({
      statusCode: 409,
    });
  });

  it('deletes when no shipment references the method', async () => {
    const counter = vi.fn<ShipmentUsageCounter>(async () => 0);
    const { removed } = await runDelete(counter, fakeMethod());
    expect(counter).toHaveBeenCalledWith(METHOD_ID);
    expect(removed).toHaveLength(1);
  });

  it('answers 404 before it counts, so a missing method never asks another module', async () => {
    const counter = vi.fn<ShipmentUsageCounter>(async () => 0);
    await expect(runDelete(counter, null)).rejects.toMatchObject({ statusCode: 404 });
    expect(counter).not.toHaveBeenCalled();
  });
});

describe('makeShipmentUsageCounter — presence is decided before the port is resolved', () => {
  it('asks the owner when `shipments` is present', async () => {
    const port: ShipmentUsagePort = { countForDeliveryMethod: async () => 7 };
    const resolve = vi.fn(() => port);
    const count = makeShipmentUsageCounter({
      isShipmentsPresent: () => true,
      shipmentUsage: resolve,
    });
    await expect(count(METHOD_ID)).resolves.toBe(7);
    expect(resolve).toHaveBeenCalledTimes(1);
  });

  it('refuses with a sentence naming the module, and resolves no port, when `shipments` is off', async () => {
    const resolve = vi.fn<() => ShipmentUsagePort>(() => {
      throw new Error('the port must not be resolved once presence has answered no');
    });
    const count = makeShipmentUsageCounter({
      isShipmentsPresent: () => false,
      shipmentUsage: resolve,
    });
    const error = await count(METHOD_ID).catch((err: unknown) => err);
    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).statusCode).toBe(409);
    expect((error as HttpError).message).toContain('shipments');
    expect(resolve).not.toHaveBeenCalled();
  });
});
