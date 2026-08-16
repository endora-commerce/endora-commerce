import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { ShippingAdapter, ShippingEligibilityContext } from '@b2b/contracts';
import { ShippingAdapterRegistry } from '../../../src/modules/delivery_methods/services/shipping-adapter-registry.js';
import { ShippingMethodEligibilityService } from '../../../src/modules/delivery_methods/services/shipping-method-eligibility.js';
import { DeliveryMethod } from '../../../src/modules/delivery_methods/entities/delivery-method.entity.js';
import { SettingsChannelIdInvalid } from '../../../src/kernel/settings/settings.service.js';

/**
 * T024 (US2) — the eligibility filter keeps active methods whose adapter is
 * registered and whose surface validator returns true.
 */
const adapter = (key: string, storefront: boolean): ShippingAdapter => ({
  adapterKey: key,
  validateUseOnStorefront: async () => storefront,
  validateUseOnAdmin: async () => true,
  validateUseInApi: async () => true,
  onOrderCreated: async () => {},
  onShipmentCreated: async () => ({ kind: 'pending' }),
  onReceiveShipment: async () => ({ result: 'success' }),
});

const method = (code: string, adapterKey: string): DeliveryMethod => {
  const m = new DeliveryMethod();
  m.code = code;
  m.adapter = adapterKey;
  m.name = { default: code };
  m.cost = '0';
  m.currency = 'PLN';
  m.status = 'active';
  m.statusOnSuccess = 'shipped';
  m.statusOnFailure = 'in_fulfilment';
  return m;
};

describe('ShippingMethodEligibilityService', () => {
  it('keeps methods whose adapter validator returns true', async () => {
    const reg = new ShippingAdapterRegistry();
    reg.register(adapter('ok', true), 'delivery_methods');
    reg.register(adapter('blocked', false), 'delivery_methods');
    const svc = new ShippingMethodEligibilityService(reg);

    const result = await svc.filter([method('a', 'ok'), method('b', 'blocked')], {
      salesChannelId: null,
      organizationId: null,
      customerAccountId: null,
      surface: 'storefront',
    });

    expect(result.map((m) => m.code)).toEqual(['a']);
  });

  it('excludes methods whose adapter is not registered', async () => {
    const reg = new ShippingAdapterRegistry();
    const svc = new ShippingMethodEligibilityService(reg);
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
   * so an adapter that consults its own configuration answered "not eligible"
   * for every method whenever the channel was unresolved. `null` is the
   * platform-wide tier and resolves.
   */
  it('hands an unresolved channel to the adapter as null, so it reads platform-wide', async () => {
    const seen: Array<string | null> = [];
    const settings = {
      async get<T>(code: string, salesChannelId: string | null, schema: z.ZodType<T>): Promise<T> {
        if (salesChannelId !== null) throw new SettingsChannelIdInvalid(code, salesChannelId);
        return schema.parse(true);
      },
    };
    const configReading: ShippingAdapter = {
      adapterKey: 'reads-config',
      validateUseOnStorefront: async (ctx: ShippingEligibilityContext) => {
        seen.push(ctx.salesChannelId);
        return settings.get('delivery_methods.enabled', ctx.salesChannelId, z.boolean());
      },
      validateUseOnAdmin: async () => true,
      validateUseInApi: async () => true,
      onOrderCreated: async () => {},
      onShipmentCreated: async () => ({ kind: 'pending' }),
      onReceiveShipment: async () => ({ result: 'success' }),
    };
    const reg = new ShippingAdapterRegistry();
    reg.register(configReading, 'delivery_methods');
    const svc = new ShippingMethodEligibilityService(reg);

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
