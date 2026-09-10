import type { EntityManager } from '@mikro-orm/postgresql';
import type {
  AssetReadPort,
  AssetsLibraryPort,
  ObjectStoragePort,
} from '@endora-commerce/contracts';
import type { AuditPort } from '@endora-commerce/platform/kernel';
import { resolvePublicApiBaseUrl } from '@endora-commerce/platform/kernel';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import type { RequireAdminFactory } from '@endora-commerce/platform/kernel';
import { assetsLibraryModule } from './plugin.js';
import { AssetReadService } from './services/asset-read-port.js';
import { ObjectStorageAdapter } from './services/storage/object-storage-port.js';
import { AssetFolder } from './entities/asset-folder.entity.js';
import { Asset } from './entities/asset.entity.js';

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
  readonly auditLogService: AuditPort;
  readonly requireAdmin: RequireAdminFactory;
  readonly assetsLibrary: AssetsLibraryResult;
}

export function registerModule(ctx: ModuleContext): void {
  ctx.di.register({
    assetsLibrary: ctx
      .asFunction(({ emFactory, auditLogService }: AssetsLibraryCradle) =>
        assetsLibraryModule({
          emFactory,
          // D-223 — this module resolves the deployment's public API origin
          // itself, the idiom `payu`, `tpay` and `inpost` already use for their
          // callback origins, and every URL it produces is built on it when the
          // storage adapter's own configured base is blank. It is read here,
          // inside the factory, so the value is the one this composition boots
          // with; the platform has already refused a production boot that has
          // no origin at all (issue #218), so there is no new failure mode.
          publicApiBaseUrl: resolvePublicApiBaseUrl(),
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
   * backend stopped starting. A descriptor is inert; `assetsLibraryPort`, which
   * reads and writes assets, is the port and does fail closed. (That sentence
   * named `assetsLibraryService` until T118c, which is the container name the
   * roots contributed rather than a port — it was never gated, and it is gone.)
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
  // text, soft-delete what an item stopped pointing at. Since T118c it is also
  // what `cms` resolves to turn an embedded asset id into the detail a
  // storefront response carries.
  //
  // **Phase C has retired the root's entry** (`specs/110-instance-repository/`
  // T118c). This note used to read *"the existing `assetsLibraryService` name is
  // still contributed by a composition root; the root's entry stays until Phase
  // C retires it, and the two resolve the same instance"*. Both roots
  // contributed that name and, by the time it was drained, **no module resolved
  // it**: `pim_ergonode` moved to this port at feature 075's cut and the second,
  // ungated hold on the same service stayed behind. So the drain cost nothing
  // and bought the one thing the duplicate could not have — there is now exactly
  // one way in, and it is gated.
  //
  // What is still a composition's, and why it is not an omission. This note
  // read *"five reaches … `resolveUrl` (three of them, two of those also
  // folding in the host's public API base URL)"* against a tree holding
  // **eight** reaches, **four** of them `resolveUrl` and **three** of those
  // absolutizing. The count is not written down again (D-100):
  // `grep -n 'assetsLibrary\.' backend/src/composition.ts` answers it. What is
  // true of the reaches that remain is that each needs something this port does
  // not publish — `resolveUrl`, or the storage adapters' byte-streaming surface
  // (`invoices`' logo embed, `product_feeds`' artefact writer).
  //
  // **What no reach does any more is absolutize** (D-223). The three that did
  // did it three ways — `absolutizePublicUrl` reading `BACKEND_PUBLIC_URL`
  // first at two of them, `configuredPublicApiBaseUrl` plus a hand-written join
  // reading `PUBLIC_API_BASE_URL` first at the third — while the fourth
  // `resolveUrl` reach did not absolutize at all, so one asset had three
  // answers depending on which consumer asked, and the two composition roots
  // disagreed at two of the sites. This module resolves the origin itself now
  // and every URL it returns is absolute.
  //
  // **`objectStoragePort` is the byte-store answer** (T118c), and it is a
  // sibling of `assetsLibraryPort` rather than four more methods on it: what
  // `product_feeds` borrows is *which bucket this deployment writes to, with
  // which credentials*, and it creates no `Asset` row. `invoices`' logo embed
  // asks the identical question through a composition root and drains onto the
  // same port. The published shape's own doc block carries its retiring
  // condition — this is really an object store, and it lives here because the
  // configuration does.
  //
  // **And the URL answer is `assetReadPort.resolvePublicUrls`, in batch.** This
  // note read *"a consumer that wants a URL for an asset id takes
  // `AssetsLibraryPort.getAsset`, which already carries one"*, and that is the
  // right answer for `cms` resolving a handful of embeds on one page. Measured
  // for a consumer that asks about hundreds at a time, it is not: `getAsset`
  // builds the full detail, and the detail carries the deletion-protection
  // `references` list, which is one query per registered reference descriptor —
  // roughly ten queries per asset against a feed hydration batch of 500
  // products. The batched read is one query and a string build per row, and it
  // is the *rule* that moves with it rather than only the loop: only this
  // module can tell a stable URL from a signed one, so the filter belongs here
  // and the absence is the return type (composition checklist item 7).
  // ---------------------------------------------------------------------------

  ctx.di.providePort<AssetReadPort>(
    'assetReadPort',
    ctx
      .asFunction(
        ({ emFactory, assetsLibrary }: AssetsLibraryCradle) =>
          // The registry is read per call, never captured: it is rebuilt when
          // the active-backend setting changes, and a URL built by yesterday's
          // adapter points at a bucket this deployment no longer writes to.
          new AssetReadService(emFactory, () => assetsLibrary.handle.adapters),
      )
      .singleton(),
  );

  ctx.di.providePort<AssetsLibraryPort>(
    'assetsLibraryPort',
    ctx
      .asFunction(({ assetsLibrary }: AssetsLibraryCradle) => assetsLibrary.handle.service)
      .singleton(),
  );

  ctx.di.providePort<ObjectStoragePort>(
    'objectStoragePort',
    ctx
      .asFunction(
        ({ assetsLibrary }: AssetsLibraryCradle) =>
          new ObjectStorageAdapter(assetsLibrary.handle.adapters),
      )
      .singleton(),
  );

  ctx.routes(async (app) => {
    await ctx.cradle<AssetsLibraryCradle>().assetsLibrary.plugin(app);
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
  AssetFolder,
  Asset,
];
