import { describe, expect, it } from 'vitest';
import {
  EnumOrderStatusRegistry,
  OrderStatusRegistryError,
} from '../../../src/modules/payment_methods/services/order-status-registry.port.js';

describe('EnumOrderStatusRegistry', () => {
  const reg = new EnumOrderStatusRegistry();

  it('lists the order-status enum as code+label options', () => {
    const codes = reg.list().map((o) => o.code);
    expect(codes).toEqual(['new', 'confirmed', 'in_fulfilment', 'shipped', 'completed', 'cancelled']);
    expect(reg.list().find((o) => o.code === 'in_fulfilment')?.label).toBe('In Fulfilment');
  });

  it('has() reflects membership', () => {
    expect(reg.has('confirmed')).toBe(true);
    expect(reg.has('paid')).toBe(false); // payment-process status, not an order status
  });

  it('assertValid throws on an unknown status', () => {
    expect(() => reg.assertValid('confirmed')).not.toThrow();
    expect(() => reg.assertValid('bogus')).toThrowError(OrderStatusRegistryError);
  });
});
