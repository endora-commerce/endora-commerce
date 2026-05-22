import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import type { AuditLogService } from '../audit_logs/services/audit-log-service.js';
import type { SalesChannelMembershipService } from '../sales_channels/services/sales-channel-membership.service.js';
import { CartService } from '../carts/services/cart-service.js';
import { CartUpsellService } from '../carts/services/cart-upsell-service.js';
import { CartCouponService } from '../carts/services/cart-coupon-service.js';
import { CartConversionService } from '../carts/services/cart-conversion-service.js';
import { CartAdminService } from '../carts/services/cart-admin-service.js';
import { CartAuditService } from '../carts/services/cart-audit-service.js';
import { CartApprovalService } from '../carts/services/cart-approval-service.js';
import { CartOrganizationVisibilityService } from '../carts/services/cart-organization-visibility-service.js';
import { registerCartsAdminRoutes } from '../carts/routes.admin.js';
import { registerCartsOrganizationRoutes } from '../carts/routes.organization.js';
import type { PricingService } from '../price_lists/services/pricing-service.js';
import type { PromotionService } from '../promotions/services/promotion-service.js';
import type { RfqService } from '../quote_requests/services/rfq-service.js';
import {
  OrderService,
  type CreditLimitPort,
  type OrderEventBus,
} from './services/order-service.js';
import { registerCartRoutes } from '../carts/routes.js';
import { registerOrderRoutes } from './routes.js';
import {
  registerDeliveryMethodsPublicRoutes,
  registerDeliveryMethodsAdminRoutes,
} from '../delivery_methods/routes.js';
import {
  registerPaymentMethodsPublicRoutes,
  registerPaymentMethodsAdminRoutes,
} from '../payment_methods/routes.js';
import { registerInvoicesAdminRoutes } from '../invoices/routes.admin.js';
import type { RequireAdminFactory } from '../catalog/routes.admin.js';

/**
 * Composition root for the commerce surface — carts + orders + invoice
 * download. CartService is also returned so the organizations module's login
 * flow can merge anonymous baskets.
 */

export interface OrdersModuleOptions {
  emFactory: () => EntityManager;
  eventBus: EventBus;
  requireCustomer: (req: FastifyRequest, reply: unknown) => Promise<void>;
  requireAdmin: RequireAdminFactory;
  resolveCustomerContext: (req: FastifyRequest) => {
    customerAccountId: string;
    organizationId: string;
    impersonatorAdminUserId?: string | null;
  };
  /** Audit-log writer; OrderService stamps order.place_on_behalf rows on impersonated checkouts. */
  auditLogService?: AuditLogService;
  /** Optional CreditLimit driver — wired by the credit_limits module composition root. */
  creditLimit?: CreditLimitPort;
  /**
   * Resolver for cart actor (customer OR anonymous). The test helper maps
   * stub cookies + real sessions here; production wires it to the real auth
   * plugin.
   */
  resolveCartActor: (req: FastifyRequest) => {
    customer?: { customerAccountId: string; organizationId: string | null };
    anonymousToken?: string;
  };
  /** Hook — returned cart service so the login route can merge anonymous baskets. */
  exposeCartService?: (service: CartService) => void;
  /**
   * Feature 005 / T027b — when injected, newly-created PaymentMethods and
   * DeliveryMethods auto-bind to the system-default Sales Channel (FR-011).
   */
  salesChannelMembership?: SalesChannelMembershipService;
  /**
   * Optional pricing-engine service. When wired, cart-line creation
   * uses `PricingService.resolveLinePrice()` for the unit price + the
   * displayMode='none' guard (T076 / T084). Foundation tests that
   * don't care about pricing engine semantics can omit it.
   */
  pricingService?: PricingService;
  /**
   * Feature 026 — optional gate that refuses cart-line-add, place-order, and
   * RFQ-submit when the Customer's Organization is not `active`. Threaded
   * through to both registerCartRoutes and registerOrderRoutes.
   */
  assertOrganizationCanTransact?: (organizationId: string) => Promise<void>;
  /**
   * Feature 026 US4 — When provided, the storefront payment-methods endpoint
   * intersects the active set with the caller's Organization allow-list.
   */
  resolveOrganizationPaymentMethodAllowList?: (req: FastifyRequest) => Promise<string[] | null>;
  /** Feature 026 US4 — same for delivery methods. */
  resolveOrganizationDeliveryMethodAllowList?: (req: FastifyRequest) => Promise<string[] | null>;
  /**
   * Feature 026 US6 — sales-rep ownership scoping for the admin orders list.
   * Platform admins return `{ allowAll: true }`; sales reps return the set
   * of organization ids they own.
   */
  resolveAdminOrdersScope?: (req: FastifyRequest) => Promise<
    | { allowAll: true }
    | { allowAll: false; allowedOrganizationIds: string[] }
  >;
  /**
   * Feature 027 — Cross-module port that pushes a cart line into one of
   * the buyer's shopping lists. The carts module calls this when the
   * buyer clicks "Save to Purchase List". Wired by the shopping_lists
   * module composition.
   */
  pushLineToShoppingList?: (input: {
    customerAccountId: string;
    shoppingListId: string;
    productId: string;
    variantId: string | null;
    quantity: number;
  }) => Promise<void>;
  /**
   * Feature 027 US2 — promotion engine used by the cart's coupon flow.
   * When provided, `POST /api/v1/cart/coupon` validates the code via
   * `applyToCart`. Optional so legacy compositions still build.
   */
  promotionService?: PromotionService;
  /**
   * Feature 027 US3 — getter for the RFQ service used by Cart → Quote
   * Request and Quote Request → Cart conversions. Getter (not direct
   * reference) so the QR module can be constructed AFTER commerceModule
   * in composition.ts; the closure resolves lazily at request time.
   */
  getRfqService?: () => RfqService | null;
  /**
   * Feature 027 US3 — port that appends a Shopping List's lines to the
   * buyer's cart. Wired by composition to ShoppingListService.convertToCart.
   */
  appendShoppingListToCart?: (input: {
    customerAccountId: string;
    organizationId: string | null;
    shoppingListId: string;
  }) => Promise<{
    cartId: string;
    appendedLineCount: number;
    droppedLines: Array<{ productId: string; productName: string; reason: string }>;
  }>;
}

export function commerceModule(options: OrdersModuleOptions) {
  return async (app: FastifyInstance): Promise<void> => {
    const cartService = new CartService(options.emFactory, options.pricingService);
    const orderService = new OrderService(
      options.emFactory,
      options.eventBus as OrderEventBus,
      options.auditLogService,
      options.creditLimit,
    );
    if (options.exposeCartService) options.exposeCartService(cartService);

    const cartUpsellService = new CartUpsellService(options.emFactory);
    const cartCouponService = options.promotionService
      ? new CartCouponService(options.emFactory, options.promotionService)
      : undefined;
    const cartAuditService = options.auditLogService
      ? new CartAuditService(options.emFactory, options.auditLogService)
      : undefined;
    const cartAdminService = cartAuditService
      ? new CartAdminService(options.emFactory, cartAuditService)
      : undefined;
    // Build a thin lazy-resolving wrapper so the QR service can be
    // injected after commerceModule is constructed (chicken-and-egg in
    // composition.ts).
    const lazyRfqProxy = options.getRfqService
      ? (new Proxy({} as RfqService, {
          get: (_target, prop) => {
            const svc = options.getRfqService?.();
            if (!svc) throw new Error('RfqService not yet available');
            return Reflect.get(svc, prop, svc);
          },
        }) as RfqService)
      : null;
    const cartConversionService = lazyRfqProxy
      ? new CartConversionService(options.emFactory, cartService, lazyRfqProxy)
      : undefined;

    await registerCartRoutes(app, {
      cartService,
      cartUpsellService,
      ...(cartCouponService ? { cartCouponService } : {}),
      ...(cartConversionService ? { cartConversionService } : {}),
      resolveCartActor: options.resolveCartActor,
      emFactory: options.emFactory,
      ...(options.assertOrganizationCanTransact
        ? { assertOrganizationCanTransact: options.assertOrganizationCanTransact }
        : {}),
      ...(options.pushLineToShoppingList
        ? { pushLineToShoppingList: options.pushLineToShoppingList }
        : {}),
      ...(options.appendShoppingListToCart
        ? { appendShoppingListToCart: options.appendShoppingListToCart }
        : {}),
    });
    await registerOrderRoutes(app, {
      orderService,
      emFactory: options.emFactory,
      requireCustomer: options.requireCustomer,
      requireAdmin: options.requireAdmin,
      resolveCustomerContext: options.resolveCustomerContext,
      ...(options.assertOrganizationCanTransact
        ? { assertOrganizationCanTransact: options.assertOrganizationCanTransact }
        : {}),
      ...(options.resolveAdminOrdersScope
        ? { resolveAdminOrdersScope: options.resolveAdminOrdersScope }
        : {}),
    });
    await registerDeliveryMethodsPublicRoutes(app, {
      emFactory: options.emFactory,
      ...(options.resolveOrganizationDeliveryMethodAllowList
        ? { resolveOrganizationDeliveryMethodAllowList: options.resolveOrganizationDeliveryMethodAllowList }
        : {}),
    });
    await registerPaymentMethodsPublicRoutes(app, {
      emFactory: options.emFactory,
      ...(options.resolveOrganizationPaymentMethodAllowList
        ? { resolveOrganizationPaymentMethodAllowList: options.resolveOrganizationPaymentMethodAllowList }
        : {}),
    });
    await registerDeliveryMethodsAdminRoutes(app, {
      emFactory: options.emFactory,
      requireAdmin: options.requireAdmin,
      ...(options.salesChannelMembership
        ? { salesChannelMembership: options.salesChannelMembership }
        : {}),
    });
    await registerPaymentMethodsAdminRoutes(app, {
      emFactory: options.emFactory,
      requireAdmin: options.requireAdmin,
      ...(options.salesChannelMembership
        ? { salesChannelMembership: options.salesChannelMembership }
        : {}),
    });
    await registerInvoicesAdminRoutes(app, {
      emFactory: options.emFactory,
      requireAdmin: options.requireAdmin,
    });

    // Feature 027 US4 — Organization-Administrator visibility + approval
    // workflow. Both services need the audit writer, so they ride on the
    // same `auditLogService` precondition as the admin surface above.
    if (cartAuditService) {
      const visibilityService = new CartOrganizationVisibilityService(options.emFactory);
      const cartApprovalService = new CartApprovalService(options.emFactory, cartAuditService);
      await registerCartsOrganizationRoutes(app, {
        cartService,
        cartApprovalService,
        visibilityService,
        emFactory: options.emFactory,
        resolveCartActor: options.resolveCartActor,
      });
    }

    if (cartAdminService) {
      await registerCartsAdminRoutes(app, {
        cartAdminService,
        requireAdmin: options.requireAdmin,
        resolveAdminUserId: (req: FastifyRequest): string | null => {
          // Production rig: `request.actor` (set by the auth plugin).
          // Test rig: `request.testActor` (set by test-actors.ts).
          const prodActor = (req as { actor?: { kind?: string; adminUserId?: string } }).actor;
          if (prodActor?.kind === 'admin' && prodActor.adminUserId) return prodActor.adminUserId;
          const testActor = (req as { testActor?: { kind?: string; adminUserId?: string } }).testActor;
          if (testActor?.kind === 'admin' && testActor.adminUserId) return testActor.adminUserId;
          return null;
        },
      });
    }
  };
}
