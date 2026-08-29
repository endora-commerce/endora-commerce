import type { PaymentSurface } from '@endora-commerce/contracts';
import type { PaymentMethod } from '../entities/payment-method.entity.js';
import type { PaymentAdapterRegistry } from './payment-adapter-registry.js';

/**
 * PaymentMethodEligibilityService (feature 034, FR-011/FR-012/FR-013/FR-014).
 *
 * Given the active methods (already filtered by status and the per-Organization
 * allow-list at the route), keeps only those whose adapter is currently
 * registered (FR-003 — a disabled adapter drops out) and whose surface
 * validator returns true. Sales-channel-assignment filtering is applied by the
 * caller via the membership bridge.
 */
export interface EligibilityContext {
  salesChannelId: string | null;
  organizationId: string | null;
  customerAccountId: string | null;
  surface: PaymentSurface;
}

export class PaymentMethodEligibilityService {
  constructor(private readonly registry: PaymentAdapterRegistry) {}

  async filter(methods: PaymentMethod[], ctx: EligibilityContext): Promise<PaymentMethod[]> {
    const eligible: PaymentMethod[] = [];
    for (const m of methods) {
      if (m.status !== 'active') continue;
      const adapter = this.registry.get(m.adapter);
      if (!adapter) continue; // unregistered adapter ⇒ not offered (FR-003)

      const eligCtx = {
        paymentMethod: {
          id: m.id,
          code: m.code,
          adapter: m.adapter,
          kind: m.kind,
          name: m.name,
          status: m.status,
          additionalPrice: Number(m.additionalPrice),
          statusOnPending: m.statusOnPending,
          statusOnSuccess: m.statusOnSuccess,
          statusOnFailure: m.statusOnFailure,
          salesChannelIds: [] as string[],
        },
        // Issue #103 — passed through, `null` included. It used to be
        // `?? ''`, and an empty string is not a channel id: an adapter that
        // reads its own per-channel configuration hit the settings seam guard
        // and dropped every method. `null` is the platform-wide tier.
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
