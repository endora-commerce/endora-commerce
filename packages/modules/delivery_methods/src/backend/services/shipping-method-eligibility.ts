import type { ShippingSurface } from '@endora-commerce/contracts';
import type { DeliveryMethod } from '../entities/delivery-method.entity.js';
import type { ShippingAdapterRegistry } from './shipping-adapter-registry.js';

/**
 * ShippingMethodEligibilityService (feature 035, FR-011/FR-012/FR-013/FR-014).
 *
 * Given the active methods (already filtered by status and the per-Organization
 * allow-list at the route), keeps only those whose adapter is currently
 * registered (FR-003 — a disabled adapter drops out) and whose surface
 * validator returns true. Sales-channel-assignment filtering is applied by the
 * caller via the membership bridge.
 */
export interface ShippingEligibilityContext {
  salesChannelId: string | null;
  organizationId: string | null;
  customerAccountId: string | null;
  surface: ShippingSurface;
}

export class ShippingMethodEligibilityService {
  constructor(private readonly registry: ShippingAdapterRegistry) {}

  async filter(
    methods: DeliveryMethod[],
    ctx: ShippingEligibilityContext,
  ): Promise<DeliveryMethod[]> {
    const eligible: DeliveryMethod[] = [];
    for (const m of methods) {
      if (m.status !== 'active') continue;
      const adapter = this.registry.get(m.adapter);
      if (!adapter) continue; // unregistered adapter ⇒ not offered (FR-003)

      const eligCtx = {
        deliveryMethod: {
          id: m.id,
          code: m.code,
          adapter: m.adapter,
          name: m.name,
          cost: { amount: Number(m.cost), currency: m.currency },
          status: m.status,
          statusOnSuccess: m.statusOnSuccess,
          statusOnFailure: m.statusOnFailure,
          salesChannelIds: [] as string[],
          rendererKey: adapter.renderers?.storefront ?? null,
        },
        // Issue #103 — passed through, `null` included. See the payment twin:
        // `?? ''` is not a spelling of "platform-wide", it is a value the
        // settings seam guard rejects.
        salesChannelId: ctx.salesChannelId,
        organizationId: ctx.organizationId,
        customerAccountId: ctx.customerAccountId,
        surface: ctx.surface,
      };

      const ok =
        ctx.surface === 'admin'
          ? await adapter.validateUseOnAdmin(eligCtx)
          : ctx.surface === 'api'
            ? await adapter.validateUseInApi(eligCtx)
            : await adapter.validateUseOnStorefront(eligCtx);
      if (ok) eligible.push(m);
    }
    return eligible;
  }
}
