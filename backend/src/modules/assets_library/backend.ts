import type { EntityManager } from '@mikro-orm/postgresql';
import type { AssetReadPort, AssetsLibraryPort } from '@b2b/contracts';
import type { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { ModuleContext } from '../../kernel/index.js';
import type { RequireAdminFactory } from '../../kernel/ports/require-admin.js';
import { assetsLibraryModule } from './plugin.js';
import { AssetReadService } from './services/asset-read-port.js';

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

  /**
   * The contribution seam, deliberately **ungated** (feature 072, D-39).
   *
   * `catalog`, `cms`, `blog` and `megamenu` push their reference scanners in
   * from `ctx.onBoot`, and boot hooks run regardless of effective state. As a
   * `providePort` this was a transient gate, so switching `assets_library` off
   * made all four hooks throw `MODULE_DISABLED` during composition and the
   * backend stopped starting. A descriptor is inert; `assetsLibraryService`,
   * which reads and writes assets, is the port and does fail closed.
   *
   * Whether an entry is honoured while its contributor is absent is answered at
   * enumeration — see `services/reference-registry.ts`.
   *
   * `AssetReferenceRegistryPort` is published over this name all the same, which
   * is not a reason to convert it back (issue #192): a published shape and a
   * gated registration are different questions, and only the first is what F4
   * packages.
   */
  ctx.di.register({
    assetReferenceRegistry: ctx
      .asFunction(({ assetsLibrary }: AssetsLibraryCradle) => assetsLibrary.handle.referenceRegistry)
      .singleton(),
  });

  // ---------------------------------------------------------------------------
  // Feature 075, Phase P — the published surface.
  //
  // `assetReadPort` replaces the five `em.findOne(Asset, …)` calls `catalog`
  // and `orders` make to validate an id an admin supplied before attaching it.
  //
  // `assetsLibraryPort` is the narrow face of the library service that
  // `pim_ergonode` uses during an import — upload, read, patch the alternate
  // text, soft-delete what an item stopped pointing at. It is registered here,
  // by the module, where the existing `assetsLibraryService` name is still
  // contributed by a composition root; the root's entry stays until Phase C
  // retires it, and the two resolve the same instance.
  // ---------------------------------------------------------------------------

  ctx.di.providePort<AssetReadPort>(
    'assetReadPort',
    ctx
      .asFunction(({ emFactory }: AssetsLibraryCradle) => new AssetReadService(emFactory))
      .singleton(),
  );

  ctx.di.providePort<AssetsLibraryPort>(
    'assetsLibraryPort',
    ctx
      .asFunction(({ assetsLibrary }: AssetsLibraryCradle) => assetsLibrary.handle.service)
      .singleton(),
  );

  ctx.routes(async (app) => {
    await ctx.cradle<AssetsLibraryCradle>().assetsLibrary.plugin(app);
  });
}
