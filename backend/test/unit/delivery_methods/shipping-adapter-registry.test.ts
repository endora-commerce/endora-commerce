import { describe, expect, it, vi } from 'vitest';
import type { ShippingAdapter } from '@b2b/contracts';
import { ShippingAdapterRegistry } from '../../../src/modules/delivery_methods/services/shipping-adapter-registry.js';

/**
 * T011 (Foundational) — the in-memory shipping adapter registry: register /
 * get / resolve / unregister / list, with last-writer-wins + a warning.
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
    reg.register(adapter('manual_courier'));
    reg.register(adapter('personal_pickup'));

    expect(reg.isRegistered('manual_courier')).toBe(true);
    expect(reg.get('personal_pickup')?.adapterKey).toBe('personal_pickup');
    expect(reg.resolve('manual_courier').adapterKey).toBe('manual_courier');
    expect(reg.list()).toEqual(['manual_courier', 'personal_pickup']);
  });

  it('resolve throws for an unknown key; get returns undefined', () => {
    const reg = new ShippingAdapterRegistry();
    expect(reg.get('nope')).toBeUndefined();
    expect(() => reg.resolve('nope')).toThrow(/no adapter registered/);
  });

  it('unregisters an adapter', () => {
    const reg = new ShippingAdapterRegistry();
    reg.register(adapter('x'));
    reg.unregister('x');
    expect(reg.isRegistered('x')).toBe(false);
  });

  it('warns and overwrites on a duplicate key (last-writer-wins)', () => {
    const warn = vi.fn();
    const reg = new ShippingAdapterRegistry({ warn });
    const first = adapter('dup');
    const second = adapter('dup');
    reg.register(first);
    reg.register(second);
    expect(warn).toHaveBeenCalledOnce();
    expect(reg.get('dup')).toBe(second);
  });
});
