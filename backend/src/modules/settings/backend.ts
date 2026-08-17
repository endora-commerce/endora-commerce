import type { EntityManager } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import type Redis from 'ioredis';
import type { EventBus } from '../../events/bus.js';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { SettingsAdminPort } from '@b2b/contracts';
import type { ModuleContext } from '../../kernel/index.js';
import { lazyPort } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import type { SettingsCacheInvalidation } from '../../kernel/settings/settings-cache.js';
import type { SettingsService } from '../../kernel/settings/settings.service.js';
import {
  SettingsAdminService,
  type AdminAuditContext,
  type ModulePresencePort,
} from './services/settings-admin.service.js';
import { CacheAdminService } from './services/cache-admin.service.js';
import { ShopInfoResolver } from './services/shop-info-resolver.js';
import { HomepageResolver } from './services/homepage-resolver.js';
import { ProductCardButtonsResolver } from './services/product-card-buttons-resolver.js';
import { SpeculationRulesResolver } from './services/speculation-rules-resolver.js';
import { registerSettingsAdminRoutes } from './routes.admin.js';
import { registerSettingsStorefrontRoutes } from './routes.storefront.js';
import { registerSettingsCacheRoutes } from './routes.cache.js';
import { registerSettingsHomepageRoutes } from './routes.homepage.js';
import { registerSettingsProductCardButtonsRoutes } from './routes.product-card-buttons.js';
import { registerSettingsSpeculationRulesRoutes } from './routes.speculation-rules.js';

/**
 * `settings` — the admin surface, after the kernel took the reader (feature
 * 072, wave 2, T118).
 *
 * `SettingsService`, its cache and the cache invalidator are composed by a root
 * through `composeSettingsKernel`: a settings read backs behaviour in nearly
 * every module, so it must not be gated on whether an operator wants the
 * settings screens. What is left here is genuinely this module's — the admin
 * write service, the cache-clear action, the four storefront resolvers and six
 * route files.
 *
 * **The optional `requireAdmin` defaulted to a permissive no-op.** Absent, every
 * `/api/v1/admin/settings/*` route — including the write path and the
 * cache-clear action — was reachable by anyone. Both compositions passed a real
 * guard, so nothing was exposed; but of the dozen optional arguments these
 * conversions have removed, this is the only one whose absence *granted* access
 * rather than skipping a step. It is required now.
 *
 * `modulePresence` and `auditLogService` become required for the ordinary
 * reason: absent, FR-033's refusal of writes to a switched-off module's settings
 * simply does not happen, and settings changes go unrecorded.
 *
 * `dictionaryValidator` is deleted. It was declared "a feature 017 no-op for
 * now; reserved for future typed dictionary-code settings", passed by neither
 * composition, and read nowhere in the module.
 *
 * `secretEncryptionKey` stays optional, on the kernel half, because its absence
 * *refuses* secret writes rather than permitting them.
 */

export interface SettingsCradle {
  readonly emFactory: () => EntityManager;
  readonly eventBus: EventBus;
  readonly auditLogService: AuditLogService;
  readonly requireAdmin: RequireAdminFactory;
  readonly adminAuditActorResolver: (req: FastifyRequest) => AdminAuditContext;
  /** The kernel reader, so the resolvers read through the same cache. */
  readonly settingsReadPort: SettingsService;
  /**
   * The kernel cache the reader reads through, so the **write seam** can drop
   * it and await the drop (issue #45). Root-supplied alongside
   * `settingsReadPort` — the same object, seen from the writing side.
   */
  readonly settingsCache: SettingsCacheInvalidation;
  /** Root-supplied: `redis` for the cache-admin action's flush. */
  readonly redis: Redis;
  /** Root-supplied from `_lifecycle`, so this module keeps no edge into it. */
  readonly settingsModulePresence: ModulePresencePort;
  /** Base64 32-byte key for `secret` values; absent refuses secret writes. */
  readonly settingsSecretEncryptionKey: string | undefined;
  readonly settingsAdminService: SettingsAdminService;
  readonly settingsCacheAdminService: CacheAdminService;
  readonly settingsShopInfoResolver: ShopInfoResolver;
  readonly settingsHomepageResolver: HomepageResolver;
  readonly settingsProductCardButtonsResolver: ProductCardButtonsResolver;
  readonly settingsSpeculationRulesResolver: SpeculationRulesResolver;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    settingsCacheAdminService: ctx
      .asFunction(({ redis }: SettingsCradle) => new CacheAdminService(redis))
      .singleton(),

    settingsShopInfoResolver: ctx
      .asFunction(
        ({ emFactory }: SettingsCradle) =>
          new ShopInfoResolver(emFactory, lazyPort<SettingsService>(ctx, 'settingsReadPort')),
      )
      .singleton(),

    settingsHomepageResolver: ctx
      .asFunction(
        ({ emFactory }: SettingsCradle) =>
          new HomepageResolver(emFactory, lazyPort<SettingsService>(ctx, 'settingsReadPort')),
      )
      .singleton(),

    settingsProductCardButtonsResolver: ctx
      .asFunction(
        ({ emFactory }: SettingsCradle) =>
          new ProductCardButtonsResolver(
            emFactory,
            lazyPort<SettingsService>(ctx, 'settingsReadPort'),
          ),
      )
      .singleton(),

    settingsSpeculationRulesResolver: ctx
      .asFunction(
        ({ emFactory }: SettingsCradle) =>
          new SpeculationRulesResolver(
            emFactory,
            lazyPort<SettingsService>(ctx, 'settingsReadPort'),
          ),
      )
      .singleton(),
  });

  // The type parameter is feature 075 Phase P's compile-time proof that this
  // service still satisfies `SettingsAdminPort` — the write surface six
  // modules reach, each hosting an admin screen over settings it owns. The
  // read side is not published here on purpose: `settingsReadPort` is a kernel
  // port, because every module reads its own settings and the kernel applies
  // the channel-scope rules.
  ctx.di.providePort<SettingsAdminPort>(
    'settingsAdminService',
    ctx
      .asFunction(
        ({
          emFactory,
          eventBus,
          auditLogService,
          settingsSecretEncryptionKey,
          settingsModulePresence,
        }: SettingsCradle) =>
          new SettingsAdminService(
            emFactory,
            eventBus,
            // Read per call rather than captured: `settingsCache` is a root
            // contribution, made in the slot *after* `composeModules`, so
            // destructuring it here would resolve a name that does not exist
            // yet. A forwarder is the same shape `returnsBridge` uses.
            {
              invalidateAfterWrite: (code) =>
                ctx.cradle<SettingsCradle>().settingsCache.invalidateAfterWrite(code),
              invalidateAllAfterWrite: () =>
                ctx.cradle<SettingsCradle>().settingsCache.invalidateAllAfterWrite(),
            },
            auditLogService,
            settingsSecretEncryptionKey,
            settingsModulePresence,
          ),
      )
      .singleton(),
  );

  ctx.routes(async (app) => {
    const cradle = ctx.cradle<SettingsCradle>();
    const requireAdmin = cradle.requireAdmin;

    await registerSettingsAdminRoutes(app, {
      // Lazily, even though the module owns this port: route *registration* runs
      // inside `buildServer` whatever the module's effective state is, so
      // destructuring the gate here would stop the next start instead of
      // stopping the routes (D-40) — and this module is deactivatable on
      // purpose, so that state is one an operator can actually produce.
      adminService: lazyPort<SettingsAdminService>(ctx, 'settingsAdminService'),
      requireAdmin,
      resolveAdminAuditContext: (req) =>
        ctx.cradle<SettingsCradle>().adminAuditActorResolver(req),
    });
    await registerSettingsStorefrontRoutes(app, {
      shopInfoResolver: cradle.settingsShopInfoResolver,
    });
    await registerSettingsCacheRoutes(app, {
      cacheAdminService: cradle.settingsCacheAdminService,
      requireAdmin,
    });
    await registerSettingsHomepageRoutes(app, {
      homepageResolver: cradle.settingsHomepageResolver,
    });
    await registerSettingsProductCardButtonsRoutes(app, {
      productCardButtonsResolver: cradle.settingsProductCardButtonsResolver,
    });
    await registerSettingsSpeculationRulesRoutes(app, {
      speculationRulesResolver: cradle.settingsSpeculationRulesResolver,
    });
  });
}
