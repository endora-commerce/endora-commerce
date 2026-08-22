import { describe, expect, it, vi } from 'vitest';
import type { ShippingAdapter } from '@endora-commerce/contracts';
import { ShippingAdapterRegistry } from '../../../src/modules/delivery_methods/services/shipping-adapter-registry.js';

/**
 * T011 (Foundational) — the in-memory shipping adapter registry: register /
 * get / resolve / unregister / list, with last-writer-wins + a warning.
 *
 * Issue #96 added the owner stamp and the presence filter, mirroring the
 * payment twin. The mechanism is identical; the exposure is not, because today
 * `delivery_methods` is the only contributor. These tests pin the shape before
 * a carrier module arrives to depend on it.
 */
const adapter = (key: string): ShippingAdapter => ({
  adapterKey: key,
  validateUseOnStorefront: async () => true,
  validateUseOnAdmin: async () => true,
  validateUseInApi: async () => true,
  onOrderCreated: async () => {},
  onShipmentCreated: async () => ({ kind: 'pending' }),
  onReceiveShipment: async () => ({ result: 'success' }),
});

describe('ShippingAdapterRegistry', () => {
  it('registers, gets, resolves and lists in insertion order', () => {
    const reg = new ShippingAdapterRegistry();
    reg.register(adapter('manual_courier'), 'delivery_methods');
    reg.register(adapter('personal_pickup'), 'delivery_methods');

    expect(reg.isRegistered('manual_courier')).toBe(true);
    expect(reg.get('personal_pickup')?.adapterKey).toBe('personal_pickup');
    expect(reg.resolve('manual_courier').adapterKey).toBe('manual_courier');
    expect(reg.list()).toEqual(['manual_courier', 'personal_pickup']);
    expect(reg.ownerOf('manual_courier')).toBe('delivery_methods');
  });

  it('resolve throws for an unknown key; get returns undefined', () => {
    const reg = new ShippingAdapterRegistry();
    expect(reg.get('nope')).toBeUndefined();
    expect(() => reg.resolve('nope')).toThrow(/no adapter registered/);
  });

  it('unregisters an adapter', () => {
    const reg = new ShippingAdapterRegistry();
    reg.register(adapter('x'), 'delivery_methods');
    reg.unregister('x');
    expect(reg.isRegistered('x')).toBe(false);
  });

  it('warns and overwrites when another module claims the key (last-writer-wins)', () => {
    const warn = vi.fn();
    const reg = new ShippingAdapterRegistry({ warn });
    const first = adapter('dup');
    const second = adapter('dup');
    reg.register(first, 'delivery_methods');
    reg.register(second, 'carrier');
    expect(warn).toHaveBeenCalledOnce();
    expect(reg.get('dup')).toBe(second);
  });

  it('is silent when the same owner re-registers', () => {
    const warn = vi.fn();
    const reg = new ShippingAdapterRegistry({ warn });
    reg.register(adapter('dup'), 'delivery_methods');
    reg.register(adapter('dup'), 'delivery_methods');
    expect(warn).not.toHaveBeenCalled();
  });

  it('skips an adapter whose owner is absent, without dropping the registration', () => {
    const reg = new ShippingAdapterRegistry(undefined, (id) => id === 'delivery_methods');
    reg.register(adapter('manual_courier'), 'delivery_methods');
    reg.register(adapter('carrier_express'), 'carrier');

    expect(reg.get('carrier_express')).toBeUndefined();
    expect(reg.isAvailable('carrier_express')).toBe(false);
    expect(reg.list()).toEqual(['manual_courier']);
    expect(reg.isRegistered('carrier_express')).toBe(true);
    expect(reg.listAll()).toEqual(['manual_courier', 'carrier_express']);
    expect(() => reg.resolve('carrier_express')).toThrow(/currently disabled/i);
  });

  /**
   * Issue #250 — the three shapes of `absentOwnerFor`, asserted separately
   * because each stands for a different sentence a shipment carries. Two of
   * them make `get()` answer `undefined`, and it is exactly that collapse this
   * reader exists to undo.
   */
  it('names the absent owner of a registered adapter, and nobody else', () => {
    const reg = new ShippingAdapterRegistry(undefined, (id) => id === 'delivery_methods');
    reg.register(adapter('manual_courier'), 'delivery_methods');
    reg.register(adapter('carrier_express'), 'carrier');

    // Registered, owner absent — the module an operator can switch back on.
    expect(reg.absentOwnerFor('carrier_express')).toBe('carrier');
    // Registered and available — nothing absent to name.
    expect(reg.absentOwnerFor('manual_courier')).toBeNull();
    // Never contributed — `get()` also answers `undefined` here, and this is
    // the situation that must not be reported as a switched-off module.
    expect(reg.get('never_contributed')).toBeUndefined();
    expect(reg.absentOwnerFor('never_contributed')).toBeNull();
  });
});
