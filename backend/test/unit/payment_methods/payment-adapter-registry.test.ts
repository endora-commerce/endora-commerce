import { describe, expect, it, vi } from 'vitest';
import type { PaymentAdapter } from '@b2b/contracts';
import { PaymentAdapterRegistry } from '../../../src/modules/payment_methods/services/payment-adapter-registry.js';

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
    reg.register(adapter);

    expect(reg.isRegistered('bank_transfer')).toBe(true);
    expect(reg.resolve('bank_transfer')).toBe(adapter);
    expect(reg.get('bank_transfer')).toBe(adapter);
    expect(reg.list()).toEqual(['bank_transfer']);
  });

  it('returns undefined / throws for an unknown key', () => {
    const reg = new PaymentAdapterRegistry();
    expect(reg.get('missing')).toBeUndefined();
    expect(reg.isRegistered('missing')).toBe(false);
    expect(() => reg.resolve('missing')).toThrowError(/no adapter registered/i);
  });

  it('warns and overwrites on duplicate-key registration (last-writer-wins)', () => {
    const warn = vi.fn();
    const reg = new PaymentAdapterRegistry({ warn });
    const first = stubAdapter('pickup');
    const second = stubAdapter('pickup');

    reg.register(first);
    reg.register(second);

    expect(warn).toHaveBeenCalledOnce();
    expect(reg.resolve('pickup')).toBe(second);
    expect(reg.list()).toEqual(['pickup']);
  });

  it('unregisters an adapter (module disable)', () => {
    const reg = new PaymentAdapterRegistry();
    reg.register(stubAdapter('gateway'));
    reg.unregister('gateway');
    expect(reg.isRegistered('gateway')).toBe(false);
  });
});
