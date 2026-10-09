import { describe, expect, it, vi } from 'vitest';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { DeliveryMethodUpsert, ShipmentUsagePort } from '@endora-commerce/contracts';
import { HttpError } from '@endora-commerce/platform/http';
import { makeShipmentUsageCounter } from '../services/shipment-usage-guard.js';
import {
  makeUpsertDeliveryMethodCommand,
  type ShipmentUsageCounter,
} from './delivery-method.commands.js';
import { DeliveryMethod } from '../entities/delivery-method.entity.js';

/**
 * Rebinding a delivery method to another adapter, once the admin screen offers
 * the choice.
 *
 * A `Shipment` records its delivery method and not the adapter that opened it,
 * so the method's `adapter` column is the only answer to "which carrier holds
 * this parcel". Changing it under shipments that already exist hands one
 * carrier's parcels to another, so the Command refuses — and it asks `shipments`
 * only when the adapter really changes, because every ordinary edit sends the
 * adapter the form was shown.
 */

const METHOD_ID = '22222222-2222-4222-8222-222222222222';

function fakeMethod(adapter: string): DeliveryMethod {
  return Object.assign(new DeliveryMethod(), {
    id: METHOD_ID,
    code: 'courier',
    name: { 'en-US': 'Courier' },
    cost: '12.00',
    currency: 'PLN',
    adapter,
    status: 'active' as const,
    statusOnSuccess: 'shipment_sent',
    statusOnFailure: 'processing',
  });
}

function body(adapter?: string): DeliveryMethodUpsert {
  return {
    name: { 'en-US': 'Courier' },
    cost: 15,
    currency: 'PLN',
    ...(adapter === undefined ? {} : { adapter }),
  };
}

async function runUpsert(
  counter: ShipmentUsageCounter,
  row: DeliveryMethod | null,
  upsert: DeliveryMethodUpsert,
) {
  const created: DeliveryMethod[] = [];
  const em = {
    findOne: async () => row,
    create: (_entity: unknown, data: Partial<DeliveryMethod>) =>
      Object.assign(new DeliveryMethod(), data),
    persist: (entity: DeliveryMethod) => {
      created.push(entity);
    },
    flush: async () => undefined,
  } as unknown as EntityManager;
  const command = makeUpsertDeliveryMethodCommand(
    { code: 'courier', body: upsert, existingId: row?.id ?? null },
    counter,
  );
  const outcome = await command.run({
    em,
    actor: { actorAdminUserId: null, impersonatedCustomerAccountId: null, kind: 'system' },
  });
  return { outcome, created };
}

describe('delivery-method upsert — rebinding the adapter', () => {
  it('refuses a change of adapter while a shipment references the method, and leaves the row as it was', async () => {
    const row = fakeMethod('manual_courier');
    const counter = vi.fn<ShipmentUsageCounter>(async () => 3);

    const error = await runUpsert(counter, row, body('personal_pickup')).catch(
      (err: unknown) => err,
    );

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).statusCode).toBe(409);
    expect((error as HttpError).message).toContain('3 shipment(s)');
    expect(counter).toHaveBeenCalledWith(METHOD_ID, 'change-adapter');
    expect(row.adapter).toBe('manual_courier');
    expect(row.cost).toBe('12.00');
  });

  it('rebinds a method no shipment references', async () => {
    const row = fakeMethod('test');
    const counter = vi.fn<ShipmentUsageCounter>(async () => 0);

    const { outcome } = await runUpsert(counter, row, body('manual_courier'));

    expect(outcome.result.method.adapter).toBe('manual_courier');
    expect(outcome.result.created).toBe(false);
  });

  it('asks `shipments` nothing when the body repeats the adapter the row already has', async () => {
    const row = fakeMethod('manual_courier');
    const counter = vi.fn<ShipmentUsageCounter>(async () => 9);

    const { outcome } = await runUpsert(counter, row, body('manual_courier'));

    expect(counter).not.toHaveBeenCalled();
    expect(outcome.result.method.cost).toBe('15.00');
  });

  it('asks `shipments` nothing when the body omits the adapter', async () => {
    const row = fakeMethod('manual_courier');
    const counter = vi.fn<ShipmentUsageCounter>(async () => 9);

    const { outcome } = await runUpsert(counter, row, body());

    expect(counter).not.toHaveBeenCalled();
    expect(outcome.result.method.adapter).toBe('manual_courier');
  });

  it('asks `shipments` nothing on a creation — a new row has no history to protect', async () => {
    const counter = vi.fn<ShipmentUsageCounter>(async () => 9);

    const { outcome, created } = await runUpsert(counter, null, body('manual_courier'));

    expect(counter).not.toHaveBeenCalled();
    expect(created).toHaveLength(1);
    expect(outcome.result.created).toBe(true);
    expect(outcome.result.method.adapter).toBe('manual_courier');
  });

  it('still defaults a new row’s adapter to its code when the body names none', async () => {
    // Kept for the callers that predate the adapter framework. Whether the
    // result can be offered is answered by the route's `availability`.
    const counter = vi.fn<ShipmentUsageCounter>(async () => 0);

    const { outcome } = await runUpsert(counter, null, body());

    expect(outcome.result.method.adapter).toBe('courier');
  });
});

describe('makeShipmentUsageCounter — the refusal names the write that asked', () => {
  it('refuses a change of adapter with its own sentence when `shipments` is off', async () => {
    const resolve = vi.fn<() => ShipmentUsagePort>(() => {
      throw new Error('the port must not be resolved once presence has answered no');
    });
    const count = makeShipmentUsageCounter({
      isShipmentsPresent: () => false,
      shipmentUsage: resolve,
    });

    const error = await count(METHOD_ID, 'change-adapter').catch((err: unknown) => err);

    expect(error).toBeInstanceOf(HttpError);
    expect((error as HttpError).statusCode).toBe(409);
    expect((error as HttpError).message).toContain('Cannot change the adapter');
    expect((error as HttpError).message).toContain('shipments');
    expect(resolve).not.toHaveBeenCalled();
  });

  it('keeps the delete sentence for a caller that names no intent', async () => {
    const count = makeShipmentUsageCounter({
      isShipmentsPresent: () => false,
      shipmentUsage: () => ({ countForDeliveryMethod: async () => 0 }),
    });

    const error = await count(METHOD_ID).catch((err: unknown) => err);

    expect((error as HttpError).message).toContain('Cannot delete delivery method');
  });
});
