import { describe, expect, it } from 'vitest';
import {
  EnumOrderStatusRegistry,
  OrderStatusRegistryError,
} from '../../../src/modules/delivery_methods/services/order-status-registry.port.js';

/**
 * T012 (Foundational) — the enum-backed OrderStatusRegistry used by the
 * shipping module to validate statusOnSuccess / statusOnFailure references.
 */
describe('EnumOrderStatusRegistry (shipping)', () => {
  const reg = new EnumOrderStatusRegistry();

  it('lists the seed order statuses with humanized labels', () => {
    const codes = reg.list().map((o) => o.code);
    expect(codes).toContain('shipped');
    expect(codes).toContain('in_fulfilment');
    const inFulfilment = reg.list().find((o) => o.code === 'in_fulfilment');
    expect(inFulfilment?.label).toBe('In Fulfilment');
  });

  it('has() reflects membership', () => {
    expect(reg.has('shipped')).toBe(true);
    expect(reg.has('nonsense')).toBe(false);
  });

  it('assertValid throws OrderStatusRegistryError for an unknown status', () => {
    expect(() => reg.assertValid('shipped')).not.toThrow();
    expect(() => reg.assertValid('nonsense')).toThrow(OrderStatusRegistryError);
  });
});
