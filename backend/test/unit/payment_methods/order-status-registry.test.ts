import { describe, expect, it } from 'vitest';
import {
  EnumOrderStatusRegistry,
  OrderStatusRegistryError,
} from '../../../src/modules/payment_methods/services/order-status-registry.port.js';

describe('EnumOrderStatusRegistry', () => {
  const reg = new EnumOrderStatusRegistry();

  it('lists the order-status enum as code+label options', () => {
    const codes = reg.list().map((o) => o.code);
    expect(codes).toEqual([
      'new',
      'pending',
      'paid',
      'processing',
      'shipment_ready',
      'shipment_sent',
      'completed',
      'on_hold',
      'cancelled',
    ]);
    expect(reg.list().find((o) => o.code === 'shipment_sent')?.label).toBe('Shipment Sent');
  });

  it('has() reflects membership', () => {
    expect(reg.has('paid')).toBe(true);
    expect(reg.has('confirmed')).toBe(false); // legacy code, no longer in the default set
  });

  it('assertValid throws on an unknown status', () => {
    expect(() => reg.assertValid('paid')).not.toThrow();
    expect(() => reg.assertValid('bogus')).toThrowError(OrderStatusRegistryError);
  });
});
