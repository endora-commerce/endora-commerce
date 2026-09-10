import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type {
  AssetsLibraryPort,
  CustomerAccountReadPort,
  CustomerGroupReadPort,
  OrderReadPort,
  OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { lazyPort } from '@endora-commerce/platform/kernel';
import type {
  RequireAdminFactory,
  SalesChannelResolutionPort,
} from '@endora-commerce/platform/kernel';
import { pwaModule, type PwaModuleOptions, type PwaModuleResult } from './plugin.js';
import {
  createAssetUrlResolver,
  createChannelCodeResolver,
  createDefaultChannelIdResolver,
  createOrderPushTargetResolver,
  type PwaCrossModulePorts,
} from './services/cross-module-context.js';
import { PushMessageDelivery } from './entities/push-message-delivery.entity.js';
import { PushMessage } from './entities/push-message.entity.js';
import { PushSubscription } from './entities/push-subscription.entity.js';
import { PwaIconRendition } from './entities/pwa-icon-rendition.entity.js';

/**
 * `pwa` — and **there is no bridge any more**
 * (`specs/110-instance-repository/` T118c).
 *
 * `PwaBridge` was one contributed name carrying eight members, written as
 * closures in `backend/src/composition.ts` and again in
 * `backend/test/helpers/test-server.ts`, on the reasoning that "a composition
 * knows how to reach `assets_library` and `sales_channels`, or it does not".
 * Re-derived member by member, none of the eight was a composition's answer to
 * give:
 *
 *  - `assetUpload` and `resolveAssetUrl` are `assets_library`' published
 *    `assetsLibraryPort`. The first was a *structural subset* of
 *    `AssetsLibraryPort.upload` all along — a Node `Readable` satisfies
 *    `AssetUploadStream`, `AssetDetail` satisfies `{ id: string }` — and the
 *    second is `getAsset(id).url` under D-223, which is why `resolveUrl` is
 *    published on no port.
 *  - `defaultChannelId` and `channelCodeForId` are the kernel's own
 *    `salesChannelResolutionPort`, a **platform** name (Constitution XII), so
 *    they add nothing to this module's manifest. The second replaces a root's
 *    hand-written `em.findOne(SalesChannel, { id })`, which is what `getById`
 *    already is.
 *  - `resolveAuditContext` was byte-identical to `adminAuditActorResolver`,
 *    which the platform contributes in `compose-app.ts` and whose own comment
 *    says it exists because "six modules each declared an identically-shaped
 *    `resolveAuditContext` option". This was one of the six. The harness's copy
 *    was **not** identical — it answered `TEST_ADMIN_ID` where production
 *    answered `null` — so draining it also settles a divergence.
 *  - `resolveCustomerAccountId` is a read of `request.actor`, whose
 *    augmentation became the platform's at T118b; see `request-actor.ts`.
 *  - `resolveOrderTarget` is `orders`' published `orderReadPort` plus a
 *    sentence, and `orders` joins `dependencies` for it.
 *  - `resolveChannelIdByCode` was **called by nothing** and is deleted rather
 *    than drained; see the note in `routes.storefront.ts`.
 *
 * What is left of the coupling is {@link PwaCrossModulePorts} — three published
 * ports and no closure, resolved here and mapped in
 * `services/cross-module-context.ts`.
 *
 * `vapidSubject` comes from the environment, read here rather than threaded
 * from a root — a packaged module reads its own configuration.
 *
 * `runWorkers` is **root-supplied, not env-derived**, and that is a correction
 * rather than a preference. My first attempt read `BACKEND_ROLE` here and gave
 * the queue `moduleQueueRedis` — copying what `google_tag_manager` needed. Both
 * were wrong for this module: the harness passes a real Redis *and*
 * `runWorkers: false`, so it has a producer and no consumer. Deriving either
 * from the environment made the harness start a delivery worker it never wants
 * and hand BullMQ an undefined connection. What a composition does with queue
 * consumers is a deployment decision, and the two deployments here genuinely
 * differ.
 */

export interface PwaCradle {
  readonly emFactory: () => EntityManager;
  readonly redis: Redis;
  /**
   * Whether this composition runs the push-delivery consumer (Principle X).
   * Root-supplied rather than env-derived: the harness runs no consumer at all,
   * and a module should not have to know which of its callers is a test.
   */
  readonly pwaRunWorkers: boolean;
  readonly requireAdmin: RequireAdminFactory;
  readonly settingsReadPort: PwaModuleOptions['settings'];
  readonly settingsAdminService: PwaModuleOptions['settingsWrite'];
  /**
   * How this deployment names the acting admin on an audit record: the admin's
   * id, or `null` for a non-admin caller.
   *
   * A **cradle** read rather than a port, which is what the eight other modules
   * taking this name already do (`autopay`, `catalog`, `dhl_parcel`,
   * `google_analytics`, `inpost`, …): it is a contribution the platform makes in
   * `compose-app.ts`, not a capability any module owns, so there is nothing to
   * gate and nothing to declare.
   */
  readonly adminAuditActorResolver: PwaModuleOptions['resolveAuditContext'];
  readonly pwa: PwaModuleResult;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    pwa: ctx
      .asFunction(({ emFactory, redis, pwaRunWorkers }: PwaCradle): PwaModuleResult => {
        // T118c — the three ports that replace `PwaBridge`. Each is a `lazyPort`
        // proxy, so it resolves per call and nothing here captures a
        // registration: a switched-off owner refuses at the call site rather
        // than through a gate frozen when this singleton was built.
        const ports: PwaCrossModulePorts = {
          assets: lazyPort<AssetsLibraryPort>(ctx, 'assetsLibraryPort'),
          channels: lazyPort<SalesChannelResolutionPort>(ctx, 'salesChannelResolutionPort'),
          orders: lazyPort<OrderReadPort>(ctx, 'orderReadPort'),
        };
        return pwaModule({
          emFactory,
          redis,
          runWorkers: pwaRunWorkers,
          settings: lazyPort<PwaModuleOptions['settings']>(ctx, 'settingsReadPort'),
          settingsWrite: lazyPort<PwaModuleOptions['settingsWrite']>(ctx, 'settingsAdminService'),
          // Feature 075, Phase C — the three rows this module used to query out
          // of other modules' tables. `lazyPort` proxies resolve per call, so a
          // switched-off owner answers 503 `MODULE_DISABLED` at the call rather
          // than through a gate frozen at composition time.
          customerAccounts: lazyPort<CustomerAccountReadPort>(ctx, 'customerAccountReadPort'),
          organizationDetails: lazyPort<OrganizationDetailsPort>(ctx, 'organizationDetailsPort'),
          customerGroups: lazyPort<CustomerGroupReadPort>(ctx, 'customerGroupReadPort'),
          requireAdmin: (permission) => async (req, reply) =>
            ctx.cradle<PwaCradle>().requireAdmin(permission)(req, reply),
          vapidSubject:
            process.env['PWA_VAPID_SUBJECT'] ?? 'mailto:admin@b2b-platform.local',
          // Pre-route fallback for the FR-024 handlers' log — see
          // `PwaModuleOptions.log`. The module swaps to `app.log` when its
          // routes register.
          log: ctx.log,
          // `AssetsLibraryPort` is a structural supertype of `AssetUploadPort`:
          // the icon pipeline names the one method it calls, and the port
          // satisfies it. That was true before T118c too, which is why draining
          // this member cost nothing but the deletion of two closures.
          assetUpload: ports.assets,
          resolveAssetUrl: createAssetUrlResolver(ports.assets),
          defaultChannelId: createDefaultChannelIdResolver(ports.channels),
          channelCodeForId: createChannelCodeResolver(ports.channels),
          // The platform's contribution, read through the cradle per request so
          // a deployment that supplies its own still wins.
          resolveAuditContext: (request: FastifyRequest) =>
            ctx.cradle<PwaCradle>().adminAuditActorResolver(request),
          resolveOrderTarget: createOrderPushTargetResolver(ports.orders),
          // `resolveQuoteTarget` is passed by nobody and never has been — see
          // `PwaModuleOptions`, where the measurement is written down.
        });
      })
      .singleton(),
  });

  /**
   * The two FR-024 auto-triggers (issue #107).
   *
   * They were bare `eventBus.on` calls inside `pwaModule`, so an order reaching
   * its status or a quote request being updated still wrote a `push_messages`
   * row and still pushed to the customer's device with `pwa` switched off — the
   * module's own admin and storefront surfaces refused at the same time, which
   * is what made it invisible. `ctx.subscribe` gates both.
   */
  const handlers = (): PwaModuleResult['handle']['pushEventHandlers'] =>
    ctx.cradle<PwaCradle>().pwa.handle.pushEventHandlers;

  ctx.subscribe('order.status_changed.v1', async (payload) => {
    await handlers().onOrderStatusChanged(payload);
  });

  ctx.subscribe('quote_request.updated.v1', async (payload) => {
    await handlers().onQuoteRequestUpdated(payload);
  });

  ctx.routes(async (app) => {
    // `ctx.worker` applies `defineModuleWorker('pwa', …)`, which is what puts
    // the push-delivery consumer in the registry the presence reconcile and
    // `pauseWorkersFor` iterate (Constitution XVII). Until this landed the
    // module built the worker and dropped it, so switching `pwa` off refused
    // its admin and storefront surfaces and went on delivering pushes.
    // Attached here rather than at registration for `ksef`'s reason: this is
    // where `app.log` exists, and a `BACKEND_ROLE=worker` process reaches it —
    // `src/worker.ts` builds the server precisely to register module plugins
    // and simply never listens.
    for (const worker of ctx.cradle<PwaCradle>().pwa.workers) {
      ctx.worker(worker, { logger: app.log });
    }
    await ctx.cradle<PwaCradle>().pwa.plugin(app);
  });
}

/**
 * The module's persisted entity classes, on the `./backend` subpath, as one
 * array and **no named class export** (D-168).
 *
 * This is the shape the platform reads when the package is *installed*: the
 * boot-time loader (`src/packages/package-runtime.ts`, `exported['entities']`)
 * and the static declaration reader (`scripts/lib/package-declarations.ts`),
 * which is the third source of `check:module-boundary`'s `table→owner` map and
 * the package pass of `check-entity-tenant-classification`. A missing array is
 * answered with `[]` — zero entities registered, no error anywhere.
 */
export const entities = [
  PushMessageDelivery,
  PushMessage,
  PushSubscription,
  PwaIconRendition,
];
