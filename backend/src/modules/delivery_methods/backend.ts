import type { FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SalesChannelMembershipService } from '../../kernel/sales-channels/sales-channel-membership.service.js';
import { builtInShippingAdapters } from './adapters/built-in-adapters.js';
import { DeliveryMethod } from './entities/delivery-method.entity.js';
import {
  registerDeliveryMethodsAdminRoutes,
  registerDeliveryMethodsPublicRoutes,
} from './routes.js';
import { EnumOrderStatusRegistry } from './services/order-status-registry.port.js';
import { shippingAdapterRegistry } from './services/registry-singleton.js';
import { ShippingMethodEligibilityService } from './services/shipping-method-eligibility.js';

/**
 * `delivery_methods` — the payment twin's mirror image (feature 072, wave 1,
 * T095).
 *
 * Converted alongside `payment_methods` rather than after it. The two are
 * mounted from the same forty lines of `orders/plugin.ts` and share the same
 * registry, eligibility and order-status shape, so converting one and not the
 * other would leave `commerceModule` half-rewired — an intermediate state that
 * costs more to hold than the pair costs to do together.
 *
 * One asymmetry survives the pairing, and it is not cosmetic: this module's
 * built-in adapters live in **its own** `adapters/built-in-adapters.ts`, while
 * the payment built-ins live in `payments`. So this module seeds its own and
 * `payment_methods` does not — a root contributes those. Seeding is done in the
 * factory and is idempotent because a provider module's plugin may already have
 * registered into the same instance.
 *
 * The registry stays the process singleton for the reason spelled out in
 * `payment_methods/backend.ts`: replacing it while the provider modules still
 * import it directly would create a second registry, which is the defect this
 * wave keeps removing rather than adding.
 */

export const entities = [DeliveryMethod];

export interface DeliveryMethodsCradle {
  readonly emFactory: () => EntityManager;
  readonly requireAdmin: RequireAdminFactory;
  readonly salesChannelMembershipPort: SalesChannelMembershipService | undefined;
  readonly organizationDeliveryMethodAllowList:
    | ((req: FastifyRequest) => Promise<string[] | null>)
    | undefined;
  readonly shippingAdapterRegistry: typeof shippingAdapterRegistry;
  readonly shippingMethodEligibility: ShippingMethodEligibilityService;
  readonly shippingOrderStatusRegistry: EnumOrderStatusRegistry;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    shippingAdapterRegistry: ctx
      .asFunction(() => {
        for (const adapter of builtInShippingAdapters()) {
          if (!shippingAdapterRegistry.isRegistered(adapter.adapterKey)) {
            shippingAdapterRegistry.register(adapter);
          }
        }
        return shippingAdapterRegistry;
      })
      .singleton(),

    shippingMethodEligibility: ctx
      .asFunction(
        (cradle: DeliveryMethodsCradle) =>
          new ShippingMethodEligibilityService(cradle.shippingAdapterRegistry),
      )
      .singleton(),

    shippingOrderStatusRegistry: ctx.asFunction(() => new EnumOrderStatusRegistry()).singleton(),

    // Contribution point, defaulted absent by its owner — see the payment twin.
    organizationDeliveryMethodAllowList: ctx
      .asFunction((): ((req: FastifyRequest) => Promise<string[] | null>) | undefined => undefined)
      .singleton(),
  });

  ctx.routes(async (app) => {
    const {
      emFactory,
      requireAdmin,
      shippingAdapterRegistry: registry,
      shippingMethodEligibility,
      shippingOrderStatusRegistry,
    } = ctx.cradle<DeliveryMethodsCradle>();
    const allowList = ctx.cradle<DeliveryMethodsCradle>().organizationDeliveryMethodAllowList;
    const membership = ctx.cradle<DeliveryMethodsCradle>().salesChannelMembershipPort;

    await registerDeliveryMethodsPublicRoutes(app, {
      emFactory,
      registry,
      eligibility: shippingMethodEligibility,
      ...(allowList === undefined
        ? {}
        : { resolveOrganizationDeliveryMethodAllowList: allowList }),
    });

    await registerDeliveryMethodsAdminRoutes(app, {
      emFactory,
      requireAdmin,
      registry,
      orderStatusRegistry: shippingOrderStatusRegistry,
      ...(membership === undefined ? {} : { salesChannelMembership: membership }),
    });
  });
}
