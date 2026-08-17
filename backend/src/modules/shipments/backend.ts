import type { EntityManager } from '@mikro-orm/postgresql';
import type { EventBus } from '../../events/bus.js';
import type {
  CustomerAccountReadPort,
  DeliveryMethodReadPort,
  EmailDefaultsRegistryPort,
  OrderReadPort,
  OrderStatusAnnouncePort,
  OrderStatusRegistry,
  ShippingAdapterRegistryPort,
  ShippingEmailRendererPort,
} from '@b2b/contracts';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { ShipmentService } from './services/shipment-service.js';
import { resolveShippingEmailRenderer } from './services/shipping-email-renderer.js';
import { ReceiveShipmentHandler } from './services/receive-shipment-handler.js';
import type { ShippingEventBus } from './services/events.js';
import { registerShipmentsRoutes } from './routes.js';
import { ShipmentEmailNotifier } from './services/shipment-email-notifier.js';
import type { ShipmentEmailNotifierDeps } from './services/shipment-email-notifier.js';
import { SHIPMENT_CREATED_DEFAULT } from './email-templates/transactional-defaults.js';

/**
 * `shipments` — a module that owned everything except its own registration
 * (feature 072, wave 2, T124).
 *
 * It has a manifest, an entity, two services, a route file, a transactional
 * email and a migration — and none of it was wired by the module. `orders`
 * imported both services and the route file, constructed them inside its own
 * plugin and mounted them there, which its own manifest comment recorded as
 * "routes are wired through the commerce composition root". So the shipment
 * lifecycle existed for exactly as long as `orders` happened to be composed,
 * and Principle I's "design every module so it can be detached" was false for
 * it in the same literal way it was for `audit_logs` before T084.
 *
 * Nothing in the split needed inventing: both registries the services take are
 * already ports `delivery_methods` provides, and the manifest already declares
 * that dependency. What changes is who registers the routes — and therefore
 * what switching `shipments` off does. Before, nothing: the module had no gate
 * of its own and its routes answered whenever `orders` was on.
 *
 * The `shipment.created.v1` notifier moves in for the same reason. Both roots
 * built it and called `attach(eventBus)` directly, so it subscribed to the raw
 * bus rather than through `subscribeForModule` — a shipment-created e-mail went
 * out whether or not this module was on. `ctx.subscribe` gates it.
 *
 * The transactional-email *sender* stays contributed: it is announced by
 * `transactional_emails` through a callback a root holds, so a port would point
 * the dependency at a module that does not yet have the value. Absent, the
 * notifier is silent — which is exactly what it already did when the sender had
 * not been exposed.
 */

/** What `shipments` resolves from the container, and the names it owns. */
export interface ShipmentsCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly requireAdmin: RequireAdminFactory;
  readonly shippingAdapterRegistry: ShippingAdapterRegistryPort;
  readonly shippingOrderStatusRegistry: OrderStatusRegistry;
  readonly shipmentService: ShipmentService;
  readonly receiveShipmentHandler: ReceiveShipmentHandler;
  /** Contribution point: absent means a shipment-created e-mail is not sent. */
  readonly shipmentEmailSender: ShipmentEmailNotifierDeps['getTransactionalEmailSender'];
  readonly shipmentEmailNotifier: ShipmentEmailNotifier;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    // Contribution point, defaulted to no sender: a deployment without a
    // transactional-email surface sends nothing rather than failing to ship.
    shipmentEmailSender: ctx
      .asFunction((): ShipmentsCradle['shipmentEmailSender'] => () => undefined)
      .singleton(),

    shipmentEmailNotifier: ctx
      .asFunction(
        ({ emFactory }: ShipmentsCradle) =>
          new ShipmentEmailNotifier({
            emFactory,
            orderRead: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
            customerAccountRead: lazyPort<CustomerAccountReadPort>(
              ctx,
              'customerAccountReadPort',
            ),
            // Read per call: a root contributes the sender after
            // `transactional_emails` announces it, which is later than this.
            getTransactionalEmailSender: () =>
              ctx.cradle<ShipmentsCradle>().shipmentEmailSender(),
          }),
      )
      .singleton(),
  });

  ctx.di.providePort(
    'shipmentService',
    ctx
      .asFunction(
        ({ emFactory, eventBus }: ShipmentsCradle) =>
          new ShipmentService(
            emFactory,
            lazyPort<ShippingAdapterRegistryPort>(ctx, 'shippingAdapterRegistry'),
            lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
            lazyPort<DeliveryMethodReadPort>(ctx, 'deliveryMethodReadPort'),
            eventBus as ShippingEventBus,
          ),
      )
      .singleton(),
  );

  /**
   * Feature 075, Phase P — the shipping line of the order-confirmation e-mail.
   *
   * The delivery-side twin of `payments`' `paymentEmailRendererPort`, and the
   * same collapse: `orders` reaches this module's resolver and then calls the
   * function it gets back. Doing both behind one call is what keeps the
   * default text on this side — a consumer that resolved a renderer and got
   * `undefined` would have to hold a copy of it, and two copies of a default
   * are how a default stops being one.
   */
  ctx.di.providePort<ShippingEmailRendererPort>(
    'shippingEmailRendererPort',
    ctx
      .asFunction((): ShippingEmailRendererPort => ({
        render: (rendererKey, emailContext) =>
          resolveShippingEmailRenderer(rendererKey)(emailContext),
      }))
      .singleton(),
  );

  ctx.di.providePort(
    'receiveShipmentHandler',
    ctx
      .asFunction(
        ({ emFactory, eventBus }: ShipmentsCradle) =>
          new ReceiveShipmentHandler(
            emFactory,
            lazyPort<OrderStatusRegistry>(ctx, 'shippingOrderStatusRegistry'),
            lazyPort<DeliveryMethodReadPort>(ctx, 'deliveryMethodReadPort'),
            lazyPort<OrderStatusAnnouncePort>(ctx, 'orderStatusAnnouncePort'),
            eventBus as ShippingEventBus,
          ),
      )
      .singleton(),
  );

  ctx.subscribe('shipment.created.v1', async (payload) => {
    const { orderId, shipmentId } = payload as unknown as {
      orderId: string;
      shipmentId: string;
    };
    await ctx.cradle<ShipmentsCradle>().shipmentEmailNotifier.notify(orderId, shipmentId);
  });

  ctx.routes(async (app) => {
    const { requireAdmin } = ctx.cradle<ShipmentsCradle>();
    await registerShipmentsRoutes(app, {
      requireAdmin,
      // Lazily, even though the module owns both ports: route *registration*
      // runs inside `buildServer` whatever the module's effective state is, so
      // destructuring the gates here would stop the next start instead of
      // stopping the routes (D-40).
      receiveHandler: lazyPort<ReceiveShipmentHandler>(ctx, 'receiveShipmentHandler'),
      shipmentService: lazyPort<ShipmentService>(ctx, 'shipmentService'),
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
    defaults.register('shipment_created', SHIPMENT_CREATED_DEFAULT, 'shipments');
  });

}
