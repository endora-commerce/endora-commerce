import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { OrderStatusRegistry } from '../delivery_methods/services/order-status-registry.port.js';
import { ReceivePaymentHandler, type PaymentEventBus } from './services/receive-payment-handler.js';
import { PaymentService } from './services/payment-service.js';
import { PaymentEmailNotifier } from './services/payment-email-notifier.js';
import type { PaymentEmailNotifierDeps } from './services/payment-email-notifier.js';
import { registerPaymentsRoutes } from './routes.js';

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
 */

/** What `payments` resolves from the container, and the names it owns. */
export interface PaymentsCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly paymentOrderStatusRegistry: OrderStatusRegistry;
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
    const { paymentService, receivePaymentHandler, requireAdmin } = ctx.cradle<PaymentsCradle>();
    await registerPaymentsRoutes(app, {
      requireAdmin,
      receiveHandler: receivePaymentHandler,
      paymentService,
    });
  });
}
