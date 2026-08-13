import type { EntityManager } from '@mikro-orm/postgresql';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { Asset } from './entities/asset.entity.js';
import { AssetFolder } from './entities/asset-folder.entity.js';
import { assetsLibraryModule } from './plugin.js';

/**
 * `assets_library` — the module whose permission gate defaulted to open
 * (feature 072, wave 1, T092).
 *
 * The conversion is otherwise unremarkable: one construction site per root, one
 * plugin, a registry three other modules register their reference resolvers
 * into. What is worth stopping on is the option shape it had:
 *
 *     // Permission gate factory. When omitted, a permissive no-op is used.
 *     requireAdmin?: RequireAdminFactory;
 *
 * Both roots do pass one, so nothing was open in production. But a **security
 * gate that defaults to permissive** is the class of latent defect this wave has
 * now removed three times over — `addresses`' unvalidated writes,
 * `customer_accounts`' MFA-less auth service, `orders`' unarmed address service.
 * An optional argument whose omission is silent, whose default is the unsafe
 * direction, and which no test notices because the safe path is the one
 * exercised. Resolving `requireAdmin` from the container removes the option
 * entirely: there is no omission left to be silent about.
 *
 * **One registration holds the whole module result**, plugin and handle
 * together. Registering them separately would mean two `assetsLibraryModule`
 * calls per composition — the routes serving one `AssetsLibraryService` and one
 * `AssetReferenceRegistry` while `catalog`, `cms` and `megamenu` registered
 * their resolvers into a different pair. That is exactly the multi-instance
 * defect this wave keeps removing, and it is easy to write by accident here,
 * because the factory returns two things that look independent.
 */

export const entities = [Asset, AssetFolder];

type AssetsLibraryResult = ReturnType<typeof assetsLibraryModule>;

export interface AssetsLibraryCradle {
  readonly emFactory: () => EntityManager;
  readonly auditLogService: AuditLogService;
  readonly requireAdmin: RequireAdminFactory;
  readonly assetsLibrary: AssetsLibraryResult;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    assetsLibrary: ctx
      .asFunction(({ emFactory, auditLogService }: AssetsLibraryCradle) =>
        assetsLibraryModule({
          emFactory,
          // Resolved per check, not captured. Awilix's strict mode refuses a
          // singleton holding the transient `requireAdmin` port, and it is
          // right to: a captured guard keeps admitting requests after `auth`
          // goes away. This indirection is what the gate being non-optional
          // buys — there is one guard, and it is always the live one.
          requireAdmin: (permission) => async (req, reply) =>
            ctx.cradle<AssetsLibraryCradle>().requireAdmin(permission)(req, reply),
          auditLog: auditLogService,
        }),
      )
      .singleton(),
  });

  ctx.di.providePort(
    'assetReferenceRegistry',
    ctx
      .asFunction(({ assetsLibrary }: AssetsLibraryCradle) => assetsLibrary.handle.referenceRegistry)
      .singleton(),
  );

  ctx.routes(async (app) => {
    await ctx.cradle<AssetsLibraryCradle>().assetsLibrary.plugin(app);
  });
}
