import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { OrderStatusRegistry } from '../delivery_methods/services/order-status-registry.port.js';
import type { PaymentAdapterRegistry } from '../payment_methods/services/payment-adapter-registry.js';
import { builtInPaymentAdapters } from './adapters/built-in-adapters.js';
import { ReceivePaymentHandler, type PaymentEventBus } from './services/receive-payment-handler.js';
import { PaymentService } from './services/payment-service.js';
import { PaymentEmailNotifier } from './services/payment-email-notifier.js';
import type { PaymentEmailNotifierDeps } from './services/payment-email-notifier.js';
import { registerPaymentsRoutes } from './routes.js';
import { PAYMENT_STATUS_CHANGED_DEFAULT } from './email-templates/transactional-defaults.js';
import type { EmailDefaultsRegistry } from '../transactional_emails/services/email-defaults-registry.js';

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
  readonly paymentAdapterRegistry: PaymentAdapterRegistry;
  /** Contribution point: absent means a payment-status e-mail is not sent. */
  readonly paymentEmailSender: PaymentEmailNotifierDeps['getTransactionalEmailSender'];
  readonly paymentEmailNotifier: PaymentEmailNotifier;
  readonly paymentService: PaymentService;
  readonly receivePaymentHandler: ReceivePaymentHandler;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
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

  ctx.di.providePort(
    'receivePaymentHandler',
    ctx
      .asFunction(
        ({ emFactory, eventBus }: PaymentsCradle) =>
          new ReceivePaymentHandler(
            emFactory,
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
    const defaults = lazyPort<EmailDefaultsRegistry>(ctx, 'emailDefaultsPort');
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
   * The `isRegistered` guard travels with them, and it is that process
   * singleton that makes it necessary: boot hooks run once per composition and
   * the test suite performs several hundred, all writing the same instance.
   */
  ctx.onBoot(() => {
    const registry = ctx.cradle<PaymentsCradle>().paymentAdapterRegistry;
    for (const adapter of builtInPaymentAdapters()) {
      if (!registry.isRegistered(adapter.adapterKey)) registry.register(adapter);
    }
  });
}
