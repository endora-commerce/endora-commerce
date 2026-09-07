import { describe, expect, it } from 'vitest';
import {
  EnumOrderStatusRegistry,
  OrderStatusRegistryError,
} from './order-status-registry.port.js';

/**
 * T012 (Foundational) — the enum-backed OrderStatusRegistry used by the
 * shipping module to validate statusOnSuccess / statusOnFailure references.
 */
describe('EnumOrderStatusRegistry (shipping)', () => {
  const reg = new EnumOrderStatusRegistry();

  it('lists the seed order statuses with humanized labels', () => {
    const codes = reg.list().map((o) => o.code);
    expect(codes).toContain('shipment_sent');
    expect(codes).toContain('processing');
    const shipmentSent = reg.list().find((o) => o.code === 'shipment_sent');
    expect(shipmentSent?.label).toBe('Shipment Sent');
  });

  it('has() reflects membership', () => {
    expect(reg.has('shipment_sent')).toBe(true);
    expect(reg.has('nonsense')).toBe(false);
  });

  it('assertValid throws OrderStatusRegistryError for an unknown status', () => {
    expect(() => reg.assertValid('shipment_sent')).not.toThrow();
    expect(() => reg.assertValid('nonsense')).toThrow(OrderStatusRegistryError);
  });
});
