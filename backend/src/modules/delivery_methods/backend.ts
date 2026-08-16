import type { FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleContext } from '../../kernel/index.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
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
  readonly auditLogService: AuditLogService;
  readonly salesChannelMembershipPort: SalesChannelMembershipService | undefined;
  /** The two halves the allow-list is composed from — see the payment twin (T138). */
  readonly customerOrganizationIdResolver: (req: FastifyRequest) => string | null;
  readonly organizationRestrictionPort: {
    allowedIdsFor(
      organizationId: string,
      kind: 'paymentMethodIds' | 'deliveryMethodIds' | 'warehouseIds',
    ): Promise<string[] | null>;
  };
  readonly shippingAdapterRegistry: typeof shippingAdapterRegistry;
  readonly shippingMethodEligibility: ShippingMethodEligibilityService;
  readonly shippingOrderStatusRegistry: EnumOrderStatusRegistry;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    shippingAdapterRegistry: ctx.asFunction(() => shippingAdapterRegistry).singleton(),

    shippingMethodEligibility: ctx
      .asFunction(
        (cradle: DeliveryMethodsCradle) =>
          new ShippingMethodEligibilityService(cradle.shippingAdapterRegistry),
      )
      .singleton(),

    shippingOrderStatusRegistry: ctx.asFunction(() => new EnumOrderStatusRegistry()).singleton(),

  });

  ctx.routes(async (app) => {
    const {
      emFactory,
      requireAdmin,
      shippingAdapterRegistry: registry,
      shippingMethodEligibility,
      shippingOrderStatusRegistry,
    } = ctx.cradle<DeliveryMethodsCradle>();
    const membership = ctx.cradle<DeliveryMethodsCradle>().salesChannelMembershipPort;

    /** Composed from the two halves, without a `catch` — see the payment twin. */
    const resolveAllowList = async (req: FastifyRequest): Promise<string[] | null> => {
      const cradle = ctx.cradle<DeliveryMethodsCradle>();
      const organizationId = cradle.customerOrganizationIdResolver(req);
      if (organizationId === null) return null;
      return cradle.organizationRestrictionPort.allowedIdsFor(organizationId, 'deliveryMethodIds');
    };

    await registerDeliveryMethodsPublicRoutes(app, {
      emFactory,
      registry,
      eligibility: shippingMethodEligibility,
      resolveOrganizationDeliveryMethodAllowList: resolveAllowList,
    });

    await registerDeliveryMethodsAdminRoutes(app, {
      emFactory,
      requireAdmin,
      auditLogService: ctx.cradle<DeliveryMethodsCradle>().auditLogService,
      registry,
      orderStatusRegistry: shippingOrderStatusRegistry,
      ...(membership === undefined ? {} : { salesChannelMembership: membership }),
    });
  });

  /**
   * The two shipping kinds this module implements, pushed into the registry it
   * holds — from a boot hook rather than from the registry's own factory
   * (issue #96).
   *
   * Seeding inside the factory tied "which adapters exist" to whoever resolved
   * the name first, and left the entries unowned: nothing recorded that these
   * two came from this module, so the enumeration had nothing to filter on when
   * an operator switched a contributor off. A boot hook runs once per
   * composition, regardless of effective state, which is exactly the D-39
   * contract — the push is ungated, the *enumeration* answers presence.
   */
  ctx.onBoot(() => {
    const registry = ctx.cradle<DeliveryMethodsCradle>().shippingAdapterRegistry;
    for (const adapter of builtInShippingAdapters()) {
      registry.register(adapter, 'delivery_methods');
    }
  });
}
