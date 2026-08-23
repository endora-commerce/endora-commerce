import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type { Redis } from 'ioredis';
import type {
  CustomerAccountReadPort,
  CustomerGroupReadPort,
  OrganizationDetailsPort,
} from '@endora-commerce/contracts';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { pwaModule, type PwaModuleOptions, type PwaModuleResult } from './plugin.js';

/**
 * `pwa` — twenty options, and nine of them are one idea (feature 072, wave 2,
 * T116).
 *
 * The nine are every way this module reaches outside itself: uploading an icon
 * through `assets_library`, turning a sales-channel code into an id and back,
 * naming the acting admin, and resolving an order or quote event into a push
 * target. They are contributed as a single {@link PwaBridge} for the reason
 * `mfa`'s actor bridge is one name — they are always supplied together, by the
 * same caller, and a composition that knows four of the nine is not a coherent
 * state. Splitting them would produce nine registrations that can each go
 * missing on their own.
 *
 * Three of the nine are optional *within* the bridge, and that is real rather
 * than lazy: `resolveCustomerAccountId`, `resolveOrderTarget` and
 * `resolveQuoteTarget` drive the FR-024 auto-trigger, and a deployment that
 * does not push on order or quote events genuinely has nothing to supply. Their
 * absence removes a trigger; it does not weaken a check.
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

/**
 * Everything this module reaches outside itself, contributed whole.
 *
 * A composition knows how to reach `assets_library` and `sales_channels`, or it
 * does not; there is no coherent state where it knows some of that and not the
 * rest.
 */
export interface PwaBridge {
  readonly assetUpload: PwaModuleOptions['assetUpload'];
  readonly resolveAssetUrl: PwaModuleOptions['resolveAssetUrl'];
  readonly resolveChannelIdByCode: PwaModuleOptions['resolveChannelIdByCode'];
  readonly defaultChannelId: PwaModuleOptions['defaultChannelId'];
  readonly channelCodeForId: PwaModuleOptions['channelCodeForId'];
  readonly resolveAuditContext: PwaModuleOptions['resolveAuditContext'];
  /** FR-024 auto-trigger; absent on a deployment that pushes on neither. */
  readonly resolveCustomerAccountId?: PwaModuleOptions['resolveCustomerAccountId'];
  readonly resolveOrderTarget?: PwaModuleOptions['resolveOrderTarget'];
  readonly resolveQuoteTarget?: PwaModuleOptions['resolveQuoteTarget'];
}

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
  readonly pwaBridge: PwaBridge;
  readonly pwa: PwaModuleResult;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    pwa: ctx
      .asFunction(({ emFactory, redis, pwaRunWorkers }: PwaCradle): PwaModuleResult => {
        const bridge = (): PwaBridge => ctx.cradle<PwaCradle>().pwaBridge;
        const b = bridge();
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
          // Forwarded through the bridge so a root supplies them once, together.
          assetUpload: b.assetUpload,
          resolveAssetUrl: (assetId) => bridge().resolveAssetUrl(assetId),
          resolveChannelIdByCode: (code) => bridge().resolveChannelIdByCode(code),
          defaultChannelId: () => bridge().defaultChannelId(),
          channelCodeForId: (channelId) => bridge().channelCodeForId(channelId),
          resolveAuditContext: (request: FastifyRequest) =>
            bridge().resolveAuditContext(request),
          // Spread rather than assigned: `exactOptionalPropertyTypes` makes an
          // omitted property and an explicit `undefined` different types, and
          // these three are genuinely absent on a deployment that pushes on
          // neither order nor quote events.
          ...(b.resolveCustomerAccountId === undefined
            ? {}
            : { resolveCustomerAccountId: b.resolveCustomerAccountId }),
          ...(b.resolveOrderTarget === undefined
            ? {}
            : { resolveOrderTarget: b.resolveOrderTarget }),
          ...(b.resolveQuoteTarget === undefined
            ? {}
            : { resolveQuoteTarget: b.resolveQuoteTarget }),
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
    await ctx.cradle<PwaCradle>().pwa.plugin(app);
  });
}
