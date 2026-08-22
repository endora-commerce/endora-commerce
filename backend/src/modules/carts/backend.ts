import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import { ERROR_CODES } from '@b2b/contracts';
import type {
  CartQueryPort,
  CartReadPort,
  CartWritePort,
  CatalogProductReadPort,
  CustomerAccountReadPort,
  LinePricePort,
  OrganizationCartApprovalWritePort,
  OrganizationDetailsPort,
  PromotionApplyPort,
  PromotionCodePort,
  QuoteRequestReadPort,
  RfqCustomerPort,
} from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { OrganizationReadPort } from '../../kernel/ports/organizations.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SalesChannelMembershipPort } from '../../kernel/ports/sales-channel.js';
import type { SettingsReadPort } from '../../kernel/ports/settings.js';
import { abandonmentSettingsReaders } from './services/cart-abandonment-settings.js';
import { CartQueryService } from './services/cart-query-service.js';
import { CartReadService, createCartWritePort } from './services/cart-read-port.js';
import { CartService } from './services/cart-service.js';
import { CartUpsellService } from './services/cart-upsell-service.js';
import { CartCouponService } from './services/cart-coupon-service.js';
import { CartConversionService } from './services/cart-conversion-service.js';
import { CartAdminService } from './services/cart-admin-service.js';
import { CartAuditService } from './services/cart-audit-service.js';
import { CartApprovalService } from './services/cart-approval-service.js';
import { CartOrganizationVisibilityService } from './services/cart-organization-visibility-service.js';
import { CartRecomputeCache } from './services/cart-recompute-cache.js';
import { CartPricingRecompute } from './services/cart-pricing-recompute.js';
import { CartAbandonmentWorker } from './services/cart-abandonment-worker.js';
import { registerCartRoutes, type CartsDeps } from './routes.js';
import { registerCartsAdminRoutes } from './routes.admin.js';
import { registerCartsOrganizationRoutes } from './routes.organization.js';

/**
 * `carts` — the module that owned 4593 lines and registered none of them
 * (feature 072, wave 3, T136).
 *
 * Every service here was constructed inside `orders/plugin.ts`, and most of them
 * **conditionally**: `options.auditLogService ? new CartAuditService(…) :
 * undefined`, and so on down a chain where each `undefined` disabled the next
 * thing. That made feature availability a function of which arguments a
 * composition root happened to pass, which is the defect T141's task text names
 * for `orders` and which `languages` produced in wave 1 as a live bug.
 *
 * The stake was not theoretical. Without `CartRecomputeCache` there is no
 * `CartPricingRecompute`, so every full-cart read returns the snapshotted
 * `unit_price` instead of a re-resolved engine price. Without `CartAuditService`
 * there is no `CartApprovalService`, so the organization approval routes never
 * registered at all — the route *surface* was a function of arguments, the same
 * finding `shopping_lists` produced in T133.
 *
 * All thirteen registrations are unconditional now. `auditLogService` and
 * `redis` are kernel-owned names, so there is nothing left to branch on.
 *
 * **`cartService` is a port, and the outward edge is a different one.** Four
 * modules read the cart service — `orders`, `shopping_lists`, `quick_order` and
 * this module's own routes — and all four sit downstream in the manifest graph,
 * so it is an ordinary `providePort`. What points *outward* is
 * `pushLineToShoppingList` / `appendShoppingListToCart`: `carts` reaching into
 * `shopping_lists`, which cannot be a port because `shopping_lists → orders →
 * carts` would close a cycle. That is {@link CartsCradle.cartShoppingListBridge}
 * — a contribution point **this module owns**, defaulted to a refusal naming the
 * absent module, which is the direction `shipmentEmailSender` uses and the
 * mirror image of the `shoppingListServiceSink` this conversion retires.
 *
 * The `RfqService` `Proxy` that lived in `orders/plugin.ts` is gone with it:
 * it existed only to late-bind a service that `quote_requests` has provided as
 * a real port since T132.
 *
 * The two abandonment settings are read here, through the settings port, rather
 * than resolved by each root. They are `carts.abandonment.*` — this module's own
 * knobs — and the identical try/catch-to-default stood in both compositions.
 */

/**
 * How this composition reaches `shopping_lists`, which `carts` may not import.
 *
 * Both shapes are taken from the route module's own option types rather than
 * restated, so a change there is a type error here instead of a drift.
 */
export interface CartShoppingListBridge {
  readonly pushLineToShoppingList: NonNullable<CartsDeps['pushLineToShoppingList']>;
  readonly appendShoppingListToCart: NonNullable<CartsDeps['appendShoppingListToCart']>;
}

/** What `carts` resolves from the container, and the names it owns. */
export interface CartsCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly redis: Redis;
  readonly requireAdmin: RequireAdminFactory;
  readonly settingsReadPort: SettingsReadPort;
  /**
   * Feature 075, Phase C — the six ports every service here used to reach by
   * importing another module's class or entity. Each is a contract type from
   * `@b2b/contracts`, never the provider's class, and each is resolved lazily
   * by a string literal so a switched-off owner answers at the call.
   */
  readonly pricingService: LinePricePort;
  readonly promotionService: PromotionApplyPort;
  readonly promotionCodePort: PromotionCodePort;
  readonly rfqService: RfqCustomerPort;
  readonly quoteRequestReadPort: QuoteRequestReadPort;
  readonly catalogProductReadPort: CatalogProductReadPort;
  readonly customerAccountReadPort: CustomerAccountReadPort;
  readonly organizationDetailsPort: OrganizationDetailsPort;
  /** Root-shaped: production reads `request.actor`, the harness `request.testActor`. */
  readonly cartActorResolver: CartsDeps['resolveCartActor'];
  /**
   * The tenancy read port (T138). Was `organizationTransactGuard`, a closure
   * each root wrote over `OrganizationContextService` — and which the harness
   * registered as `async () => undefined`, so feature 026's rule that an
   * unapproved Organization may not transact was enforced in production and by
   * no test at all.
   */
  readonly organizationReadPort: OrganizationReadPort;
  /** Contribution point: absent means save-to-list and list-to-cart refuse. */
  readonly cartShoppingListBridge: CartShoppingListBridge;
  /** Contribution point: absent means the sweep flips status and sends nothing. */
  readonly cartAbandonmentNotifier:
    | ConstructorParameters<typeof CartAbandonmentWorker>[0]['dispatchNotification']
    | undefined;
  readonly cartService: CartService;
  readonly cartAuditService: CartAuditService;
  readonly cartApprovalService: CartApprovalService;
  readonly cartRecomputeCache: CartRecomputeCache;
  readonly cartAbandonmentWorker: CartAbandonmentWorker;
}

/** Refuses in the shape Constitution XVII item 3 requires: an explicit 503. */
function refuseShoppingList(): CartShoppingListBridge {
  const refuse = async (): Promise<never> => {
    throw new HttpError(
      503,
      ERROR_CODES.MODULE_DISABLED,
      'Shopping lists are not available in this deployment.',
      { module: 'shopping_lists' },
    );
  };
  return { pushLineToShoppingList: refuse, appendShoppingListToCart: refuse };
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    // Contribution point, defaulted to a refusal that names the absent module
    // rather than a 404 that does not.
    cartShoppingListBridge: ctx
      .asFunction((): CartShoppingListBridge => refuseShoppingList())
      .singleton(),

    // Contribution point: a deployment with no outbound mail flips the cart's
    // status and sends nothing, which is a coherent state.
    cartAbandonmentNotifier: ctx
      .asFunction((): CartsCradle['cartAbandonmentNotifier'] => undefined)
      .singleton(),

    cartRecomputeCache: ctx
      .asFunction(({ redis }: CartsCradle) => new CartRecomputeCache(redis))
      .singleton(),

    cartAuditService: ctx
      .asFunction(
        ({ emFactory, auditLogService }: CartsCradle) =>
          new CartAuditService(emFactory, auditLogService),
      )
      .singleton(),

    cartApprovalService: ctx
      .asFunction(
        ({ emFactory, cartAuditService }: CartsCradle) =>
          new CartApprovalService(
            emFactory,
            cartAuditService,
            lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
            lazyPort<OrganizationCartApprovalWritePort>(
              ctx,
              'organizationCartApprovalWritePort',
            ),
            lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
          ),
      )
      .singleton(),

    cartAbandonmentWorker: ctx
      .asFunction(
        ({ emFactory, cartAuditService }: CartsCradle) =>
          new CartAbandonmentWorker({
            emFactory,
            cartAuditService,
            /**
             * This module's own settings, read through the port it holds — the
             * identical try/catch-to-default stood in both roots before T136,
             * and in the ops CLI until issue #54. It lives in one file now
             * (`services/cart-abandonment-settings.ts`), which also carries the
             * D-41/D-43 history of what these two reads used to get wrong.
             *
             * The thunk is what keeps the port read lazy: a gate captured into
             * this singleton would keep answering after `settings` is switched
             * off.
             */
            ...abandonmentSettingsReaders(
              () => ctx.cradle<CartsCradle>().settingsReadPort,
            ),
            dispatchNotification: async (input): Promise<void> => {
              await ctx.cradle<CartsCradle>().cartAbandonmentNotifier?.(input);
            },
          }),
      )
      .singleton(),
  });

  ctx.di.providePort(
    'cartService',
    ctx
      .asFunction(
        ({ emFactory, cartApprovalService, cartAuditService, cartRecomputeCache }: CartsCradle) =>
          new CartService(
            emFactory,
            lazyPort<LinePricePort>(ctx, 'pricingService'),
            lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
            lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
            lazyPort<SalesChannelMembershipPort>(ctx, 'salesChannelMembershipPort'),
            cartApprovalService,
            cartAuditService,
            cartRecomputeCache,
          ),
      )
      .singleton(),
  );

  // ---------------------------------------------------------------------------
  // Feature 075, Phase P — the published surface.
  //
  // `cartService` above hands out the class, and five modules type themselves
  // against it. These three are what they rewire to: none carries a `Cart` or
  // a `CartItem` across the boundary, and `cartWritePort` adds the one
  // operation two of them were writing by hand — clear the customer's active
  // cart and seed it with these lines, which `orders`' reorder and
  // `quote_requests`' quote conversion each spelled out with `em.create(Cart,
  // …)` against this module's tables.
  // ---------------------------------------------------------------------------

  ctx.di.providePort<CartReadPort>(
    'cartReadPort',
    ctx.asFunction(({ emFactory }: CartsCradle) => new CartReadService(emFactory)).singleton(),
  );

  ctx.di.providePort<CartWritePort>(
    'cartWritePort',
    ctx
      .asFunction(({ emFactory }: CartsCradle) =>
        createCartWritePort(emFactory, () => ctx.cradle<CartsCradle>().cartService),
      )
      .singleton(),
  );

  ctx.di.providePort<CartQueryPort>(
    'cartQueryPort',
    ctx.asFunction(({ emFactory }: CartsCradle) => new CartQueryService(emFactory)).singleton(),
  );

  ctx.routes(async (app) => {
    const cradle = ctx.cradle<CartsCradle>();
    const emFactory = cradle.emFactory;
    const resolveCartActor: CartsDeps['resolveCartActor'] = (req) =>
      ctx.cradle<CartsCradle>().cartActorResolver(req);
    // Lazily, even though the module owns this port: route *registration* runs
    // inside `buildServer` whatever the module's effective state is, so reading
    // the gate here — through the cradle alias above, which is how it stayed
    // invisible to `check-port-dependencies` — would stop the next start
    // instead of stopping the routes (D-40).
    const cartService = lazyPort<CartService>(ctx, 'cartService');

    await registerCartRoutes(app, {
      emFactory,
      resolveCartActor,
      cartService,
      catalogProducts: lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
      cartUpsellService: new CartUpsellService(
        emFactory,
        lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
      ),
      cartCouponService: new CartCouponService(
        emFactory,
        lazyPort<PromotionApplyPort>(ctx, 'promotionService'),
        lazyPort<PromotionCodePort>(ctx, 'promotionCodePort'),
        lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
        lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
        cradle.cartApprovalService,
      ),
      cartConversionService: new CartConversionService(
        emFactory,
        cartService,
        lazyPort<RfqCustomerPort>(ctx, 'rfqService'),
        lazyPort<QuoteRequestReadPort>(ctx, 'quoteRequestReadPort'),
        lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
        lazyPort<SalesChannelMembershipPort>(ctx, 'salesChannelMembershipPort'),
      ),
      cartPricingRecompute: new CartPricingRecompute(
        emFactory,
        lazyPort<LinePricePort>(ctx, 'pricingService'),
        cradle.cartRecomputeCache,
        lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
        lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
      ),
      assertOrganizationCanTransact: async (organizationId) => {
        await ctx.cradle<CartsCradle>().organizationReadPort.assertCanTransact(organizationId);
      },
      pushLineToShoppingList: (input) =>
        ctx.cradle<CartsCradle>().cartShoppingListBridge.pushLineToShoppingList(input),
      appendShoppingListToCart: (input) =>
        ctx.cradle<CartsCradle>().cartShoppingListBridge.appendShoppingListToCart(input),
    });

    // Registered unconditionally. Before T136 these two mounted only when the
    // chain of optional arguments happened to reach them, so an approval or
    // admin surface could be absent with nothing saying so; the module's own
    // activation control is the intentional gate now.
    await registerCartsOrganizationRoutes(app, {
      emFactory,
      resolveCartActor,
      cartService,
      cartApprovalService: cradle.cartApprovalService,
      customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
      visibilityService: new CartOrganizationVisibilityService(
        emFactory,
        lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
      ),
    });

    await registerCartsAdminRoutes(app, {
      requireAdmin: cradle.requireAdmin,
      cartAdminService: new CartAdminService(
        emFactory,
        cradle.cartAuditService,
        lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
        lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
        lazyPort<CatalogProductReadPort>(ctx, 'catalogProductReadPort'),
        lazyPort<PromotionApplyPort>(ctx, 'promotionService'),
      ),
      cartApprovalService: cradle.cartApprovalService,
      resolveAdminUserId: (req: FastifyRequest): string | null => {
        const prodActor = (req as { actor?: { kind?: string; adminUserId?: string } }).actor;
        if (prodActor?.kind === 'admin' && prodActor.adminUserId) return prodActor.adminUserId;
        const testActor = (req as { testActor?: { kind?: string; adminUserId?: string } })
          .testActor;
        if (testActor?.kind === 'admin' && testActor.adminUserId) return testActor.adminUserId;
        return null;
      },
    });
  });
}
