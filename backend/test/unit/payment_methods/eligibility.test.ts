import { describe, expect, it } from 'vitest';
import type { PaymentAdapter } from '@b2b/contracts';
import { PaymentAdapterRegistry } from '../../../src/modules/payment_methods/services/payment-adapter-registry.js';
import { PaymentMethodEligibilityService } from '../../../src/modules/payment_methods/services/payment-method-eligibility.js';
import { PaymentMethod } from '../../../src/modules/payment_methods/entities/payment-method.entity.js';

const adapter = (key: string, storefront: boolean): PaymentAdapter => ({
  adapterKey: key,
  type: 'bank_transfer',
  validateUseOnStorefront: async () => storefront,
  validateUseOnAdmin: async () => true,
  validateUseInApi: async () => true,
  onStorefrontOrderCreated: async () => ({ kind: 'none' }),
  onReceivePayment: async () => ({ result: 'success' }),
});

const method = (code: string, adapterKey: string): PaymentMethod => {
  const m = new PaymentMethod();
  m.code = code;
  m.adapter = adapterKey;
  m.kind = 'bank_transfer';
  m.name = { default: code };
  m.status = 'active';
  m.additionalPrice = '0';
  m.statusOnPending = 'new';
  m.statusOnSuccess = 'confirmed';
  m.statusOnFailure = 'cancelled';
  return m;
};

describe('PaymentMethodEligibilityService', () => {
  it('keeps methods whose adapter validator returns true', async () => {
    const reg = new PaymentAdapterRegistry();
    reg.register(adapter('ok', true), 'payments');
    reg.register(adapter('blocked', false), 'payments');
    const svc = new PaymentMethodEligibilityService(reg);

    const result = await svc.filter([method('a', 'ok'), method('b', 'blocked')], {
      salesChannelId: null,
      organizationId: null,
      customerAccountId: null,
      surface: 'storefront',
    });

    expect(result.map((m) => m.code)).toEqual(['a']);
  });

  it('excludes methods whose adapter is not registered', async () => {
    const reg = new PaymentAdapterRegistry();
    const svc = new PaymentMethodEligibilityService(reg);
    const result = await svc.filter([method('a', 'missing')], {
      salesChannelId: null,
      organizationId: null,
      customerAccountId: null,
      surface: 'storefront',
    });
    expect(result).toHaveLength(0);
  });
});
