import type { FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SalesChannelMembershipService } from '../../kernel/sales-channels/sales-channel-membership.service.js';
import { PaymentMethod } from './entities/payment-method.entity.js';
import {
  registerPaymentMethodsAdminRoutes,
  registerPaymentMethodsPublicRoutes,
} from './routes.js';
import { EnumOrderStatusRegistry } from './services/order-status-registry.port.js';
import { PaymentMethodEligibilityService } from './services/payment-method-eligibility.js';
import { paymentAdapterRegistry } from './services/registry-singleton.js';

/**
 * `payment_methods` — the module `orders` was mounting (feature 072, wave 1,
 * T097).
 *
 * `orders/plugin.ts` imported both route files, seeded the built-in adapters,
 * built the order-status registry and mounted the lot inside `commerceModule`.
 * The same shape `audit_logs` had, with the same consequence: the payment-method
 * surface could not exist without the orders module being composed, and the
 * eligibility service that feature 034 wrote for it went unwired for two
 * releases because the wiring lived in somebody else's file.
 *
 * **The adapter registry stays the process singleton, on purpose.** `stripe`,
 * `autopay`, `tpay` and `payu` all `import { paymentAdapterRegistry }` and
 * register into it, so building a second one here and registering *that* under
 * the container name would give the platform two registries — precisely the
 * multi-instance defect this wave has already fixed twice (`currencies`,
 * `addresses`). Registering the existing instance as the container's value
 * keeps exactly one and makes the container the single place that decides what
 * it is, which is what turns the eventual replacement into a one-line change.
 *
 * (The singleton's own comment justifies itself with "the install-hook context
 * cannot carry services". That is stale: all four providers register from their
 * `plugin.ts`, at composition time, where the container is available. The
 * replacement belongs to the wave that converts them.)
 */

export const entities = [PaymentMethod];

export interface PaymentMethodsCradle {
  readonly emFactory: () => EntityManager;
  readonly requireAdmin: RequireAdminFactory;
  readonly salesChannelMembershipPort: SalesChannelMembershipService | undefined;
  /**
   * The two halves the allow-list is composed from (T138). This used to be one
   * `organizationPaymentMethodAllowList` contribution point that a root filled
   * with a closure fusing an actor read and an `organizations` table read.
   * `organizations` could not fill it once converted — a module may not write a
   * name another module owns — and the fusion was the defect anyway: one half
   * is a deployment input, the other is a port.
   */
  readonly customerOrganizationIdResolver: (req: FastifyRequest) => string | null;
  readonly organizationRestrictionPort: {
    allowedIdsFor(
      organizationId: string,
      kind: 'paymentMethodIds' | 'deliveryMethodIds' | 'warehouseIds',
    ): Promise<string[] | null>;
  };
  readonly paymentAdapterRegistry: typeof paymentAdapterRegistry;
  readonly paymentMethodEligibility: PaymentMethodEligibilityService;
  readonly paymentOrderStatusRegistry: EnumOrderStatusRegistry;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    // The built-in adapters are **not** seeded here: they live in `payments`
    // (`payments/adapters/built-in-adapters.ts`), so seeding them from this
    // module would be a reach into another module's internals to populate a
    // registry this one merely holds. A root contributes them, exactly as it
    // contributes the provider modules' adapters — which is the same job.
    paymentAdapterRegistry: ctx.asFunction(() => paymentAdapterRegistry).singleton(),

    paymentMethodEligibility: ctx
      .asFunction(
        (cradle: PaymentMethodsCradle) =>
          new PaymentMethodEligibilityService(cradle.paymentAdapterRegistry),
      )
      .singleton(),

    paymentOrderStatusRegistry: ctx.asFunction(() => new EnumOrderStatusRegistry()).singleton(),

  });

  ctx.routes(async (app) => {
    const {
      emFactory,
      requireAdmin,
      paymentAdapterRegistry: registry,
      paymentMethodEligibility,
      paymentOrderStatusRegistry,
    } = ctx.cradle<PaymentMethodsCradle>();
    const membership = ctx.cradle<PaymentMethodsCradle>().salesChannelMembershipPort;

    /**
     * Composed here from the two halves, and deliberately without a `catch`.
     * The root closure this replaces wrapped the read in one, so a
     * `ModuleDisabledError` from the port would have read as "no restriction" —
     * fail-open on the one path whose whole job is to restrict. The single
     * degrade that belongs here ("this caller has no Organization") is the
     * resolver's own `null`, and the other ("the Organization is gone") is in
     * `allowedIdsFor`'s return type.
     */
    const resolveAllowList = async (req: FastifyRequest): Promise<string[] | null> => {
      const cradle = ctx.cradle<PaymentMethodsCradle>();
      const organizationId = cradle.customerOrganizationIdResolver(req);
      if (organizationId === null) return null;
      return cradle.organizationRestrictionPort.allowedIdsFor(organizationId, 'paymentMethodIds');
    };

    await registerPaymentMethodsPublicRoutes(app, {
      emFactory,
      registry,
      eligibility: paymentMethodEligibility,
      resolveOrganizationPaymentMethodAllowList: resolveAllowList,
    });

    await registerPaymentMethodsAdminRoutes(app, {
      emFactory,
      requireAdmin,
      registry,
      orderStatusRegistry: paymentOrderStatusRegistry,
      ...(membership === undefined ? {} : { salesChannelMembership: membership }),
    });
  });
}
