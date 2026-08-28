import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  CustomerAccountReadPort,
  EmailDefaultsRegistryPort,
  GatewayRefundRegistryPort,
  OrderReadPort,
  OrderTransitionPort,
  PaymentAdapterRegistryPort,
  PaymentEmailRendererPort,
  PaymentMethodReadPort,
  PaymentReadPort,
  PaymentReferencePort,
  PaymentRefundPort,
  ReceivePaymentPort,
} from '@endora-commerce/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { EventBus } from '@endora-commerce/platform/events';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import type { OrganizationReadPort } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { builtInPaymentAdapters } from './adapters/built-in-adapters.js';
import { Payment } from './entities/payment.entity.js';
import {
  ReceivePaymentHandler,
  type OrderPaymentStatusApplyPort,
  type PaymentEventBus,
} from './services/receive-payment-handler.js';
import { PaymentService } from './services/payment-service.js';
import { PaymentRetryService } from './services/payment-retry-service.js';
import { PaymentReadService } from './services/payment-read-port.js';
import { PaymentReferenceService } from './services/payment-reference-port.js';
import { PaymentPlacementApplyService } from './services/payment-placement-apply-port.js';
import type { PaymentPlacementApplyPort } from '@endora-commerce/mod-orders/ports';
import { PaymentRefundProvider } from './services/payment-refund.js';
import { gatewayRefundRegistry } from './services/registry-singleton.js';
import { PaymentEmailNotifier } from './services/payment-email-notifier.js';
import { resolvePaymentEmailRenderer } from './services/payment-email-renderer.js';
import type { PaymentEmailNotifierDeps } from './services/payment-email-notifier.js';
import { registerPaymentsRoutes } from './routes.js';
import { registerPaymentsCustomerRoutes } from './routes.customer.js';
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
  /** How this composition authenticates and names the buyer on the retry route. */
  readonly requireCustomer: (req: FastifyRequest, reply: FastifyReply) => Promise<void>;
  readonly customerAccountIdResolver: (req: FastifyRequest) => string;
  /** The tenancy read: a suspended Organization may not pay, as it may not place. */
  readonly organizationReadPort: OrganizationReadPort;
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
  readonly paymentRetryService: PaymentRetryService;
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
    ctx
      .asFunction(
        ({ emFactory }: PaymentsCradle) =>
          new PaymentService(emFactory, lazyPort<OrderReadPort>(ctx, 'orderReadPort')),
      )
      .singleton(),
  );

  /**
   * The buyer's own retry (issue #264), as this module's own service rather
   * than a route body.
   *
   * It is not a published port: nothing outside this module calls it, and the
   * one surface it has is the HTTP route below. The adapter registry is read
   * per call — an operator can switch a gateway off between two requests, and
   * the registry filters its enumeration on the contributor's effective state.
   */
  ctx.di.register({
    paymentRetryService: ctx
      .asFunction(
        () =>
          new PaymentRetryService({
            orderRead: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
            customerAccountRead: lazyPort<CustomerAccountReadPort>(
              ctx,
              'customerAccountReadPort',
            ),
            // Lazily, even though this module owns it: capturing a gate into a
            // singleton is a gate that keeps answering after an operator
            // switches the owner off.
            paymentService: lazyPort<PaymentService>(ctx, 'paymentService'),
            // The terminality read (feature 085 Phase D): the same port the
            // settlement handler writes through, resolved for its read half.
            orderTransition: lazyPort<OrderTransitionPort>(ctx, 'orderTransitionPort'),
            paymentAdapterRegistry: () =>
              ctx.cradle<PaymentsCradle>().paymentAdapterRegistry,
            // No `catch` around the port call, for the reason `orders` and
            // `carts` give at the same seam: a disabled-module throw read as
            // "no restriction" would be fail-open on a path whose job is to
            // restrict.
            assertOrganizationCanTransact: async (organizationId: string): Promise<void> => {
              await ctx.cradle<PaymentsCradle>().organizationReadPort.assertCanTransact(
                organizationId,
              );
            },
          }),
      )
      .singleton(),
  });

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
  // `@endora-commerce/contracts` described the *push* seam above it. An out-of-tree gateway
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
   * The payment row order placement opens, on **placement's** `EntityManager`
   * (feature 080, T048; D-169, D-179).
   *
   * `orders` wrote it with this module's `Payment` class until T048 — the last
   * cross-module entity-class reach in the tree. D-168 leaves a packaged
   * `payments` no entity class for a stranger to name, so what crosses is now
   * this module's own interface and the statement belongs to the module that
   * owns the table. `PaymentPlacementApplyPort` stays out of
   * `@endora-commerce/contracts` because it takes a MikroORM `EntityManager` and
   * FR-034 keeps that package free of them — and it is declared on
   * **`@endora-commerce/mod-orders/ports`**, not this module's own, which is
   * D-171.1 and not an accident. The two modules reach each other, so only one
   * npm edge can exist (a mutual devDependency between two module packages is a
   * build deadlock, `noEmitOnError` making the loser emit nothing), and it runs
   * in the direction of the binding manifest edge: this module declares `orders`
   * in its `dependencies`, so `mod-payments` build-depending on `mod-orders`
   * adds no claim its manifest does not already make.
   *
   * The licence is conditional and the condition is **this** module's:
   * `PaymentPlacementApplyService` names the interface at its `implements`
   * clause, and the registration below carries the explicit type argument. Those
   * are the two places `tsc` checks conformance — TS2420 and TS2345 — and both
   * resolve the interface wherever it was declared. Dropping either turns the
   * seam into D-77's rejected alternative, which is what
   * `check:port-shape`'s `declared-elsewhere-without-implements` refuses.
   *
   * It is a **gated** registration like every other name here, and that gate is
   * the half `orders` writing the row itself could never have. The reachable
   * consequence is narrow, because `assertPaymentMethodUsable` already refuses a
   * method whose adapter this module contributes while this module is absent —
   * D-179 measured that and found checkout already fail-closed, where no money
   * is at stake. What that guard deliberately tolerates is a method whose
   * adapter **no** module ever registered, and such a placement went on writing
   * a row into this module's own table with an operator having switched it off:
   * issue #188's shape, which the gate closes. `orders` declares the edge
   * `refuses-without` and wraps the call in no `catch`.
   */
  ctx.di.providePort<PaymentPlacementApplyPort>(
    'paymentPlacementApplyPort',
    ctx.asFunction(() => new PaymentPlacementApplyService()).singleton(),
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
   * the only construction left and `ctx` is in hand.
   *
   * **The `Order` entity import inside the handler is gone since feature 080's
   * T048**, and the seam it stood for is not: `payments_order_fk` still holds
   * the payment row and the order's payment status co-transactional (D-78 point
   * 2), so the write still runs on the settlement's own `EntityManager` — it is
   * `orderPaymentStatusApplyPort` that performs it now, an interface `orders`
   * declares in its `ports/` directory precisely because an `EntityManager`
   * parameter bars it from `@endora-commerce/contracts` (FR-034). D-168 leaves a
   * packaged `orders` no entity class for this module to name, which is what
   * made the conversion due before that module moves.
   *
   * The three `orders`/`payment_methods` ports this constructor takes are not
   * three of a kind, and the difference is which transaction each runs in:
   * `paymentMethodReadPort` is a read of a row the settlement never writes,
   * `orderPaymentStatusApplyPort` is the co-transactional write above, and
   * `orderTransitionPort` is called after the commit.
   *
   * **`orderTransitionPort` replaces two of the three names this used to take**
   * (feature 085 Phase D). `orderStatusAnnouncePort` goes because the transition
   * seam emits the templated `.after` events itself, so announcing beside it
   * would double every subscriber's reaction; `paymentOrderStatusRegistry` goes
   * because "is this a status code" was never the question the ingress needed
   * answered, and the port answers the real one — may this order go there —
   * against the configured graph.
   */
  ctx.di.providePort(
    'receivePaymentHandler',
    ctx
      .asFunction(
        ({ emFactory, eventBus }: PaymentsCradle) =>
          new ReceivePaymentHandler(
            emFactory,
            lazyPort<PaymentMethodReadPort>(ctx, 'paymentMethodReadPort'),
            lazyPort<OrderTransitionPort>(ctx, 'orderTransitionPort'),
            lazyPort<OrderPaymentStatusApplyPort>(ctx, 'orderPaymentStatusApplyPort'),
            ctx.log,
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
    await registerPaymentsCustomerRoutes(app, {
      requireCustomer: (req, reply) => ctx.cradle<PaymentsCradle>().requireCustomer(req, reply),
      resolveCustomerAccountId: (req: FastifyRequest) =>
        ctx.cradle<PaymentsCradle>().customerAccountIdResolver(req),
      // Resolvable here, unlike the two above: this is a plain registration
      // rather than a gate, and every port it holds is lazy.
      retryService: ctx.cradle<PaymentsCradle>().paymentRetryService,
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

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and **no named class export** (D-168).
 *
 * This is the shape the platform reads when the package is *installed*: the
 * boot-time loader (`src/packages/package-runtime.ts`, `exported['entities']`)
 * and the static declaration reader (`scripts/lib/package-declarations.ts`),
 * which is the third source of `check:module-boundary`'s `table->owner` map and
 * the package pass of `check-entity-tenant-classification`. A missing array is
 * answered with `[]` — zero entities registered, no error anywhere.
 *
 * One class, and the one that used to cross a boundary: `orders` constructed
 * `Payment` directly until T048, which was the last cross-module entity-class
 * reach in the tree. What crosses now is `PaymentPlacementApplyPort`, and D-168
 * leaves a stranger no supported spelling for the class itself.
 */
export const entities = [Payment];
