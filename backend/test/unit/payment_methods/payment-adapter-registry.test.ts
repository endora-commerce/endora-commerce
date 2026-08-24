import { describe, expect, it, vi } from 'vitest';
import type { PaymentAdapter } from '@endora-commerce/contracts';
import { PaymentAdapterRegistry } from '../../../../packages/modules/payment_methods/src/backend/services/payment-adapter-registry.js';

const stubAdapter = (adapterKey: string): PaymentAdapter => ({
  adapterKey,
  type: 'bank_transfer',
  validateUseOnStorefront: async () => true,
  validateUseOnAdmin: async () => true,
  validateUseInApi: async () => true,
  onStorefrontOrderCreated: async () => ({ kind: 'none' }),
  onReceivePayment: async () => ({ result: 'success' }),
});

describe('PaymentAdapterRegistry', () => {
  it('registers and resolves an adapter by key', () => {
    const reg = new PaymentAdapterRegistry();
    const adapter = stubAdapter('bank_transfer');
    reg.register(adapter, 'payments');

    expect(reg.isRegistered('bank_transfer')).toBe(true);
    expect(reg.resolve('bank_transfer')).toBe(adapter);
    expect(reg.get('bank_transfer')).toBe(adapter);
    expect(reg.list()).toEqual(['bank_transfer']);
    expect(reg.ownerOf('bank_transfer')).toBe('payments');
  });

  it('returns undefined / throws for an unknown key', () => {
    const reg = new PaymentAdapterRegistry();
    expect(reg.get('missing')).toBeUndefined();
    expect(reg.isRegistered('missing')).toBe(false);
    expect(reg.ownerOf('missing')).toBeNull();
    expect(() => reg.resolve('missing')).toThrowError(/no adapter registered/i);
  });

  it('warns and overwrites when another module claims the key (last-writer-wins)', () => {
    const warn = vi.fn();
    const reg = new PaymentAdapterRegistry({ warn });
    const first = stubAdapter('pickup');
    const second = stubAdapter('pickup');

    reg.register(first, 'payments');
    reg.register(second, 'vendor');

    expect(warn).toHaveBeenCalledOnce();
    expect(reg.resolve('pickup')).toBe(second);
    expect(reg.list()).toEqual(['pickup']);
    expect(reg.ownerOf('pickup')).toBe('vendor');
  });

  it('is silent when the same owner re-registers (a re-composition, not a collision)', () => {
    const warn = vi.fn();
    const reg = new PaymentAdapterRegistry({ warn });
    reg.register(stubAdapter('pickup'), 'payments');
    reg.register(stubAdapter('pickup'), 'payments');
    expect(warn).not.toHaveBeenCalled();
  });

  it('unregisters an adapter (module disable)', () => {
    const reg = new PaymentAdapterRegistry();
    reg.register(stubAdapter('gateway'), 'payments');
    reg.unregister('gateway');
    expect(reg.isRegistered('gateway')).toBe(false);
  });

  /**
   * Issue #96 — the enumeration answers presence; the registration does not.
   * A boot hook runs whatever the module's effective state is, so gating the
   * push would leave a deactivate-then-activate cycle with a missing entry
   * until the next restart. Filtering here is what makes an absent gateway's
   * method disappear from checkout while the admin keeps seeing the row.
   */
  describe('presence filtering', () => {
    const build = (present: Set<string>): PaymentAdapterRegistry => {
      const reg = new PaymentAdapterRegistry(undefined, (id) => present.has(id));
      reg.register(stubAdapter('bank_transfer'), 'payments');
      reg.register(stubAdapter('stripe'), 'stripe');
      return reg;
    };

    it('skips an adapter whose owner is absent, and keeps the others', () => {
      const reg = build(new Set(['payments']));
      expect(reg.get('stripe')).toBeUndefined();
      expect(reg.isAvailable('stripe')).toBe(false);
      expect(reg.list()).toEqual(['bank_transfer']);
      expect(reg.get('bank_transfer')).toBeDefined();
    });

    it('keeps the registration itself — off is not uninstall', () => {
      const reg = build(new Set(['payments']));
      expect(reg.isRegistered('stripe')).toBe(true);
      expect(reg.listAll()).toEqual(['bank_transfer', 'stripe']);
      expect(reg.entry('stripe')?.module).toBe('stripe');
    });

    it('resolve reports the absent owner as a disabled module, not as missing', () => {
      const reg = build(new Set(['payments']));
      expect(() => reg.resolve('stripe')).toThrowError(/currently disabled/i);
    });

    it('offers everything again once the owner is back', () => {
      const reg = build(new Set(['payments', 'stripe']));
      expect(reg.get('stripe')).toBeDefined();
      expect(reg.list()).toEqual(['bank_transfer', 'stripe']);
    });
  });
});
