import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import type Redis from 'ioredis';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import { ERROR_CODES } from '@b2b/contracts';
import { HttpError } from '../../http/error-envelope.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import {
  SettingNotRegistered,
  SettingOutOfScopeForChannel,
} from '../../kernel/settings/settings.service.js';
import type { OrganizationReadPort } from '../../kernel/ports/organizations.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import {
  CARTS_SETTING_CODES,
  DEFAULT_ABANDONMENT_INACTIVITY_MINUTES,
  DEFAULT_ABANDONMENT_NOTIFICATION_RECIPIENT,
} from './manifest.js';
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
  readonly settingsReadPort: SettingsService;
  readonly pricingService: ConstructorParameters<typeof CartService>[1];
  readonly promotionService: ConstructorParameters<typeof CartCouponService>[1];
  readonly rfqService: ConstructorParameters<typeof CartConversionService>[2];
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

/**
 * Conditions this module has already reported. Module scope and never reset, so
 * the guard is per **process**: an out-of-scope setting is a deployment fact
 * that holds for every subsequent read, and the sweep runs on a timer. One line
 * per condition is what makes it findable; one line per read is what makes it
 * invisible. Same shape as `quote_requests/backend.ts`.
 */
const warnedConditions = new Set<string>();

function warnOnce(condition: string, message: string): void {
  if (warnedConditions.has(condition)) return;
  warnedConditions.add(condition);
  console.warn(message);
}

/**
 * One platform-wide read of one of this module's own settings, degrading to the
 * manifest default under exactly the two conditions D-43 allows: an
 * unregistered code (quiet — the normal state before the manifest reconciler's
 * first run) and a setting the operator scoped to specific channels (warned
 * once, because that scoping cannot be intentional for a platform-wide value).
 */
async function readPlatformSetting<T>(
  ctx: ModuleContext,
  code: string,
  schema: z.ZodType<T>,
  fallback: T,
): Promise<T> {
  try {
    return await ctx.cradle<CartsCradle>().settingsReadPort.get(code, null, schema);
  } catch (error) {
    if (error instanceof SettingNotRegistered) return fallback;
    if (error instanceof SettingOutOfScopeForChannel) {
      warnOnce(
        `out-of-scope:${code}`,
        `[carts] setting "${code}" is scoped to specific sales channels, so it has ` +
          `no platform-wide value — falling back to the manifest default ` +
          `(logged once per process).`,
      );
      return fallback;
    }
    throw error;
  }
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
          new CartApprovalService(emFactory, cartAuditService),
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
             * identical try/catch-to-default stood in both roots before T136.
             *
             * Two things changed in the settings-channel pass (D-41/D-43).
             *
             * The channel: both reads passed the literal `'default'`, which is
             * a channel **code**, while `setting_values.sales_channel_id` is
             * `uuid`. PostgreSQL rejected the comparison
             * (`invalid input syntax for type uuid: "default"`), the bare
             * `catch` below read that as "not configured yet", and the sweep
             * ran with the fallback on every deployment. Neither setting is
             * per-storefront — an abandonment threshold is a property of the
             * platform, not of a channel — so the honest argument is `null`, a
             * platform-wide read.
             *
             * The fallback: it was `0`, and the worker treats `<= 0` as "sweep
             * nothing", so the divergence from the manifest's 10080 did not
             * merely lose the configured value, it switched the feature off.
             * The fallback is now the manifest's own binding.
             *
             * What may be absorbed is enumerated, because a bare `catch` around
             * a port call turns fail-closed into fail-open: a shape mismatch, a
             * driver error or a `ModuleDisabledError` propagates.
             */
            resolveInactivityMinutes: async () =>
              readPlatformSetting(
                ctx,
                CARTS_SETTING_CODES.ABANDONMENT_INACTIVITY_MINUTES,
                z.number().int().nonnegative(),
                DEFAULT_ABANDONMENT_INACTIVITY_MINUTES,
              ),
            resolveNotificationRecipient: async () =>
              readPlatformSetting(
                ctx,
                CARTS_SETTING_CODES.ABANDONMENT_NOTIFICATION_RECIPIENT,
                z.string(),
                DEFAULT_ABANDONMENT_NOTIFICATION_RECIPIENT,
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
            lazyPort<CartsCradle['pricingService'] & object>(ctx, 'pricingService'),
            cartApprovalService,
            cartAuditService,
            cartRecomputeCache,
          ),
      )
      .singleton(),
  );

  ctx.routes(async (app) => {
    const cradle = ctx.cradle<CartsCradle>();
    const emFactory = cradle.emFactory;
    const resolveCartActor: CartsDeps['resolveCartActor'] = (req) =>
      ctx.cradle<CartsCradle>().cartActorResolver(req);

    await registerCartRoutes(app, {
      emFactory,
      resolveCartActor,
      cartService: cradle.cartService,
      cartUpsellService: new CartUpsellService(emFactory),
      cartCouponService: new CartCouponService(
        emFactory,
        lazyPort<CartsCradle['promotionService'] & object>(ctx, 'promotionService'),
        cradle.cartApprovalService,
      ),
      cartConversionService: new CartConversionService(
        emFactory,
        cradle.cartService,
        lazyPort<CartsCradle['rfqService'] & object>(ctx, 'rfqService'),
      ),
      cartPricingRecompute: new CartPricingRecompute(
        emFactory,
        lazyPort<CartsCradle['pricingService'] & object>(ctx, 'pricingService'),
        cradle.cartRecomputeCache,
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
      cartService: cradle.cartService,
      cartApprovalService: cradle.cartApprovalService,
      visibilityService: new CartOrganizationVisibilityService(emFactory),
    });

    await registerCartsAdminRoutes(app, {
      requireAdmin: cradle.requireAdmin,
      cartAdminService: new CartAdminService(
        emFactory,
        cradle.cartAuditService,
        lazyPort<CartsCradle['promotionService'] & object>(ctx, 'promotionService'),
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
