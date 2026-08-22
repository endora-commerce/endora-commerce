import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { PaymentAdapter, PaymentEligibilityContext } from '@endora-commerce/contracts';
import { PaymentAdapterRegistry } from '../../../src/modules/payment_methods/services/payment-adapter-registry.js';
import { PaymentMethodEligibilityService } from '../../../src/modules/payment_methods/services/payment-method-eligibility.js';
import { PaymentMethod } from '../../../src/modules/payment_methods/entities/payment-method.entity.js';
import { SettingsChannelIdInvalid } from '../../../src/kernel/settings/settings.service.js';

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

  /**
   * Issue #103 — "no channel" reaches the adapter as `null`.
   *
   * The service used to hand adapters `ctx.salesChannelId ?? ''`, and an empty
   * string is neither a channel id nor a spelling of "platform-wide": a settings
   * read made from it throws `SettingsChannelIdInvalid` at the D-42 seam guard,
   * so a gateway adapter that resolves its own configuration answered "not
   * eligible" for every method whenever the channel was unresolved. `null` is
   * the platform-wide tier and resolves.
   */
  it('hands an unresolved channel to the adapter as null, so it reads platform-wide', async () => {
    const seen: Array<string | null> = [];
    const settings = {
      async get<T>(code: string, salesChannelId: string | null, schema: z.ZodType<T>): Promise<T> {
        if (salesChannelId !== null) throw new SettingsChannelIdInvalid(code, salesChannelId);
        return schema.parse(true);
      },
    };
    const configReading: PaymentAdapter = {
      adapterKey: 'reads-config',
      type: 'gateway',
      validateUseOnStorefront: async (ctx: PaymentEligibilityContext) => {
        seen.push(ctx.salesChannelId);
        return settings.get('payment_methods.enabled', ctx.salesChannelId, z.boolean());
      },
      validateUseOnAdmin: async () => true,
      validateUseInApi: async () => true,
      onStorefrontOrderCreated: async () => ({ kind: 'none' }),
      onReceivePayment: async () => ({ result: 'success' }),
    };
    const reg = new PaymentAdapterRegistry();
    reg.register(configReading, 'payment_methods');
    const svc = new PaymentMethodEligibilityService(reg);

    const result = await svc.filter([method('a', 'reads-config')], {
      salesChannelId: null,
      organizationId: null,
      customerAccountId: null,
      surface: 'storefront',
    });

    expect(seen).toEqual([null]);
    expect(result.map((m) => m.code)).toEqual(['a']);
  });
});
