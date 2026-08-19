import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CustomerAccountReadPort,
  EmailDefaultsRegistryPort,
  GatewayRefundRegistryPort,
  OrderReadPort,
  OrderStatusAnnouncePort,
  OrderStatusRegistry,
  PaymentAdapterRegistryPort,
  PaymentEmailRendererPort,
  PaymentMethodReadPort,
  PaymentReadPort,
  PaymentReferencePort,
  PaymentRefundPort,
  ReceivePaymentPort,
} from '@b2b/contracts';
import type { EventBus } from '../../events/bus.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { builtInPaymentAdapters } from './adapters/built-in-adapters.js';
import { ReceivePaymentHandler, type PaymentEventBus } from './services/receive-payment-handler.js';
import { PaymentService } from './services/payment-service.js';
import { PaymentReadService } from './services/payment-read-port.js';
import { PaymentReferenceService } from './services/payment-reference-port.js';
import { PaymentRefundProvider } from './services/payment-refund.js';
import { gatewayRefundRegistry } from './services/registry-singleton.js';
import { PaymentEmailNotifier } from './services/payment-email-notifier.js';
import { resolvePaymentEmailRenderer } from './services/payment-email-renderer.js';
import type { PaymentEmailNotifierDeps } from './services/payment-email-notifier.js';
import { registerPaymentsRoutes } from './routes.js';
import { PAYMENT_STATUS_CHANGED_DEFAULT } from './email-templates/transactional-defaults.js';

/**
 * `payments` — the delivery-side twin of `shipments`, with the same history
 * (feature 072, wave 3, T126).
 *
 * Like `shipments` before T124, this module owned a manifest, entities, two
 * services, a route file and a transactional email, and registered none of it:
 * `orders/plugin.ts` imported both services, constructed them inside its own
 * plugin and mounted the routes there. So the payment lifecycle answered
 * whenever `orders` was on, and switching `payments` off did nothing — there
 * was no seam for a gate to sit on.
 *
 * The payment-status notifier moves in with it, and it is the same
 * finding twice: both roots built it and called `attach(eventBus)`, subscribing
 * to the raw bus rather than through `subscribeForModule`, so a payment-status
 * e-mail went out whether or not the module was on. `ctx.subscribe` gates it and
 * `attach()` is deleted, leaving no ungated path to fall back into.
 *
 * The order-status registry is already a port `delivery_methods` provides, and
 * the manifest already declares that dependency. The transactional-email sender
 * stays contributed: `transactional_emails` announces it through a callback a
 * root holds, later than this module composes, so a port would point the
 * dependency at a module that does not yet have the value.
 *
 * **The four built-in adapters came home in T143a cluster 6.** They live in
 * this module (`adapters/built-in-adapters.ts`); `payment_methods` merely holds
 * the registry, and its `backend.ts` says outright that seeding them from there
 * would be a reach into another module's internals. Both roots did it instead,
 * which made "which payment kinds this platform can settle" a property of the
 * composition rather than of the module that implements them — and left the
 * four registered with `payments` switched off.
 */

/** What `payments` resolves from the container, and the names it owns. */
export interface PaymentsCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly paymentOrderStatusRegistry: OrderStatusRegistry;
  /** Owned by `payment_methods`: the table this module's adapters are listed in. */
  readonly paymentAdapterRegistry: PaymentAdapterRegistryPort;
  /** Contribution point: absent means a payment-status e-mail is not sent. */
  readonly paymentEmailSender: PaymentEmailNotifierDeps['getTransactionalEmailSender'];
  readonly paymentEmailNotifier: PaymentEmailNotifier;
  /**
   * This module's own refund-handler table, as the container's value — the
   * push seam the four gateways contribute to, ungated on purpose (see the
   * registration).
   */
  readonly gatewayRefundRegistry: GatewayRefundRegistryPort;
  readonly paymentService: PaymentService;
  readonly receivePaymentHandler: ReceivePaymentHandler;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    /**
     * The refund-handler table, as the container's value — the delivery-side
     * twin of `payment_methods`' `paymentAdapterRegistry`, and registered the
     * same way and for the same reason (feature 075, Phase P).
     *
     * **Ungated, and the only name over this registry** (D-99.7). It used to
     * have a gated twin, `gatewayRefundRegistryPort`, for the *pull* direction —
     * "which handler settles this refund" — but that question is asked inside
     * this module, by `PaymentRefundProvider`, and no module ever resolved the
     * port. A *push* must not be gated: the four gateways contribute their
     * handler from a boot hook, and a gate there would refuse the contribution
     * rather than defer it, so a gateway would silently stay unregistered until
     * the next restart after an operator switched `payments` back on. That
     * asymmetry is now stated in the contract rather than only here, because a
     * rule in a comment ships in no package. The absent-owner policy sits inside
     * the registry, where the whole design puts it: a handler whose module is
     * off is skipped at enumeration and the obligation lands on
     * `pending_manual` (D-71), which a gate over the push would drop instead of
     * record.
     */
    gatewayRefundRegistry: ctx.asFunction(() => gatewayRefundRegistry).singleton(),

    // Contribution point, defaulted to no sender: a deployment without a
    // transactional-email surface sends nothing rather than failing to settle.
    paymentEmailSender: ctx
      .asFunction((): PaymentsCradle['paymentEmailSender'] => () => undefined)
      .singleton(),

    paymentEmailNotifier: ctx
      .asFunction(
        ({ emFactory }: PaymentsCradle) =>
          new PaymentEmailNotifier({
            emFactory,
            orderRead: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
            customerAccountRead: lazyPort<CustomerAccountReadPort>(
              ctx,
              'customerAccountReadPort',
            ),
            // Read per call: a root contributes the sender after
            // `transactional_emails` announces it, which is later than this.
            getTransactionalEmailSender: () =>
              ctx.cradle<PaymentsCradle>().paymentEmailSender(),
          }),
      )
      .singleton(),
  });

  ctx.di.providePort(
    'paymentService',
    ctx.asFunction(({ emFactory }: PaymentsCradle) => new PaymentService(emFactory)).singleton(),
  );

  /**
   * How a return settlement refunds a payment (feature 046 R5), as this
   * module's port instead of a class both roots constructed (T143c).
   *
   * `PaymentRefundProvider` resolves the order's PSP adapter out of
   * `gatewayRefundRegistry` — this module's registry — so a root's instance
   * refunded through a switched-off `payments`. The bridge `returns` receives
   * forwards to this name per settlement, which is where the gate belongs.
   */
  ctx.di.providePort<PaymentRefundPort>(
    'paymentRefundPort',
    ctx
      .asFunction(
        () =>
          new PaymentRefundProvider(
            lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
            lazyPort<PaymentMethodReadPort>(ctx, 'paymentMethodReadPort'),
          ),
      )
      .singleton(),
  );

  // ---------------------------------------------------------------------------
  // Feature 075, Phase P — the published surface.
  //
  // `paymentReadPort` replaces sixteen hand-written `em.findOne(Payment, …)`
  // calls in the four gateways, and `receivePaymentPort` is the ingress they
  // already share, now expressed without the `Payment` entity in its result
  // type.
  //
  // **The refund registry is published under its push name only** (D-99.7). It
  // once had a second, gated registration here — `gatewayRefundRegistryPort`,
  // over the same instance — which nothing ever resolved, while the doc block in
  // `@b2b/contracts` described the *push* seam above it. An out-of-tree gateway
  // reading only the published contracts would have resolved the gate from its
  // boot hook and exited 1. The contract now names `gatewayRefundRegistry`, the
  // ungated registration above, and says why it is ungated; the pull is
  // intra-module and unpublished.
  // ---------------------------------------------------------------------------

  ctx.di.providePort<PaymentReadPort>(
    'paymentReadPort',
    ctx.asFunction(({ emFactory }: PaymentsCradle) => new PaymentReadService(emFactory)).singleton(),
  );

  /**
   * The write side of `findByExternalReference`, published for the four
   * gateways that were doing it with this module's entity and their own
   * `EntityManager`.
   *
   * A port, not a registration: unlike the registry above, this is a pull with
   * a failure mode. A gateway that has just opened a PaymentIntent and cannot
   * record its identifier has to hear so — the provider object is live, and an
   * event it sends would arrive with nothing on this side able to resolve it.
   */
  ctx.di.providePort<PaymentReferencePort>(
    'paymentReferencePort',
    ctx
      .asFunction(({ emFactory }: PaymentsCradle) => new PaymentReferenceService(emFactory))
      .singleton(),
  );

  ctx.di.providePort<PaymentEmailRendererPort>(
    'paymentEmailRendererPort',
    ctx
      .asFunction((): PaymentEmailRendererPort => ({
        render: (rendererKey, emailContext) =>
          resolvePaymentEmailRenderer(rendererKey)(emailContext),
      }))
      .singleton(),
  );

  ctx.di.providePort<ReceivePaymentPort>(
    'receivePaymentPort',
    ctx
      .asFunction((): ReceivePaymentPort => {
        const handler = (): ReceivePaymentHandler =>
          ctx.cradle<PaymentsCradle>().receivePaymentHandler;
        return {
          receive: (input) => handler().receive(input),
          reflectRefund: (input) => handler().reflectRefund(input),
        };
      })
      .singleton(),
  );

  /**
   * The settlement handler, with the two cross-module reads it used to make
   * with somebody else's entity now made through their ports (feature 075,
   * C-W3).
   *
   * Both edges were ledgered as blocked on this constructor: the four gateways
   * built their own handler, so it could take no port they could not build.
   * They resolve `receivePaymentPort` since the C-W3 gateway cuts, so this is
   * the only construction left and `ctx` is in hand. The `Order` entity import
   * inside the handler stays and stays permanent — `payments_order_fk` holds it
   * co-transactional (D-78 point 2) — and neither of these two shares that:
   * `paymentMethodReadPort` is a read of a row the settlement never writes, and
   * `orderStatusAnnouncePort` is called after the commit.
   */
  ctx.di.providePort(
    'receivePaymentHandler',
    ctx
      .asFunction(
        ({ emFactory, eventBus }: PaymentsCradle) =>
          new ReceivePaymentHandler(
            emFactory,
            lazyPort<PaymentMethodReadPort>(ctx, 'paymentMethodReadPort'),
            lazyPort<OrderStatusAnnouncePort>(ctx, 'orderStatusAnnouncePort'),
            lazyPort<OrderStatusRegistry>(ctx, 'paymentOrderStatusRegistry'),
            eventBus as PaymentEventBus,
          ),
      )
      .singleton(),
  );

  ctx.subscribe('payment.received.v1', async (payload) => {
    const { orderId } = payload as unknown as { orderId: string };
    await ctx.cradle<PaymentsCradle>().paymentEmailNotifier.notify(orderId, 'paid', null);
  });

  ctx.subscribe('payment.failed.v1', async (payload) => {
    const { orderId, failureReason } = payload as unknown as {
      orderId: string;
      failureReason: string | null;
    };
    await ctx
      .cradle<PaymentsCradle>()
      .paymentEmailNotifier.notify(orderId, 'failed', failureReason ?? null);
  });

  ctx.routes(async (app) => {
    const { requireAdmin } = ctx.cradle<PaymentsCradle>();
    await registerPaymentsRoutes(app, {
      requireAdmin,
      // Lazily, even though the module owns both ports: route *registration*
      // runs inside `buildServer` whatever the module's effective state is, so
      // destructuring the gates here would stop the next start instead of
      // stopping the routes (D-40).
      receiveHandler: lazyPort<ReceivePaymentHandler>(ctx, 'receivePaymentHandler'),
      paymentService: lazyPort<PaymentService>(ctx, 'paymentService'),
    });
  });

  /**
   * The default subject and content for the 1 transactional email this
   * module declares in its manifest (T143a).
   *
   * These were fourteen `emailDefaultsRegistry.register(...)` calls in
   * `composition.ts`, each importing a template constant out of the module that
   * owns it — a root reaching into seven modules to hand their own content to
   * an eighth. Each module registers its own now.
   *
   * `ctx.onBoot` rather than a registration: the registry is *read* once, by
   * `transactional_emails`' boot reconciler inside its plugin body. Boot hooks
   * run during composition and plugin bodies only when the Fastify app is
   * built, so this always lands first — by construction, not by ordering luck.
   */
  ctx.onBoot(async () => {
    const defaults = lazyPort<EmailDefaultsRegistryPort>(ctx, 'emailDefaultsPort');
    defaults.register('payment_status_changed', PAYMENT_STATUS_CHANGED_DEFAULT, 'payments');
  });

  /**
   * The four payment kinds this module implements, pushed into the registry
   * `payment_methods` holds (T143a).
   *
   * `ctx.onBoot` rather than a registration, for the reason the other
   * push-at-boot contributions give: the registry is *read* — by the
   * payment-method admin surface, by storefront eligibility and by
   * order placement — and a registration declares without resolving.
   *
   * It belongs in this module rather than in a root even though the registry is
   * a deliberate **process** singleton (`payment_methods/services/registry-singleton.ts`,
   * which the four gateway modules import directly from their install hooks).
   * The singleton decides *where* a descriptor lands, not *who* may declare
   * one, and this module owns the adapter classes.
   *
   * Each one names this module as it lands (issue #96): the registry filters
   * its enumeration on the contributing module's effective state, so an entry
   * that does not know who contributed it is an entry that keeps being offered
   * to a buyer after an operator switches its owner off. Re-registration by the
   * same owner is silent, which is what the old `isRegistered` guard was
   * really for — the test suite performs several hundred compositions against
   * this one process singleton.
   */
  ctx.onBoot(() => {
    const registry = ctx.cradle<PaymentsCradle>().paymentAdapterRegistry;
    for (const adapter of builtInPaymentAdapters()) {
      registry.register(adapter, 'payments');
    }
  });
}
