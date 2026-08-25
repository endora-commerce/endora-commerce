import type { AssetsLibraryCradle } from './modules/assets_library/backend.js';
import type { CartShoppingListBridge, CartsCradle } from './modules/carts/backend.js';
import type { FastifyRequest } from 'fastify';
import { randomUUID } from 'crypto';
import { Redis } from 'ioredis';
import { z } from 'zod';
import type { MikroORM, EntityManager } from '@mikro-orm/postgresql';
import { ERROR_CODES, type ProductAvailability } from '@endora-commerce/contracts';
// Feature 080 (T052) — the contract types for the seven ports that replaced
// this root's five entity-class reads. Types only: what a root resolves is a
// container name, and the shape it resolves it against is published in
// `@endora-commerce/contracts` rather than imported from the provider.
import type {
  AdminPasswordVerificationPort,
  AdminRolePort,
  AdminUserReadPort,
  AssetReadPort,
  CustomerAccountReadPort,
  CustomerPasswordVerificationPort,
  CustomerRollupScopePort,
  OrderReadPort,
  SettingsManifestCollectionPort,
} from '@endora-commerce/contracts';
import { HttpError } from './http/error-envelope.js';
import type { ModulePlugin } from './http/server.js';
import { ApiInterceptorRegistry } from './http/interceptors/index.js';
import type { ErrorEnvelopeOptions } from './http/error-envelope.js';
import { initOrm, closeOrm } from './db/index.js';
import { EventBus } from './events/bus.js';
import { CommandBus } from './commands/index.js';
import { forkScopedEm } from './tenancy/scoped-em.js';
import { type TenantContext } from './tenancy/tenant-context.js';
import { resolveTenantContext, systemTenantContext } from './tenancy/resolve-tenant-context.js';
import { enterSystemScope } from './kernel/scope.js';
import { registerRequestScopeHook } from './kernel/request-scope-hook.js';
// Feature 072 — the generated module list. D-45 collapsed the early/late split
// into a single pass: registration resolves nothing (`kernel/compose.ts`'s
// `registering` guard), so the order modules register in carries no meaning,
// and every contribution this root makes over a name a module defaults belongs
// in the one slot between `composeModules` and `runBootHooks`.
//
// Issue #52 — that slot is `composedModules.contribute(…)`, so it is no longer
// a convention two roots had to spell identically. The window's early edge is
// structural (there is nothing to call the method on until every module has
// registered) and its late edge throws `ContributionWindowClosedError`.
// `registerValues` stays for the host values no module defaults, which have no
// window because there is nothing to overwrite.
import { MODULES } from './composition.generated.js';
// The published half — `configuredPublicApiBaseUrl` and `resolvePublicApiBaseUrl`
// are on the barrel because five modules read them (§1.3 row 6's "+4"), and
// `ModuleContext` because 67 do: `ComposeAppHandle.contextFor` hands one out, so
// a CLI command's body resolves with `lazyPort(ctx, …)` exactly as `backend.ts`
// does (T042b, D-157.12 item 2).
import {
  configuredPublicApiBaseUrl,
  resolvePublicApiBaseUrl,
  type ModuleContext,
} from './kernel/index.js';
// The composition machinery, by relative path. T042c took it off the barrel: a
// packaged module never builds a container, composes a module list or refuses a
// boot, so publishing these would put the host's own wiring into
// `@endora-commerce/platform`'s contract. This root is *inside* that package,
// which is exactly why the relative path is available to it and not to a module.
// `KernelContainer` is here for the same reason — `ComposeAppHandle` exposes the
// container to the CLI entry point, which is host code, not a module.
import { composeModules } from './kernel/compose.js';
import {
  createRootContainer,
  registerOrm,
  registerValues,
  type KernelContainer,
} from './kernel/container.js';
import { createRegistrationOwnership } from './kernel/module-context.js';
import { platformLogger } from './kernel/logging.js';
import { requiredModulesFrom } from './kernel/lifecycle/required-modules.js';
import {
  absolutizePublicUrl,
  assertPublicApiBaseUrlConfigured,
} from './kernel/public-api-base-url.js';
import { promoteAdminActor } from './modules/auth/plugin.js';
import { AuditLogService } from './kernel/audit/audit-log-service.js';
import { publishStateChanged, registryCache } from './kernel/lifecycle/registry-cache.js';
import { effectiveState } from './kernel/lifecycle/effective-state.js';
import { StorefrontRevalidator } from './http/storefront-revalidator.js';
// Feature 072 (T138) — `organizations` owns its services, its routes and its
// two event subscriptions. T143a — the sales-rep assignment scope too: what is
// left here is the actor half of the orders/RFQ visibility question, which only
// a composition can answer.
import type { OrganizationTreeService } from './modules/organizations/services/organization-tree-service.js';
import type { OrganizationTaxProfilePort } from './modules/organizations/backend.js';
// Feature 072 (T079) — `email` is composed through the kernel. The driver
// decision that used to sit in this file is one registration in its
// `backend.ts`; what stays here is the cradle shape the senders below resolve
// through. The URL helper that also stayed was `absolutizePublicUrl`, and
// feature 080's T040b moved it to the platform: it had no consumer inside
// `email` at all, so it was a deployment-origin helper filed under the module
// that first needed it — and a root value import of a module's source is a
// spelling that ends the day that module becomes a package (D-160.6.1).
import type { EmailCradle } from './modules/email/backend.js';
// Feature 046 — Returns & Complaints (Refunds, RMA).
import type { ReturnsBridge } from '@endora-commerce/mod-returns/backend';
import type { InvoicesBridge } from './modules/invoices/backend.js';
import type { KsefCradle } from '@endora-commerce/mod-ksef/backend';
import type { ProductFeedsBridge } from './modules/product_feeds/backend.js';
import type { AdminUsersCradle } from './modules/admin_users/backend.js';
import type { MfaActorBridge } from '@endora-commerce/mod-mfa/backend';
import type { TargetValidatorDeps } from './modules/megamenu/services/target-validator.js';
import type { StorefrontDeps } from './modules/megamenu/services/storefront-resolver.js';
import type { CustomerAccountsCradle } from './modules/customer_accounts/backend.js';
import type { TaxesCradle } from '@endora-commerce/mod-taxes/backend';
import { composeSettingsKernel } from './kernel/settings/compose.js';
import { ManifestReconciler } from './kernel/settings/manifest-reconciler.js';
import { composeSalesChannelsKernel } from './kernel/sales-channels/compose.js';
import type { SalesChannelsCradle } from '@endora-commerce/mod-sales-channels/backend';
import { DefaultChannelReconciler } from './kernel/sales-channels/default-channel-reconciler.js';
import type { ComparisonsCradle } from '@endora-commerce/mod-comparisons/backend';
// Feature 046 — Progressive Web App.
import type { PwaBridge } from '@endora-commerce/mod-pwa/backend';
// Feature 047 — Transactional Emails.
// Feature 048 — Newsletter.
import type { NewsletterBridge } from '@endora-commerce/mod-newsletter/backend';
// Feature 049 — Google Analytics.
// Feature 063 — LinkedIn Ads.
// Feature 064 — Meta Ads.
// Feature 066 — Google Tag Manager.
import { SalesChannel } from './kernel/sales-channels/sales-channel.entity.js';
import { createRequestLanguageResolver } from './kernel/i18n/request-language.js';
import { lifecycleModuleFromStaticEntries } from './modules/_lifecycle/plugin.js';
import { loadModulePresence } from './modules/_lifecycle/services/presence-load.js';
import {
  deploymentShippedEntries,
  resolvedManifestEntries,
  type RegisteredManifestEntry,
} from './modules/_lifecycle/registered-manifests.js';
// Feature 057 — per-deployment overlay resolution (build/composition-time).
import { loadOverlayModuleEntries } from './overlay/overlay-runtime.js';
// Feature 080 — installed extension packages, discovered at runtime (D-155).
import { loadPackageModuleEntries } from './packages/package-runtime.js';
import { configuredMigrations } from './db/configured-migrations.js';
import type { AdminI18nCradle } from './modules/_i18n/backend.js';
// D-54 — the error envelope takes this map by injection: `src/http` is a
// kernel-obeying platform peer and may not name a module (D-52). A root may.
import { ERROR_TRANSLATION_KEYS } from './modules/_i18n/services/error-translation.js';
import type { CatalogQueryService } from './modules/catalog/services/catalog-query.service.js';
import type { ModuleSettingsManifest } from '@endora-commerce/contracts';
import type { ShoppingListService } from '@endora-commerce/mod-shopping-lists/backend';

/**
 * Production composition root.
 *
 * Wires every business module against:
 *   - the real auth plugin (cookie / Bearer token → `request.actor`)
 *   - a permission-checked `requireAdmin` that consults `PermissionService`
 *   - resolvers that read from `request.actor` instead of the test-only
 *     `request.testActor` shim used by `test/helpers/test-server.ts`
 *
 * The dev script (`pnpm --filter backend run dev`) and the prod entry
 * (`backend/src/index.ts`) both call `composeApp({ app })` after
 * `buildServer({ ... modules: [] })`.
 */

export interface ComposeAppHandle {
  orm: MikroORM;
  redis: Redis;
  modules: ModulePlugin[];
  errorEnvelope: ErrorEnvelopeOptions;
  /** Feature 054 — the Command Bus, exposed so migrated module wiring can consume it. */
  commandBus: CommandBus;
  /**
   * Feature 060 — the API interceptor registry. index.ts passes it to
   * `buildServer({ apiInterceptors })`; modules receive it through their
   * factory options / OverlayModuleContext and register during composition.
   */
  apiInterceptors: ApiInterceptorRegistry;
  /**
   * Feature 080 (T042b, D-157.12 item 1) — the composed kernel container.
   *
   * The harness handle has exposed it since feature 072 and this one did not,
   * which made the production root the odd one out among the two roots
   * `harness-parity.test.ts` holds to each other. Passing it is mandatory
   * rather than convenient for anything that opens a scope over this
   * composition: `composeApp` deliberately does **not** call `setRootContainer`
   * (see the reason at the container's construction below), so an
   * `enterSystemScope` with no `container` branches off a process-wide root
   * that has nothing registered.
   */
  container: KernelContainer;
  /**
   * Feature 080 (T042b, D-157.12 item 2) — a post-registration `ModuleContext`
   * for one composed module, forwarded from `ComposedModules.contextFor`.
   *
   * The host's CLI runner is its caller: a module-declared command receives a
   * `ModuleContext` rather than a cradle, so its body resolves with
   * `lazyPort<T>(ctx, 'literalName')` and `check:port-dependencies` keeps its
   * line of sight (D-157.7).
   */
  contextFor: (moduleId: string) => ModuleContext;
  /**
   * Feature 080 (T042b) — the instance-resolved manifest set this composition
   * was actually built from: core, this deployment's overlay modules and every
   * installed package.
   *
   * Exposed rather than re-derived by the caller. `resolvedManifestEntries()`
   * is memoised per `node_modules` root and would answer the same, but a
   * second call is a second answer waiting to disagree with the first — and the
   * property that makes a package's declared command reachable at all is that
   * the host reads the commands off the **same** entries it composed.
   */
  resolvedModules: readonly RegisteredManifestEntry[];
  /** Closes the ORM + redis connection; call from a SIGTERM handler. */
  dispose: () => Promise<void>;
}

/** Pick a display label from a possibly-multilingual (jsonb) name value. */
function anyLabel(name: unknown): string {
  if (typeof name === 'string') return name;
  if (name && typeof name === 'object') {
    const values = Object.values(name as Record<string, string>);
    return values[0] ?? '';
  }
  return '';
}

export async function composeApp(): Promise<ComposeAppHandle> {
  // Issue #218 — before anything is opened, refuse a production boot with no
  // public origin. `PUBLIC_API_BASE_URL` is what every payment-gateway callback
  // URL, public product-feed URL and newsletter confirmation link is built on,
  // and its old `http://localhost:3001` default produced a wrong-but-plausible
  // URL nothing logged and nothing refused. Both deployment entry points
  // (`index.ts`, `worker.ts`) go through this function, so one line covers both
  // — and `index.ts` already turns a throw from here into a "this is almost
  // always a configuration problem" message plus `exit(1)`.
  assertPublicApiBaseUrlConfigured();

  const orm = await initOrm();
  // Feature 050 — the single EM-injection seam. `forkScopedEm` is a bare
  // `orm.em.fork()`: it stamps NOTHING, because the tenant filters read the
  // ambient TenantContext from AsyncLocalStorage **when the query is built**
  // (`tenancy/filters.ts`), not when the manager is forked. That is what makes
  // the EntityManager stateless with respect to tenancy, and it is the property
  // the whole request seam rests on — a fork taken in one context and used in
  // another is scoped by the context it is *used* in (feature 072, T038; see
  // `test/integration/tenancy/fault-injection.test.ts`). The seam is inert until
  // an entity is classified (@OrgScoped/@CustomerScoped attach the filters).
  const em = (): EntityManager => forkScopedEm(orm);

  // Feature 072 — the kernel container. Modules composed through
  // `composeModules` register into it; the deployment values assembled below
  // are handed to that call and register nothing themselves.
  //
  // It is deliberately **not** installed as the process root
  // (`setRootContainer`). Doing so makes every `enterPlatformScope` branch a
  // child off this graph, and a scope is what lives in an `AsyncLocalStorage`
  // store — so every retained store starts pinning a whole composed
  // application. `ctx.cradle()` therefore resolves through this container
  // directly, which is also the better contract while two roots exist: what a
  // name resolves to is a property of the composition, not of where the call
  // happens.
  //
  // Phase 4 measured the cost: the suite died with `JavaScript heap out of
  // memory` at file 78 of 930 with the root installed. Phase 5 re-measured it
  // on the generated composer — the condition its deferral was pinned to — and
  // the answer did not move: file 72 of 930, 348 s, 5.1 GB. It could not have.
  // Production composes one application per process; the **test harness
  // composes 555 per run**, and that is what the retention scales with. The
  // number to change is the number of live compositions, which belongs to the
  // harness convergence (T070–T077), not to this file.
  const container = createRootContainer();
  registerOrm(container, orm);
  // One ledger for the whole boot, so two modules composed in different
  // `composeModules` calls still collide loudly on a shared registration name.
  const registrationOwnership = createRegistrationOwnership();

  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  // Principle X deployment dial. BACKEND_ROLE controls whether this process
  // runs queue consumers (workers):
  //   - unset / 'all'    → API + co-located workers (default single-VPS)
  //   - 'api'            → HTTP only; workers run in a separate `pnpm worker`
  //   - 'worker'         → workers only (set by src/worker.ts; no HTTP listen)
  const backendRole = process.env['BACKEND_ROLE'] ?? 'all';
  const runWorkers = backendRole !== 'api';
  // Feature 018 — separate ioredis client for the module-state pub/sub
  // channel. ioredis multiplexes commands and subscriptions on different
  // sockets, so we keep them on different clients to avoid the "subscribed
  // mode" command restriction on the main client.
  const redisSubscriber = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });

  const auditLogService = new AuditLogService(em);

  // Feature 057 — resolve the per-deployment overlay once. For a bare-core
  // build (no DEPLOYMENT / no overlay dir) all of these are empty and the wiring
  // below is byte-for-byte unchanged. `resolvedRegistry` = the hand-maintained
  // core registry + overlay-only modules (the core array is never edited).
  // D-104 — one implementation of "the deployment-resolved manifest set", and
  // one of "the deployment's composed modules". Both are runtime discoveries
  // over the deployment root, because both answers depend on which deployment
  // this process runs as rather than on the tree a generator was run against.
  // This root used to merge the manifests itself while `resolvedManifestEntries()`
  // merged them again from the generated index; the one under test was not the
  // one that ran.
  const resolvedRegistry = await resolvedManifestEntries();
  const overlayModuleEntries = await loadOverlayModuleEntries();
  // Feature 080 (T031, D-119/D-155) — the same shape, one axis out: every
  // Endora module package installed in this instance's `node_modules`. The
  // committed registries stay bare core for D-104's reason, so this is the only
  // thing that knows a package is here.
  const packageModuleEntries = await loadPackageModuleEntries();

  // Feature 072 (D-38) — module presence is a **composition input**, so it is
  // loaded here: before the first module registers, and therefore before any
  // boot hook, plugin body or worker registration asks for it. It used to be
  // warmed inside `_lifecycle`'s plugin body, which runs in `buildServer` —
  // after all of them — and the platform stopped booting the moment a boot hook
  // resolved a gated port, because the cache still answered "not installed" for
  // everything.
  //
  // Awaited and fatal, and that costs nothing new: `initOrm()` above already
  // makes a reachable PostgreSQL a boot precondition. Arming the Redis pub/sub
  // side is separate (`registryCache.watch()`, from `_lifecycle`'s plugin) and
  // must never fail a boot — a lost notification channel means stale, not off.
  await enterSystemScope(
    'boot: load module presence',
    // The **entries**, not their manifests: `loadModulePresence` narrows the
    // first-boot insert to what this build ships (D-157.6(b)), and `filePath` is
    // what says which entry that is. Everything else it does — both D-101
    // refusals, the gating graph, the activation declarations, the cache itself
    // — still reads the whole resolved set.
    () => loadModulePresence({ em, entries: resolvedRegistry }),
    { entryPoint: 'boot' },
  );

  const eventBus = new EventBus();

  // Feature 054 (Principle XIII) — the Command Bus: the single, guaranteed audit
  // writer for sensitive writes. It forks the scoped EM, runs the write + one
  // audit insert co-transactionally, and dispatches the domain event on commit.
  // Threaded into module factories alongside `eventBus` as writes are migrated.
  const commandBus = new CommandBus(orm, auditLogService, eventBus);

  // Feature 060 — API interceptor registry. Modules register pre/post
  // interceptors against endpoints owned by other modules; execution is
  // lifecycle-gated per interceptor via the enabled-set cache predicate.
  const apiInterceptors = new ApiInterceptorRegistry({
    isModuleEnabled: (moduleId) => registryCache.isEnabled(moduleId),
  });

  // Feature 072 — the **host values** this root owns outright. No module
  // registers a default for any of them, so they have no contribution window
  // (D-45's one-slot rule is about overwriting a module's default) and are
  // registered where the value comes into existence rather than after
  // `composeModules`. Everything a module does default is contributed below,
  // between that call and `runBootHooks()`.
  registerValues(container, {
    redis,
    // Feature 072 (T125) — the interceptor registry, so `_lifecycle` can serve
    // the read-only diagnostics screen over it. It was already declared
    // platform-owned; until this conversion nothing resolved it by name, so
    // nothing noticed that no root registered it.
    apiInterceptors,
    // The module's `ctx.onBoot` schedule reconcile resolves this (T131), and
    // nothing else in this file has an opinion about it.
    pimErgonodeRunWorkers: runWorkers,
    productFeedsRunWorkers: runWorkers,
    productFeedsPublicBaseUrl: resolvePublicApiBaseUrl(),
    productFeedsTokenEncryptionKey: process.env['SETTINGS_SECRET_ENCRYPTION_KEY'],
    // The one connection ioredis has put into subscriber mode. Shared, because
    // a subscriber connection cannot serve commands: a per-module one would
    // cost a socket per module and buy nothing.
    redisSubscriber,
    // Modules announce on it; `ctx.subscribe` receives on it. A module that
    // publishes needs it as a registration, not just as a composer option.
    eventBus,
    // The audited write path (Principle XIII). A converted module resolves it
    // like any other platform service.
    commandBus,
    // The resolved registry — core manifests plus this deployment's overlay
    // modules. `admin_roles` builds the permission catalogue from it and cannot
    // see it itself: which modules a deployment ships is a composition-root
    // input, not something a module decides.
    resolvedModuleRegistry: resolvedRegistry,
    auditLogService,
    // Feature 072 (T138) — the three `organizations` inputs no module defaults.
    //
    // `customerOrganizationIdResolver` is the actor half of what used to be
    // `buildOrgAllowListResolver`: who is asking, as a bare Organization id.
    // Soft by contract — `null` for anonymous traffic *and* for a Customer with
    // no Organization — which is why it cannot reuse `customerContextResolver`,
    // that one throwing 401/422 for both. Catching that to mean "unrestricted"
    // is the fail-open hazard this split exists to remove.
    customerOrganizationIdResolver: (request: FastifyRequest): string | null => {
      const actor = (request as { actor?: { kind: string; organizationId?: string | null } }).actor;
      return actor?.kind === 'customer' ? (actor.organizationId ?? null) : null;
    },
    storefrontBaseUrl: process.env['STOREFRONT_BASE_URL'] ?? 'http://localhost:3000',
    // No verification-token probe outside the harness.
    organizationsExposeTestProbe: false,
  });
  // T143a — `search`'s full-reindex port, read lazily. `catalog` triggers a
  // reindex when an attribute's `searchable` flag flips, and the module that
  // owns the indexer is the one that must answer for it.
  const searchCradle = (): {
    searchReindexPort: { reindexAll(): Promise<{ documentCount: number }> };
  } => container.cradle as never;

  // Feature 080 (T052) — the ports that replaced this root's reads of five
  // other modules' entity classes: `CustomerAccount`, `AdminUser`,
  // `AdminRole`, `Order` and `Asset`.
  //
  // The reason is packaging rather than the boundary. A composition root is
  // explicitly not a platform root (D-52/D-53), so naming those classes was
  // legal; what ends it is D-168 — a module package publishes `entities` and
  // no named entity class, so the day one of the five moves, a root that names
  // its class stops compiling and there is no import to fix.
  //
  // Read lazily and never captured, like every other port this file reaches:
  // `providePort` registers a transient gate, and a captured one keeps
  // answering after its owner is withdrawn.
  const identityPorts = (): {
    adminUserReadPort: AdminUserReadPort;
    adminRolePort: AdminRolePort;
    adminPasswordVerificationPort: AdminPasswordVerificationPort;
    customerAccountReadPort: CustomerAccountReadPort;
    customerPasswordVerificationPort: CustomerPasswordVerificationPort;
  } => container.cradle as never;

  const orderReadPort = (): OrderReadPort =>
    (container.cradle as never as { orderReadPort: OrderReadPort }).orderReadPort;

  // Feature 080 (T040b) — the two ports that replaced this root's value
  // imports of a module's own sources. Same reason as the block above and the
  // same lazy read: a packaged module publishes `./backend`, not a file path,
  // so a root that names one stops compiling the day its owner moves — and a
  // root that names the *source* of a module the platform composes from `dist`
  // evaluates it twice, which fails silently rather than loudly (D-160.6.1).
  const customerRollupScopePort = (): CustomerRollupScopePort =>
    (container.cradle as never as { customerRollupScopePort: CustomerRollupScopePort })
      .customerRollupScopePort;

  const settingsManifestCollectionPort = (): SettingsManifestCollectionPort =>
    (
      container.cradle as never as {
        settingsManifestCollectionPort: SettingsManifestCollectionPort;
      }
    ).settingsManifestCollectionPort;

  const assetReadPort = (): AssetReadPort =>
    (container.cradle as never as { assetReadPort: AssetReadPort }).assetReadPort;

  // T143a — `inventory`'s availability port, read lazily.
  const inventoryCradle = (): {
    inventoryAvailabilityPort: {
      resolveAvailabilityBands(
        productIds: string[],
        salesChannelId: string,
      ): Promise<Map<string, { band: string; inStock: boolean }>>;
    };
  } => container.cradle as never;

  // Where this call sits no longer decides whether a cache is fresh, and that
  // is the point of D-93. It used to: the sales-channel cache invalidator
  // subscribed to the EventBus, `EventBus.dispatch` awaits its handlers in
  // registration order, and composing it before the modules was the one
  // ordering this root still had to get right (D-45).
  //
  // The settings cache stopped depending on it under issue #45 and the channel
  // cache under D-93: both drops happen at the write seam, awaited after the
  // flush and before the emit, so no registration order — and no buffered
  // `EventBus.run` scope, which is what `CommandBus.run` opens around
  // `sales_channel.set_default` — can defer one past a read.
  //
  // Channel *resolution* is kernel infrastructure for the reason T110 gave:
  // every channel-scoped read depends on it (Principle XII), so it must keep
  // working whether or not an operator wants the administration screens. The
  // module owns the admin CRUD service and its routes, and composes itself.
  const salesChannels = composeSalesChannelsKernel({
    emFactory: em,
    eventBus,
    redis,
    auditLogService,
  });
  // Feature 072 (T118) — the universal settings *reader* is kernel
  // infrastructure: almost every module calls `SettingsService.get`, so it
  // cannot be gated on whether an operator wants the settings screens. The
  // module owns the admin write service, the cache-clear action, the four
  // storefront resolvers and its routes, and composes itself.
  const settings = composeSettingsKernel({
    emFactory: em,
    redis,
    ...(process.env['SETTINGS_SECRET_ENCRYPTION_KEY']
      ? { secretEncryptionKey: process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] }
      : {}),
  });

  // Feature 072 — the **generated** module list, composed in one pass (D-45).
  // Nothing about these modules is named here any more: the list is a walk of
  // the tree, so adding a module is adding a folder and removing one is
  // deleting it. Registration resolves nothing, so this call has no opinion
  // about the order the composer emitted; the boot hooks it collects run once,
  // at the bottom of this function, after every contribution below.
  //
  // D-103/D-104 — the deployment's overlay modules are **appended to this one
  // list**, not composed by a second path. That keeps D-45 exactly as it is
  // (one registration pass, one contribution slot, one `runBootHooks()`) and
  // makes "overlay last, so a deployment's decoration wins" structural: the
  // core list is frozen and the deployment's entries come after it, rather than
  // the ordering being a property of a generator's sort.
  //
  // T031 — and the instance's installed packages after them, in the same one
  // list and for the same reasons. Order is not a privilege here: registration
  // resolves nothing (the `registering` guard), and a package gets no
  // decoration exemption, so "last" buys it nothing a core module does not
  // have.
  const composedModules = composeModules(
    [...MODULES, ...overlayModuleEntries, ...packageModuleEntries],
    {
      container,
      eventBus,
      // Issue #269 — composition runs before `buildServer`, so there is no
      // `app.log` yet. This is late-bound rather than a snapshot: `buildServer`
      // attaches the application's own pino instance the moment it exists, and
      // every line written after that lands there. It used to be the bare global
      // `console` — unstructured, uncorrelated, and outside the stream a
      // deployment ships.
      log: platformLogger(),
      interceptorRegistry: apiInterceptors,
      ownership: registrationOwnership,
      // Issue #258 — the modules this deployment is required to have, derived
      // from the manifest set it resolved above rather than written down (D-100).
      // The composer refuses before the first module registers when one of them
      // is missing, which is what stops a first boot from dying in whichever
      // module's boot hook happened to need it first.
      requiredModules: requiredModulesFrom(resolvedRegistry.map((e) => e.manifest)),
    },
  );

  // Feature 072 (T094) — one `CustomerAuthService` for the composition.
  // `customers` and `organizations` each built their own and the MFA argument
  // differed between them; there is one now, and both modules resolve it as a
  // port rather than being handed it (T138/T140).

  // Feature 072 (T095/T097) — `payment_methods` and `delivery_methods` own
  // their registries, eligibility services and routes now. `orders` resolves
  // them itself, so nothing is read here.
  //
  // T143a — the four built-in payment adapters are gone from this file too.
  // They are `payments`' classes and it seeds them from its own boot hook; a
  // root doing it made the platform's settleable payment kinds a property of
  // the composition, and kept them registered with `payments` switched off.

  // Feature 072 (wave 1) — `admin_roles` owns these three now, and this root no
  // longer holds any of them. `permissionService` is resolved where it is needed
  // (`organizations` reads it as a port for the sales-rep roll-up since T143a),
  // and `permissionCatalogueService` stopped being held here with issue #213:
  // the only reason left was to hand it an enabled-set accessor and a pub/sub
  // invalidation, and both were wrong — the accessor read the platform axis
  // alone, and the memo it invalidated should not have existed. The module reads
  // `effectiveState` itself now and caches nothing.

  // `currencyService` is resolved from the container where it is needed —
  // `pim_ergonode` reads it as a port since T131, and nothing else here did.

  // Feature 072 (wave 1) — `admin_notifications` provides this as a port, so a
  // cross-module write answers on its effective state rather than succeeding
  // into a module the operator switched off. Resolved where it is needed since
  // T142; nothing in this file reads it any more.

  // ---- Cross-cutting actor resolvers --------------------------------------

  // Feature 072, T011/T012 — one guard implementation, owned by `auth` and
  // shared with the test harness. It used to be declared inline here while the
  // harness ran its own copy that read a different request property and took
  // `permissionService` as optional.
  //
  // Issue #43 — the same is now true of `requireCustomer`, which this root
  // declared inline right here until the customer-side twin got the same
  // treatment. That copy read `request.actor` and crashed on a request carrying
  // none; the harness's `requireTestCustomer()` read `request.testActor` and
  // refused. `auth` provides the one guard, and the 16 route surfaces that take
  // it resolve the name out of the container.
  //
  // D-103 removed this root's last direct read of `requireAdmin`, and the
  // `authCradle` alias with it: the overlay module's route guard used to be
  // handed over through `OverlayModuleContext`, and an overlay module now
  // resolves `requireAdmin` from the container exactly as a core module does.

  /**
   * Resolver for routes that require an authenticated Customer **with** an
   * Organization. Routes that work without one (cart-add, browsing,
   * profile-read) use `resolveCartActor` or read `request.actor` directly.
   *
   * **The refusal below asserts an invariant; it does not describe a business
   * state** (D-178). It was a 422 `organization_required`, introduced by
   * feature 026 US2 for accounts that were allowed to have no Organization.
   * Every transacting customer has one — `customer_accounts.organization_id` is
   * `NOT NULL` and an individual is backed by a personal organisation — so a
   * caller reaching this branch is a broken invariant, and a 422 telling a buyer
   * to attach an Organization they have no way to attach is a lie with a
   * remedy attached.
   *
   * The guard is **kept** rather than deleted: `request.actor.organizationId` is
   * `string | null | undefined` at this seam and the consumers' input type is
   * `organizationId: string`, so removing the check would push `undefined`
   * through silently.
   */
  const customerResolver = (
    request: FastifyRequest,
  ): {
    customerAccountId: string;
    organizationId: string;
    impersonatorAdminUserId?: string | null;
  } => {
    if (request.actor.kind !== 'customer') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
    }
    if (!request.actor.organizationId) {
      throw new HttpError(
        500,
        ERROR_CODES.INTERNAL,
        'Invariant violated: a customer account has no Organization (Principle XI).',
        { code: 'customer_account_organization_missing' },
      );
    }
    return {
      customerAccountId: request.actor.customerAccountId,
      organizationId: request.actor.organizationId,
      impersonatorAdminUserId: request.actor.impersonatorAdminUserId ?? null,
    };
  };

  const adminContextResolver = (request: FastifyRequest): { adminUserId: string } => {
    if (request.actor.kind !== 'admin') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
    }
    return { adminUserId: request.actor.adminUserId };
  };

  /**
   * Resolver for customer routes that work with or without an Organization
   * (e.g. Returns history/submission). Unlike `customerResolver`, it does not
   * require an Organization — it only asserts a customer session.
   */
  const resolveCustomerAccountId = (request: FastifyRequest): string => {
    if (request.actor.kind !== 'customer') {
      throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
    }
    return request.actor.customerAccountId;
  };

  // ---- Module composition (order mirrors test/helpers/test-server.ts) -----

  // Build the integrations module first so its API-key authenticator can be
  // injected into the auth plugin; that lets every Bearer-tokened request
  // resolve to an `actor.kind === 'api_key'` early in the request lifecycle.
  // Feature 072 (T100) — `api_keys` owns its service, its two gates and its
  // routes now, and provides `apiKeyResolver` itself.

  // Feature 062 (T029 / FR-014) — outbound webhook delivery, org-scoped.
  // The bridge (producer) runs in every role: it maps bridged in-process
  // events onto the durable BullMQ queue, filtered per subscription through
  // `WebhookService.findActiveByEventType(eventType, organizationId)` so an
  // org-bound subscription only ever sees its own organization's events
  // (Principle XI; contracts/order-webhooks.md §2). The consumer (delivery
  // worker: HMAC signing + retries + `webhook_deliveries` bookkeeping) runs
  // co-located unless BACKEND_ROLE=api, exactly like the other workers
  // (Principle X — separable via `pnpm --filter backend run worker`).
  // Feature 072 (T098) — the queue, the EventBus bridge and the admin routes
  // are `webhooks`' own. T143a — so is the delivery worker: only the *flag*
  // was ever a deployment decision, and the consumer built here was the one
  // part of the module nothing could switch off, draining the queue and writing
  // `webhook_deliveries` rows with `webhooks` disabled.
  composedModules.contribute({ webhooksRunWorkers: runWorkers });

  // Feature 072 (T078) — the auth plugin is `auth`'s own contribution now,
  // collected by `ctx.rootPlugin` because it decorates `request.actor` for the
  // whole application rather than contributing routes. The two resolvers it
  // reads are registered below, once the modules that own them exist; the
  // plugin reads them per request, so the order is not a race.
  const authModulePlugin: ModulePlugin = async (app) => {
    for (const plugin of composedModules.sink.rootPlugins) await plugin(app);
  };

  // Feature 042 / D-96 — the MFA login port is the consumers' resolution, not
  // this root's.
  //
  // This root used to read `mfaLoginPort` off the cradle and contribute the
  // getter to both login consumers. Two things were wrong with that. A root
  // resolving a gated port on a module's behalf is composition checklist item 6
  // — the knob drifted between the two roots, and the harness captured what
  // this one read lazily. And the sentence that stood here said an absent `mfa`
  // must make the login *fail closed*, which is what actually shipped: a 503 on
  // every admin and customer login the moment an operator used the activation
  // switch that promises them nothing is dropped. D-96 ruled the other way, as
  // FR-033 always required — off means no second factor. `admin_users` and
  // `customer_accounts` each resolve the port through `lazyPort` behind an
  // `effectiveState.isPresent('mfa')` probe and declare the edge
  // `degrades-without`, so neither root binds anything here.

  // Feature 056 — organization tree + inheritance resolution. Both are
  // `organizations`' own services and both are gated ports since T138; this
  // root reads them lazily for the hand-wired remainder that still takes them
  // as arguments.
  const organizationTreeService = (): OrganizationTreeService =>
    (container.cradle as never as { organizationTreeService: OrganizationTreeService })
      .organizationTreeService;

  // Feature 072 (T101) — `credit_limits` owns its service and routes now, and
  // since T143c the return-settlement top-up as well, so this root reads
  // nothing of the module.

  // Feature 055 — Custom Fields Layer, converted in feature 072 (T087), and
  // feature 061's attribute read model, which `catalog` provides as
  // `catalogAttributeReadPort` since T142. This root read neither by T143a.

  // Feature 072 (T122) — `import_export` owns its service and routes now.
  // Feature 072 (T105) — `languages` owns its services and routes now.

  // Feature 005 — Sales Channels module. The boot-time
  // DefaultChannelReconciler runs FIRST so every other module can rely on a
  // system-default channel existing; it must precede the modules array
  // because catalog (and later other modules) consume
  // `salesChannels.membershipService` in their composition. The
  // plugin itself (resolver middleware) is pushed into `modules` below.
  const salesChannelsReconciler = new DefaultChannelReconciler(em, auditLogService);
  // Feature 072 (T036) — boot reconcilers establish their own scope. They ran
  // with NO ambient tenant context before, and survived only because the rows
  // they touch carry no automatic filter; that was an accident of entity
  // classification, not a guarantee.
  const salesChannelsReconciliation = await enterSystemScope(
    'boot: reconcile the default sales channel',
    () => salesChannelsReconciler.run(),
    { entryPoint: 'boot' },
  );
  if (salesChannelsReconciliation.action === 'warning' && salesChannelsReconciliation.warning) {
    console.warn(salesChannelsReconciliation.warning);
  }

  // Feature 010 — pair every active sales channel with a warehouse. Migration
  // 030 seeds the Default warehouse and tries to bind it to each channel, but
  // the seed runs BEFORE DefaultChannelReconciler creates the system channel
  // at boot. This reconciler catches up at runtime so US3 (channel→warehouse)
  // never sees a channel without at least one (default) assignment.

  // Feature 017 — construct the Dictionary module before its validator
  // consumers so the shared port can be threaded through their services.
  // The plugin itself is still registered later to preserve route order.
  // Feature 072 (T112) — `dictionaries` owns its services, its cache
  // invalidation listeners and its routes now.

  // Registered here rather than with the other host values further down:
  // `addresses` reads it to build the one `AddressService`, and both `orders`
  // and `organizations` are constructed before that block runs.
  // Feature 072 (T090) — one `AddressService` for the whole composition.
  // `orders` and `organizations` used to build their own, and the constructor's
  // validator and audit writer are optional, so the instances were free to
  // disagree — and one did.

  // Feature 072 (wave 1) — `dictionaries` reacts to a currency change instead
  // of `currencies` calling into it. The direction matters: declaring the call
  // as a dependency produced a real cycle, and the cycle was the design saying
  // a currency must not know a dictionary cache exists.
  // Feature 072 (T105) — the language half of the same drop. `languages` used
  // to pass a hard-coded `undefined` for its invalidator, so a deactivated
  // language kept validating for up to the validator's 60 s TTL and kept being
  // served from the Redis dictionary cache for up to an hour, while a currency
  // change dropped both immediately.

  // Feature 072 (T110) — the channel-resolution names. The kernel itself is
  // composed above `composeModules`, for the subscriber ordering; what belongs
  // here is the registration, in the one contribution slot.
  composedModules.contribute({
    salesChannelsCache: salesChannels.cache,
    // The kernel-reserved membership port. `payment_methods` and
    // `delivery_methods` resolve it to auto-bind a new method to the system
    // default channel; both read it when their routes register, which is well
    // after this line.
    salesChannelMembershipPort: salesChannels.membershipService,
    // The channel resolver itself. `inventory` has resolved this name since
    // T129 and neither root registered it, so the channel-scoped storefront
    // stock read threw `AwilixResolutionError` on its first call — in
    // production only, because the harness exercises no channel-scoped read.
    // It went unseen because the name is on `PLATFORM_OWNED_NAMES`, and
    // `check-port-dependencies` skips those rather than verifying them (#49).
    salesChannelResolutionPort: salesChannels.resolver,
  });

  // Feature 014 — CMS module (Pages, Blocks, Templates, Hooks, Page
  // Builder). Phase 2 ships module instantiation + seeded-Hook
  // reconciliation; admin/storefront routes land in subsequent phases.
  // Feature 072 (T093) — `cms` owns its services, its four late-bound
  // resolvers, its seeded-Hook reconciliation and its routes now. T143a — and
  // the reference registry too: `megamenu` cross-registers into it from its own
  // boot hook, so this root reads nothing of the module and only contributes
  // the asset resolver further below.

  // Feature 072 (T127) — `price_lists` owns its services and routes now. Two
  // names stay a composition's: whether a wall-clock status sweeper runs, and
  // how this deployment names a non-admin caller on an audit record. The
  // pricing decoration (D-28) is contributed here too, when the deployment
  // ships one.
  //
  // T143a — `priceListsPricingCacheTtlMs` is gone: this file was importing the
  // module's own `DEFAULT_PRICING_CACHE_TTL_MS` to hand it back to the module.
  // The module defaults it now, and production wanting the shipped TTL says so
  // by contributing nothing.
  composedModules.contribute({
    priceListsEnableStatusSweeper: true,
    priceListsAdminAuditContext: (request: FastifyRequest) => {
      const actor = (request as { actor?: { kind: 'admin'; adminUserId: string } }).actor;
      if (actor?.kind !== 'admin') {
        return { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };
      }
      return { actorAdminUserId: actor.adminUserId };
    },
  });
  // Feature 072 (T119) — `taxes` owns its service and routes now.
  const taxesCradle = container.cradle as unknown as TaxesCradle;
  // Feature 012 / US8 — promotions reads catalog through CatalogQueryService
  // (the documented cross-module port — Constitution I) so the rule editor
  // can list `isPromoRule` attributes and the resolver can validate
  // `attribute` criteria against the authoritative option list.
  // Feature 072 (T115) — `promotions` owns its services and routes now.
  // These three stay here: the org-status gate and the Rule Builder picker
  // sources read `organizations`, `categories`, `payment_methods` and
  // `delivery_methods` directly, and the catalog read port is `catalog`'s.
  // Registered after `composeModules`, where the module declares its defaults.
  composedModules.contribute({
    promotionRuleTargets: {
      salesChannels: async () => {
        const { items } = await (
          container.cradle as unknown as SalesChannelsCradle
        ).salesChannelsService.list({});
        return items.map((c) => ({ id: c.id, code: c.code, name: anyLabel(c.name) }));
      },
      customerGroups: async () => {
        const groups = await (
          container.cradle as unknown as CustomerAccountsCradle
        ).customerGroupService.list();
        return groups.map((g) => ({ id: g.id, code: g.code, name: g.name }));
      },
      organizations: async () => {
        const res = (await em()
          .getKnex()
          .raw(
            `select "id", "name", "tax_id" from "organizations" where "deleted_at" is null order by "name" asc limit 200`,
          )) as { rows: Array<{ id: string; name: string; tax_id: string | null }> };
        return res.rows.map((r) => ({ id: r.id, name: r.name, taxId: r.tax_id ?? null }));
      },
      categories: async () => {
        const res = (await em()
          .getKnex()
          .raw(
            `select "id", "slug", "name", "parent_category_id" from "categories" where "deleted_at" is null order by "sort_order" asc`,
          )) as {
          rows: Array<{
            id: string;
            slug: string;
            name: unknown;
            parent_category_id: string | null;
          }>;
        };
        return res.rows.map((r) => ({
          id: r.id,
          slug: r.slug,
          name: anyLabel(r.name),
          parentCategoryId: r.parent_category_id ?? null,
        }));
      },
      paymentMethods: async () => {
        const res = (await em()
          .getKnex()
          .raw(
            `select "id", "code", "name" from "payment_methods" where "status" = 'active' order by "code" asc`,
          )) as { rows: Array<{ id: string; code: string; name: unknown }> };
        return res.rows.map((r) => ({ id: r.id, code: r.code, name: anyLabel(r.name) }));
      },
      deliveryMethods: async () => {
        const res = (await em()
          .getKnex()
          .raw(
            `select "id", "code", "name" from "delivery_methods" where "status" = 'active' order by "code" asc`,
          )) as { rows: Array<{ id: string; code: string; name: unknown }> };
        return res.rows.map((r) => ({ id: r.id, code: r.code, name: anyLabel(r.name) }));
      },
    },
  });

  // Feature 072 (T118) — the settings names. The kernel itself is composed
  // above `composeModules`, for the subscriber ordering; what belongs here is
  // the registration, in the one contribution slot.
  composedModules.contribute({
    settingsSecretEncryptionKey: process.env['SETTINGS_SECRET_ENCRYPTION_KEY'],
    // Feature 073 — the effective-state reader. Registered here rather than
    // imported inside the module so the dependency direction stays declared in
    // a root: `_lifecycle` reads this module's `Setting` rows, and this module
    // reads nothing of `_lifecycle`'s.
    settingsModulePresence: {
      presenceOf: (moduleId: string) => effectiveState.presenceOf(moduleId),
      activationControlOwner: (code: string) => effectiveState.activationControlOwner(code),
    },
  });

  // Secret settings (e.g. prompt_actions API keys) are AES-256-GCM encrypted
  // at rest with SETTINGS_SECRET_ENCRYPTION_KEY. The key is read from the
  // environment once at boot — so a value added to `.env` only takes effect
  // after the backend is restarted (the dev watcher does not reload on `.env`
  // changes). Warn loudly here so a missing/unloaded key is obvious instead of
  // surfacing only as a 500 ("…is not configured…") when an operator tries to
  // save a secret.
  if (!process.env['SETTINGS_SECRET_ENCRYPTION_KEY']) {
    // Boot-time logging path; the Fastify logger is not yet available here.
    console.warn(
      '[settings] SETTINGS_SECRET_ENCRYPTION_KEY is not set — secret settings ' +
        '(e.g. prompt_actions API keys) cannot be saved. Set a base64 32-byte key ' +
        '(openssl rand -base64 32) in backend/.env (see .env.example) and restart the backend.',
    );
  }

  // Feature 058 — Credentials module. Feature 072 (T143a) — the
  // configuration-type registry and the four core descriptors are gone from
  // here: `credentials` declares the registry it owns, and each of the four
  // types is declared by the module whose manifest already claims it
  // (`credentials` for LLM and the e-mail adapter, `pim_ergonode`,
  // `product_feeds`), from that module's own boot hook. What stays is how an
  // admin actor is resolved from a request, which production and the harness
  // genuinely answer differently.
  composedModules.contribute({
    adminContextResolver,
    // US2 — the delete-integrity guard reaches settings only through this port
    // (Principle I): `SettingsService.listReferencesToConfiguration`.
    credentialsSettingsPort: settings.settingsService,
  });
  // `credentialsService` is resolved from the container where it is needed —
  // `product_feeds` read it as a port since T137, and it was this root's last
  // consumer.

  // Feature 042 — MFA module. Constructed here (after `settings`) so it can
  // read the per-scope MFA settings; its login port is bound to the late-bound
  // `mfaLoginPort` captured by the auth services above. Plugin pushed below.
  // Feature 042 US4/US5 — federated sign-in. T143c — `mfa` reads `MFA_OAUTH_*`
  // and builds its own provider now, so this root no longer decides on the
  // module's behalf whether the module has social sign-in. The egress seam is
  // unchanged and is declared once instead of asserted twice: production takes
  // the module's default, the harness contributes a deterministic fake over the
  // same name.
  // T143a — the two customer-side resolvers forward to `customer_accounts`'
  // port. They used to be written out here: a root reading and *writing*
  // another module's table, with a policy gate (`customers.allow_registration_without_organization`)
  // this root happened to apply and the harness did not. Read per call, so the
  // gate stays live. `resolveAdminByEmail` stays a root's for now — it is the
  // same shape one module over, in `admin_users`, which has no port for it yet.
  const customerSocialLogin = (): {
    resolveByEmail(email: string): Promise<{ id: string } | null>;
    autoCreate(email: string): Promise<{ id: string } | null>;
  } =>
    (
      container.cradle as never as {
        customerSocialLoginPort: {
          resolveByEmail(email: string): Promise<{ id: string } | null>;
          autoCreate(email: string): Promise<{ id: string } | null>;
        };
      }
    ).customerSocialLoginPort;

  const mfaSocialResolvers = {
    resolveCustomerByEmail: (email: string) => customerSocialLogin().resolveByEmail(email),
    autoCreateCustomer: (email: string) => customerSocialLogin().autoCreate(email),
    resolveAdminByEmail: async (email: string) => {
      // The claim's spelling is the identity provider's, and the row holds the
      // folded address, so the two are compared in the one form both modules
      // store (issue #249). T052 — the fold is the owner's now:
      // `findByEmail` folds before it compares, for exactly the callers that
      // arrive through no request schema, so this root no longer writes out a
      // normalisation it would have to keep in step with the column.
      //
      // `activeOnly` is the port's undeleted filter; `status` is a column on
      // the record, and both halves of the original filter are kept.
      const a = await identityPorts().adminUserReadPort.findByEmail(email, {
        activeOnly: true,
      });
      return a !== null && a.status === 'active' ? { id: a.id } : null;
    },
  };

  // Feature 072 (T096) — `mfa` owns its services, routes and configuration
  // now. What a root still owns is the *shape this composition gives an actor*:
  // production reads `request.actor`, the harness reads `request.testActor`.
  // That is contributed whole rather than as ten separate names, because a
  // composition either knows how to resolve an actor or it does not.
  composedModules.contribute({
    // D-48 — the system-default channel, which always exists. It used to be
    // `?? null`, which switched MFA policy resolution to the platform-wide
    // settings tier on a branch that cannot be taken.
    mfaDefaultChannelIdResolver: async () => (await salesChannels.resolver.getSystemDefault()).id,
    mfaSocialAccountResolvers: mfaSocialResolvers,
    mfaActorBridge: {
      resolveCustomerActor: (request: FastifyRequest) => {
        if (request.actor.kind !== 'customer') {
          throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
        }
        return {
          customerAccountId: request.actor.customerAccountId,
          organizationId: request.actor.organizationId ?? null,
        };
      },
      resolveAdminActor: (request: FastifyRequest) => {
        promoteAdminActor(request);
        if (request.actor.kind !== 'admin') {
          throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
        }
        return { adminUserId: request.actor.adminUserId };
      },
      resolveOrganizationCustomerIds: async (organizationId: string) => {
        const rows = await identityPorts().customerAccountReadPort.listByOrganization(
          organizationId,
        );
        return rows.map((r) => r.id);
      },
      resolveOrgAdmin: async (request: FastifyRequest) => {
        if (request.actor.kind !== 'customer') {
          throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
        }
        const c = await identityPorts().customerAccountReadPort.findById(
          request.actor.customerAccountId,
        );
        if (!c || c.role !== 'organization_admin' || !c.organizationId) {
          throw new HttpError(
            403,
            ERROR_CODES.FORBIDDEN,
            'Organization administrator role required.',
          );
        }
        return { organizationId: c.organizationId, actor: c.id };
      },
      resolveAccountEmail: async (subjectType: 'customer' | 'admin', subjectId: string) => {
        const ports = identityPorts();
        if (subjectType === 'admin') {
          return (await ports.adminUserReadPort.findById(subjectId))?.email ?? null;
        }
        return (await ports.customerAccountReadPort.findById(subjectId))?.email ?? null;
      },
      // T052 — the hash no longer travels. This root read `passwordHash` off
      // both entities and ran the comparison with `auth`'s hasher, so a
      // credential column and a hash comparison lived in a file that owns
      // neither; each module answers for its own now and only the boolean
      // crosses.
      verifyAccountPassword: async (
        subjectType: 'customer' | 'admin',
        subjectId: string,
        password: string,
      ) => {
        const ports = identityPorts();
        return subjectType === 'admin'
          ? ports.adminPasswordVerificationPort.verifyPassword(subjectId, password)
          : ports.customerPasswordVerificationPort.verifyPassword(subjectId, password);
      },
    } satisfies MfaActorBridge,
  });
  // The login port is `customer_accounts`' and `admin_users`' own resolution
  // (D-96); the actor shape above is the only thing about `mfa` a root knows.

  // SEO module — needs the SettingsService port for the per-channel
  // `sales_channels.storefront_url` setting that the sitemap generator
  // stamps into URLs. Plugin is pushed onto `modules` further below.
  // Feature 072 (T117) — `seo` owns its services and routes now.
  let shoppingListService: ShoppingListService | null = null;

  // Feature 072 (T079) — the platform mailer, resolved from the container the
  // `email` module registered it into. Six senders share it, which is why it
  // was never really "the organizations mailer" and is not named one now.
  const platformMailer = (container.cradle as unknown as EmailCradle).emailMailer;

  // Feature 026's moderation lifecycle — the moderation service, the
  // registration notifier, their two `organization.registered.v1`
  // subscriptions and the transaction gate — moved into
  // `organizations/backend.ts` in T138. The subscriptions in particular were
  // bare `eventBus.on` calls here, so they fired whether or not the module was
  // present.
  //
  // What used to remain was `platformSettingsChannelId`, the fallback the
  // kernel settings resolver answered with when the deployment had no
  // system-default channel. Feature 072 (D-41) deleted it, along with the
  // undocumented `ORGANIZATIONS_SETTINGS_CHANNEL_ID` env var behind it: its
  // default was the string `'default'`, which is a channel **code**
  // (`DEFAULT_SALES_CHANNEL_CODE`) used where a `uuid` id was wanted, so it
  // could not address a `setting_values` row at all. "No channel" is now `null`
  // and the read decides what that means.

  // Feature 056 — subtree-aware assignment scope. When a scoped sales-rep actor
  // holds the `organizations:rollup` capability, `listAssignedOrganizationIds`
  // expands each assignment to its subtree (with per-descendant override,
  // FR-011). Without the capability, behavior is byte-for-byte the pre-feature
  // flat set.
  //
  // T143a — `organizations`' port, read lazily, rather than a
  // `SalesRepAssignmentService` built here. The class, the tree it walks and
  // the rule it applies are all that module's; a root built one and the harness
  // built a different one, which is how the roll-up went untested.
  const salesRepScope = (): {
    listAssignedOrganizationIds(adminUserId: string): Promise<string[]>;
  } =>
    (
      container.cradle as never as {
        organizationSalesRepScopePort: {
          listAssignedOrganizationIds(adminUserId: string): Promise<string[]>;
        };
      }
    ).organizationSalesRepScopePort;

  /**
   * Feature 026 US6 — admin orders/RFQ visibility scope. Sales-rep admins
   * see only orders/RFQs from organizations they own; any other admin
   * (platform admin, content manager, etc.) sees everything.
   *
   * Feature 056 — the assigned set is subtree-expanded when the rep holds the
   * roll-up capability, which `organizations` decides (see `salesRepScope`).
   */
  const resolveAdminOrdersScope = async (
    request: FastifyRequest,
  ): Promise<{ allowAll: true } | { allowAll: false; allowedOrganizationIds: string[] }> => {
    const actor = (request as { actor?: { kind: string; adminUserId?: string } }).actor;
    if (!actor || actor.kind !== 'admin' || !actor.adminUserId) {
      return { allowAll: true };
    }
    const knex = em().getKnex();
    const roleRow = (await knex.raw(
      `select ar."code" as code from "admin_users" au left join "admin_roles" ar on ar."id" = au."admin_role_id" where au."id" = ?`,
      [actor.adminUserId],
    )) as { rows: Array<{ code: string | null }> };
    const roleCode = roleRow.rows[0]?.code ?? null;
    if (roleCode !== 'sales_representative') {
      return { allowAll: true };
    }
    const allowedOrganizationIds = await salesRepScope().listAssignedOrganizationIds(
      actor.adminUserId,
    );
    return { allowAll: false, allowedOrganizationIds };
  };

  // Feature 047 — late-bound transactional-email sender. `orders` (and
  // other owning modules) read it via a getter; the transactional_emails module
  // sets it through exposeSender once built.
  // Feature 072 (T120) — `transactional_emails` owns the binding now and
  // publishes both services as accessor ports; this root reads them like any
  // other consumer instead of holding the variables its callbacks filled in.
  const emailCradle = (): {
    transactionalEmailSenderAccessor: () =>
      | import('@endora-commerce/contracts').TransactionalEmailSender
      | undefined;
    emailBrandingAccessor: () =>
      | {
          resolve(salesChannelId: string | null): Promise<{ logoUrl: string; accentColor: string }>;
        }
      | undefined;
  } => container.cradle as never;

  // Feature 050 — establish the ambient TenantContext for every request from the
  // already-authenticated actor (never from request inputs). Registered right
  // after auth so its onRequest runs after `request.actor` is set and applies
  // globally (mirrors the auth plugin). See specs/050-org-tenant-scoping/.
  //
  // Feature 072 (T027) — the same hook now also opens the request's resolution
  // scope; `registerRequestScopeHook` owns the shape, shared with the test
  // harness so the two cannot drift.
  const tenantContextModulePlugin: ModulePlugin = async (app) => {
    const buildContext = async (request: FastifyRequest): Promise<TenantContext> => {
      const actor = request.actor;
      if (actor.kind === 'customer') {
        const orgId =
          actor.organizationId && actor.organizationId.length > 0 ? actor.organizationId : null;
        // Feature 056 (T032) — a roll-up-enabled customer widens to its org
        // subtree (server-derived). Absent the capability, stays single-org.
        const rollupSubtree = await customerRollupScopePort().resolveSubtreeIds(
          actor.customerAccountId,
          orgId,
          (id) => organizationTreeService().subtreeIds(id),
        );
        return resolveTenantContext({
          kind: 'customer',
          customerAccountId: actor.customerAccountId,
          organizationId: orgId,
          impersonatorAdminUserId: actor.impersonatorAdminUserId,
          ...(rollupSubtree && rollupSubtree.length > 0
            ? { rollupSubtreeOrganizationIds: rollupSubtree }
            : {}),
        });
      }
      if (actor.kind === 'admin') {
        const scope = await resolveAdminOrdersScope(request);
        return resolveTenantContext({ kind: 'admin', adminUserId: actor.adminUserId }, scope);
      }
      // Feature 062 — a BOUND api key pins the request to its organization +
      // designated service account; an unbound key keeps the legacy trusted
      // system scope (its only surface is the global-entity PIM path).
      if (actor.kind === 'api_key') {
        return resolveTenantContext({
          kind: 'api_key',
          apiKeyId: actor.apiKeyId,
          organizationId: actor.organizationId ?? null,
          customerAccountId: actor.customerAccountId ?? null,
        });
      }
      // anonymous: trusted platform read scope. Guest-owned rows are
      // scoped by their own token mechanism, not by the tenant filter.
      return systemTenantContext(`actor:${actor.kind}`);
    };
    await registerRequestScopeHook(app, { buildTenantContext: buildContext });
  };

  // Feature 062 — read-only inventory accessors backing the external catalog
  // namespace's availability indication (channel-candidate warehouses +
  // cumulative on-hand → display band). Standalone instances: reads only,
  // no event emission, no audit.

  const modules: ModulePlugin[] = [
    // Feature 072 — every module's route contribution, in the generated order.
    //
    // They sit ahead of the three root plugins, and that is not an ordering
    // claim: `buildServer` calls each of these with the root instance, so an
    // `onRequest` hook any of them adds is a root hook, and Fastify assembles a
    // route's hook chain when the application is readied rather than when the
    // route is registered. D-45 measured it — a root hook added after an
    // encapsulated child still runs for that child's routes — which is why the
    // 26 modules that used to be "early" have always authenticated correctly
    // despite mounting before `authModulePlugin`.
    ...composedModules.sink.plugins,
    authModulePlugin,
    tenantContextModulePlugin,
  ];

  // Feature 005 — Sales Channels plugin (resolver middleware on every
  // /api/v1/* request). The reconciler + module instantiation happen
  // earlier so other modules' compositions can consume the membership
  // service; here we only push the plugin into the routes array.
  modules.push(salesChannels.plugin);

  // Feature 004 — Settings module. The plugin is pushed here; the
  // service handle was constructed up at the inventory site so other
  // modules can read it at construction time. The boot-time reconciler
  // runs below before HTTP comes up.

  // Feature 013 — Assets Library. Phase 2 instantiates the module so its
  // manifest is reconciled and the AssetsLibraryService / referenceRegistry
  // are accessible to other modules.
  // Feature 072 (T092) — the module owns its plugin and its registry now.
  // T143a — and the reference descriptors are gone from here too: `catalog`,
  // `cms` and `megamenu` each push their own from `ctx.onBoot`, so which edges
  // block an asset delete follows from which modules are present rather than
  // from what this root was taught.
  const assetsLibrary = (container.cradle as unknown as AssetsLibraryCradle).assetsLibrary;

  // Feature 072 (T093) — contributed, not set: which modules a deployment
  // ships is this root's business, and `cms` reads the contribution per call.
  composedModules.contribute({
    cmsAssetResolver: async (assetId: string) => {
      try {
        const detail = await assetsLibrary.handle.service.getAsset(assetId);
        return {
          url: detail.url,
          mimeType: detail.mimeType,
          filename: detail.filename,
          label: detail.label ?? null,
          visibility: detail.visibility,
        };
      } catch {
        return null;
      }
    },
  });

  // Feature 046 — PWA module. Owns the installable-app control plane (over the
  // Settings module), the push-subscription registry, the provider-agnostic
  // push fan-out (BullMQ; co-located unless BACKEND_ROLE=api), and the icon
  // rendition pipeline (sharp + assets_library). Channel/asset/customer coupling
  // is injected here so the module stays isolated (Principle I).
  // Feature 072 (T116) — `pwa` owns its services, its queue and its routes
  // now. What stays here is every way it reaches outside itself, contributed
  // as one bridge: a composition knows how to reach `assets_library` and
  // `sales_channels`, or it does not.
  composedModules.contribute({
    pwaRunWorkers: runWorkers,
    pwaBridge: {
      assetUpload: {
        upload: async (input) => {
          const detail = await assetsLibrary.handle.service.upload(input);
          return { id: detail.id };
        },
      },
      resolveAssetUrl: async (assetId: string) => {
        try {
          const resolved = await assetsLibrary.handle.service.resolveUrl(assetId);
          return absolutizePublicUrl(resolved.url);
        } catch {
          return null;
        }
      },
      // An unknown code falls back to the system-default channel, which always
      // exists (D-48). It used to be the `'default'` sentinel, which resolved
      // nothing at all, and then `?? null`, which read `pwa`'s per-storefront
      // configuration platform-wide on a branch that cannot be taken.
      resolveChannelIdByCode: async (code: string | undefined) => {
        if (code) {
          const ch = await salesChannels.resolver.getByCode(code);
          if (ch) return ch.id;
        }
        return (await salesChannels.resolver.getSystemDefault()).id;
      },
      defaultChannelId: async () => (await salesChannels.resolver.getSystemDefault()).id,
      channelCodeForId: async (channelId: string) => {
        const ch = await em().findOne(SalesChannel, { id: channelId });
        return ch?.code ?? null;
      },
      resolveAuditContext: (request: FastifyRequest) => ({
        actorAdminUserId: request.actor.kind === 'admin' ? request.actor.adminUserId : null,
      }),
      resolveCustomerAccountId: async (request: FastifyRequest) =>
        request.actor.kind === 'customer' ? request.actor.customerAccountId : null,
      resolveOrderTarget: async (payload) => {
        const order = await orderReadPort().findById(payload.orderId);
        if (!order || !order.placedByCustomerAccountId) return null;
        return {
          salesChannelId: payload.salesChannelId,
          customerAccountId: order.placedByCustomerAccountId,
          title: 'Order update',
          body: `Order ${order.businessId} is now ${payload.to.replace(/_/g, ' ')}.`,
          url: `/account/orders/${order.businessId}`,
        };
      },
    } satisfies PwaBridge,
  });

  // Feature 015 — Megamenu module. Wires the cross-module ports the
  // target validator + storefront resolver delegate to. v1 uses small
  // direct SQL lookups instead of forcing new upstream surfaces.
  // Feature 072 (T107) — `megamenu` owns its services and routes now. These
  // two bundles stay here: both are existence checks and URL lookups against
  // OTHER modules' tables, so moving them into the module would give it
  // direct reads of `catalog`, `cms` and `assets_library` storage.
  //
  // Registered after `composeModules`, where `megamenu` declares its own
  // defaults — contributing earlier would let the module overwrite the root.
  composedModules.contribute({
    megamenuValidatorDeps: {
      categoryExists: async (categoryId) => {
        const rows = (await em()
          .getConnection()
          .execute('select 1 from categories where id = ? limit 1', [categoryId])) as Array<{
          '?column?': number;
        }>;
        return rows.length > 0;
      },
      cmsPageExists: async (pageId) => {
        const rows = (await em()
          .getConnection()
          .execute('select 1 from cms_pages where id = ? limit 1', [pageId])) as Array<{
          '?column?': number;
        }>;
        return rows.length > 0;
      },
      cmsBlockExists: async (blockId) => {
        const rows = (await em()
          .getConnection()
          .execute('select 1 from cms_blocks where id = ? limit 1', [blockId])) as Array<{
          '?column?': number;
        }>;
        return rows.length > 0;
      },
      assetIs: async (assetId, expected) => {
        const rows = (await em()
          .getConnection()
          .execute('select 1 from assets where id = ? and kind = ? limit 1', [
            assetId,
            expected,
          ])) as Array<{ '?column?': number }>;
        return rows.length > 0;
      },
    } satisfies TargetValidatorDeps,
    megamenuStorefrontDeps: {
      resolveCategoryUrl: async (categoryId) => {
        // Feature 068 — a megamenu item pointing at a deactivated (or deleted)
        // category resolves to null, which drops the item from the menu.
        const rows = (await em()
          .getConnection()
          .execute(
            'select slug from categories where id = ? and is_active = true and deleted_at is null limit 1',
            [categoryId],
          )) as Array<{ slug: string }>;
        return rows[0]?.slug ? `/c/${rows[0].slug}` : null;
      },
      resolveCmsPageUrl: async (pageId) => {
        const rows = (await em()
          .getConnection()
          .execute('select slug from cms_pages where id = ? limit 1', [pageId])) as Array<{
          slug: string;
        }>;
        return rows[0]?.slug ? `/${rows[0].slug}` : null;
      },
      resolveAsset: async (assetId) => {
        const rows = (await em()
          .getConnection()
          .execute('select kind, label from assets where id = ? limit 1', [assetId])) as Array<{
          kind: string;
          label: string | null;
        }>;
        const row = rows[0];
        if (!row) return null;
        if (row.kind !== 'image' && row.kind !== 'video') return null;
        const resolved = await assetsLibrary.handle.service.resolveUrl(assetId);
        return { url: resolved.url, label: row.label, kind: row.kind };
      },
      resolveCmsBlock: async (blockId, language) => {
        const rows = (await em()
          .getConnection()
          .execute(
            'select id::text, code, content from cms_blocks where id = ? and active = true limit 1',
            [blockId],
          )) as Array<{
          id: string;
          code: string;
          content: { languages?: Record<string, unknown> };
        }>;
        const row = rows[0];
        if (!row) return null;
        const data = row.content.languages?.[language];
        if (data === undefined) return null;
        return {
          id: row.id,
          code: row.code,
          language,
          content: { schemaVersion: 1, data },
        };
      },
    } satisfies StorefrontDeps,
  });

  // Feature 072 — the **host values** any module may resolve. No converted
  // module is named here: each entry is a name whose value only a composition
  // can supply, and several are ports their owning module will register itself
  // once the surface they wrap is theirs.
  composedModules.contribute({
    // `requireAdmin` is NOT here any more: `auth` provides it as a port
    // (T078), and re-registering the name would silently replace a gated
    // registration with an ungated value — the exact failure `providePort`
    // exists to prevent.
    // `apiKeyResolver` is NOT here either: `api_keys` provides it as a gated
    // port (T100), and re-registering the name replaced that gate with a plain
    // closure — API-key authentication kept working after the module was
    // switched off. Both roots carried the entry until the root-registration
    // check started reading them (T118).
    // `redis` is registered further up, where the client is created.
    // The kernel's `SettingsService` already implements the read port; the
    // adapter object this replaces existed only to narrow it.
    settingsReadPort: settings.settingsService,
    // The same cache, seen from the writing side (issue #45). The `settings`
    // module owns the one write seam, so it is the one place that can drop the
    // cache *as part of* the write instead of announcing the write and hoping a
    // subscriber gets there first.
    settingsCache: settings.cache,
    // Which channel a global-scope settings read resolves against. It is a
    // property of the deployment — the system-default channel, or the env
    // fallback when none is configured yet — not of any module, and this root
    // had spelled the same expression out four times.
    // `requireCustomer` is NOT here any more: `auth` provides it as a port
    // (issue #43), for the same reason `requireAdmin` is not — re-registering
    // the name would replace a gated registration with a plain closure.
    // Feature 072 (wave 2) — how this composition resolves the calling
    // customer. Root-shaped as `requireCustomer` used to be: five
    // modules take it as an option and each root spells it once.
    customerContextResolver: customerResolver,
    // Feature 072 (wave 3) — how this composition names the calling customer,
    // as an id. The four payment gateways each declared an identically-shaped
    // `resolveCustomerAccountId` option and this root spelled the same
    // reference once per module.
    customerAccountIdResolver: resolveCustomerAccountId,
    // Feature 072 (T101) — inherited credit limits, owned by `organizations`,
    // which provides `organizationInheritancePort`. This entry is the root's
    // bridge to it and goes when the consumer resolves the port directly.
    // Feature 072 (T111) — the composed attribute read model, owned by
    // `catalog`. A root bridge, not a module that is unconverted.
    // Feature 072 (wave 2) — how this composition names the acting admin for an
    // audit record: the admin's id, or `null` for a non-admin caller. The ad
    // modules each declared an identically-shaped `resolveAuditContext` option
    // and both roots spelled the same closure once per module.
    adminAuditActorResolver: (request: FastifyRequest) => ({
      actorAdminUserId: request.actor.kind === 'admin' ? request.actor.adminUserId : null,
    }),
    // Feature 072 (wave 2) — the connection a module may build a BullMQ
    // producer queue on. Deliberately a different name from `redis`: the test
    // harness registers `redis` but must NOT hand a queue to these modules, and
    // "no queue in this composition" is a statement a root should be able to
    // make rather than something inferred from a missing option.
    moduleQueueRedis: redis,
    // Feature 072 (wave 2) — the sales-channel code⇄id lookup `google_analytics`
    // resolves. Owned by `sales_channels`; this is a root bridge to its port.
    salesChannelCodeIdPort: {
      idByCode: async (code: string) => (await salesChannels.resolver.getByCode(code))?.id ?? null,
      codeById: async (id: string) => {
        const { items } = await (
          container.cradle as unknown as SalesChannelsCradle
        ).salesChannelsService.list({});
        return items.find((c) => c.id === id)?.code ?? null;
      },
    },
    /**
     * The channel a **channel-scoped** settings read resolves against outside a
     * request (worker, boot hook, CLI): the deployment's system-default sales
     * channel.
     *
     * D-48 removed the `?? null` — the resolver cannot fail to find a default,
     * so this cannot answer "none". The return type stays `string | null`
     * because the *seam* still admits one: a composition may register a
     * resolver of its own that has no channel to offer, and
     * `test/integration/quote_requests/settings-channel.test.ts` exercises
     * exactly that, pinning D-43's warn-once degrade. What is gone is a
     * resolver silently switching tier on an impossible branch.
     *
     * A read that is not per-storefront at all does not call this: it passes
     * `null` to `settingsReadPort.get` deliberately, for a platform-wide read.
     */
    settingsChannelResolver: async (): Promise<string | null> =>
      (await salesChannels.resolver.getSystemDefault()).id,
    // Blog ships no storefront ports today — the factory defaulted this to `{}`
    // and neither composition root ever passed one.
    blogStorefrontDeps: undefined,
  });
  // `audit_logs` registers its own empty default for this name, so a value
  // written before `composeModules` would be overwritten by it (the same trap
  // `prompt_actions` hit).
  composedModules.contribute({
    // Feature 072 (T084) — `audit_logs` owns its routes now and no longer
    // reaches into `admin_users` for identities. Turning an actor id into a
    // name is a **contribution**, so it is gated here rather than declared as
    // a dependency: the audit log must stay readable when `admin_users` is
    // off, and it degrades to raw ids instead of refusing. Deciding what
    // "`admin_users` is present" means is a root's job, not the reading
    // module's; this entry disappears when `admin_users` converts and
    // publishes the resolver itself.
    // Feature 072 (T121) — the gate is the port's own now: `adminUserService`
    // is provided by `admin_users` and raises `ModuleDisabledError` when that
    // module is off, so no root hard-codes `isPresent('admin_users')` here.
    // The contribution itself stays a root's: `audit_logs` owns the name and
    // defaults it absent, and it composes after `admin_users`, so a
    // registration from the module would be overwritten by that default.
    auditActorResolver: async (ids: string[]) => {
      const users = await (
        container.cradle as unknown as AdminUsersCradle
      ).adminUserService.listByIds(ids);
      return users.map((u) => ({
        id: u.id,
        firstName: u.firstName,
        lastName: u.lastName,
        email: u.email,
      }));
    },
  });
  // Feature 072 (T136) — `carts` owns its thirteen services and three route
  // files now. What stays a composition's: who is asking (production reads
  // `request.actor`, the harness `request.testActor`), and the bridge into
  // `shopping_lists`, which points outward and so cannot be a port.
  // Feature 072 (T120) — how an asset id becomes a public URL inside an email.
  // It reaches `assets_library`, which `transactional_emails` must not read
  // through directly, so it stays a composition's to supply.
  composedModules.contribute({
    transactionalEmailAssetUrl: async (assetId: string): Promise<string | null> => {
      try {
        const resolved = await assetsLibrary.handle.service.resolveUrl(assetId);
        return absolutizePublicUrl(resolved.url);
      } catch {
        return null;
      }
    },
  });

  // Feature 072 (T142) — `catalog` owns its services and routes now, and the
  // seven `pim_ergonode` reads through are its ports rather than a second
  // instance built here. What stays a composition's: whether this process runs
  // the bulk-operation consumer (Principle X), how this deployment names an
  // acting admin on an audit record, and the three adapters that reach modules
  // `catalog` must not read through directly.
  composedModules.contribute({
    catalogRunBulkOperationWorker: runWorkers,
    catalogAdminAuditContext: (request: FastifyRequest) => {
      if (request.actor.kind !== 'admin') {
        // Auditing an anonymous mutation shouldn't happen — the admin gate
        // refuses these — but if it ever does, fall back to a sentinel.
        return { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };
      }
      return {
        actorAdminUserId: request.actor.adminUserId,
        impersonatedCustomerAccountId: null,
      };
    },
    catalogExternalAvailability: async (productIds: string[], salesChannelId: string) => {
      // D-61 — the presence probe a `degrades-without` edge owes its owner
      // (D-44), and it belongs here because this closure is where the port is
      // resolved. `catalog` declares the degrade in its manifest: a product
      // listing without `inventory` carries no availability band, which is the
      // empty map, and is exactly what the decorator's absent-contribution path
      // already answers. A closed gate **throws** rather than resolving to
      // `undefined`, so this has to come before the resolution — optional
      // chaining and a `catch` both defend against nothing here.
      if (!effectiveState.isPresent('inventory')) {
        return new Map<string, ProductAvailability>();
      }
      return inventoryCradle().inventoryAvailabilityPort.resolveAvailabilityBands(
        productIds,
        salesChannelId,
      );
    },
    // Full Meilisearch reindex (the `search:reindex` CLI equivalent), run as a
    // `search_reindex` bulk operation when an attribute's `searchable` flag
    // flips. T143a — forwarded to `search`'s own port rather than performed
    // here: this closure used to build a **second** `SearchIndexer` beside the
    // one `searchModule` already holds, and being a root's it answered with
    // `search` switched off. Read per call, so the gate stays live.
    catalogSearchReindex: async () => searchCradle().searchReindexPort.reindexAll(),
    // Storefront product-image placeholder (general.product_image_placeholder_url),
    // resolved global-or-per-channel through the SettingsService. Returns null
    // (no placeholder) when unset or on any resolution error so a settings
    // hiccup can never break product listings.
    catalogImagePlaceholderUrl: async (salesChannelCode?: string) => {
      try {
        // An unknown code falls back to the system-default channel, which
        // always exists (D-48); the placeholder is a per-storefront property,
        // so the default channel's value is the wanted answer, not the
        // platform-wide one the old `?? null` quietly switched to.
        const channelId =
          (salesChannelCode ? await salesChannels.resolver.getByCode(salesChannelCode) : null)
            ?.id ?? (await salesChannels.resolver.getSystemDefault()).id;
        const url = await settings.settingsService.get(
          'product_image_placeholder_url',
          channelId,
          z.string(),
        );
        const trimmed = url.trim();
        return trimmed === '' ? null : trimmed;
      } catch {
        return null;
      }
    },
  });

  // Feature 072 (T141) — the two names `orders` still takes from a composition:
  // which organizations a sales-rep admin may see (actor-shaped, owner `auth`),
  // and the admin-editable sender, late-bound because `transactional_emails`
  // publishes it after this module composes.
  composedModules.contribute({
    ordersAdminScopeResolver: resolveAdminOrdersScope,
  });

  composedModules.contribute({
    cartActorResolver: (request: FastifyRequest) => {
      if (request.actor.kind === 'customer') {
        return {
          customer: {
            customerAccountId: request.actor.customerAccountId,
            organizationId: request.actor.organizationId,
          },
        };
      }
      const cookies = (request as { cookies?: Record<string, string | undefined> }).cookies;
      const anon = cookies?.['b2b_cart_anon'];
      if (anon) return { anonymousToken: anon };
      return {};
    },
    cartShoppingListBridge: {
      pushLineToShoppingList: async (input) => {
        if (!shoppingListService) {
          throw new Error('shopping_lists module not initialized');
        }
        await shoppingListService.addItem(
          {
            customerAccountId: input.customerAccountId,
            organizationId: input.organizationId ?? '',
          },
          input.shoppingListId,
          {
            productId: input.productId,
            ...(input.variantId ? { variantId: input.variantId } : {}),
            quantity: input.quantity,
          },
        );
      },
      appendShoppingListToCart: async (input) => {
        if (!shoppingListService) {
          throw new Error('shopping_lists module not initialized');
        }
        const res = await shoppingListService.convertToCart(
          {
            customerAccountId: input.customerAccountId,
            organizationId: input.organizationId ?? '',
          },
          input.shoppingListId,
          undefined,
        );
        // Map ShoppingListService.convertToCart's shape onto the carts
        // module's uniform return shape across the three conversions.
        return {
          cartId: '',
          appendedLineCount: res.added,
          droppedLines: res.skipped.map((it) => ({
            productId: it.productId,
            productName: it.productId,
            reason: 'not_purchasable',
          })),
        };
      },
    } satisfies CartShoppingListBridge,
  });

  // Feature 017 — Dictionary module. Boot reconciler populates the
  // ISO 3166-1 country catalogue, the major-currency seed metadata,
  // Polish translations for the active subset, and primary
  // language↔country associations. Idempotent — operator edits via
  // Admin UI / API are sticky across boots (FR-019). Admin + storefront
  // HTTP routes ship in user-story phases (Phase 3+); the plugin
  // currently performs the seed reconciler on first registration so
  // the platform boots with a fully populated registry.

  // Feature 006 — Search module. Owns Meilisearch indexer + event-subscriber
  // lifecycle (R-3 — moved out of catalog). Settings-aware suggest config
  // resolution + LLM-toggle wrapper hook in via the same handle.
  // Feature 072 (T123) — `search` owns its services, routes and reindex
  // cadence now. Two names stay a composition's: whether this process runs the
  // sweep, and `price_lists`' resolver, which the module narrows to a
  // suggestion price.
  composedModules.contribute({
    searchRunWorkers: runWorkers,
  });

  // Feature 072 (T129) — the two adapters `inventory` reaches outside itself
  // through: the transactional-email sender that `transactional_emails`
  // announces late, and the Organization's warehouse assignment. Both are a
  // root's to build; how this deployment names a non-admin caller on an audit
  // record is too.
  composedModules.contribute({
    // Feature 072 (T138) — the admin-editable sender `organizations` sends its
    // verification, invitation and new-registration emails through. A getter
    // because `transactional_emails` announces the sender well after this
    // point; same shape and owner as `inventoryTemplateEmail`.
    inventoryAdminAuditContext: (request: FastifyRequest) => {
      const actor = (request as { actor?: { kind: 'admin'; adminUserId: string } }).actor;
      if (actor?.kind !== 'admin') {
        return { actorAdminUserId: '00000000-0000-0000-0000-000000000000' };
      }
      return { actorAdminUserId: actor.adminUserId };
    },
  });

  // Feature 026 — Admin notifications bell. The plugin only mounts read
  // routes; writes happen via the handle (consumed above by the
  // OrgRegistrationNotifier and by future modules that emit notifications).

  // Feature 007 — Comparisons module. US1 wires the customer-facing CRUD
  // endpoints; US2/US4/US5 extend the plugin with share, PDF, and admin
  // routes respectively. Reads catalog through CatalogQueryService (the
  // documented service port — Constitution I) and `compare.max_products`
  // through SettingsService.
  // Feature 072 (T111) — the `CatalogQueryService` built here fed a parameter
  // `ComparisonService` discarded (`_catalogQuery`). Both are gone.
  // Feature 072 (T111) — `comparisons` owns its services and routes now.
  // Anonymous→authenticated adoption is called straight from the login hook
  // below (R-2 / spec FR-005): `comparisonService` is a gated port, so it is
  // resolved per login rather than bound here.

  // Feature 008 — Quote Requests workflow. Built after Settings so the
  // expiry worker can read `quote_requests.expiryDays` through the
  // settings service. Customer + admin context resolvers look up the
  // caller's role for visibility scoping (research §R2 / FR-011 / FR-013).
  // Feature 072 (T132) — `quote_requests` owns its services, routes and the
  // four settings reads now. What stays is a composition's answer to who is
  // asking, the organization's tax rate, and the subtree the RFQ admin scope
  // rolls up over.
  composedModules.contribute({
    rfqCustomerContextResolver: async (request: FastifyRequest) => {
      if (request.actor.kind !== 'customer') {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
      }
      // D-178 — an invariant, not a business state; see `customerResolver`.
      if (!request.actor.organizationId) {
        throw new HttpError(
          500,
          ERROR_CODES.INTERNAL,
          'Invariant violated: a customer account has no Organization (Principle XI).',
          { code: 'customer_account_organization_missing' },
        );
      }
      const account = await identityPorts().customerAccountReadPort.findById(
        request.actor.customerAccountId,
      );
      return {
        customerAccountId: request.actor.customerAccountId,
        organizationId: request.actor.organizationId,
        isOrgAdmin: account?.role === 'organization_admin',
      };
    },
    rfqAdminContextResolver: async (request: FastifyRequest) => {
      if (request.actor.kind !== 'admin') {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
      }
      const ports = identityPorts();
      const adminUser = await ports.adminUserReadPort.findById(request.actor.adminUserId);
      // `getById` rather than a nullable lookup, and it cannot 404 here:
      // `admin_users_admin_role_fk` is `on delete restrict`, so a non-null
      // `adminRoleId` names a row that exists.
      const role = adminUser?.adminRoleId
        ? await ports.adminRolePort.getById(adminUser.adminRoleId)
        : null;
      return {
        adminUserId: request.actor.adminUserId,
        isPlatformAdmin: role?.code === 'platform_admin',
        roleLabel:
          role?.code === 'platform_admin'
            ? 'Platform administrator'
            : role?.code === 'sales_representative'
              ? 'Sales representative'
              : (role?.name ?? 'Administrator'),
      };
    },
    // No `catch` (issue #84). `taxRateFor` answers "nothing applies" as a
    // value — `{ source: 'none' }`, with no rate to read — so the only errors
    // left here are a failing database and `taxes` being switched off.
    // Returning 0 for either quoted a zero-VAT price on an operator's behalf
    // and called it an answer.
    // T143c — the Organization is read through `organizations`' own port
    // rather than by loading its entity here. Both roots spelled the same
    // query, and being a root's it answered with `organizations` switched
    // off: a quote priced from a tenancy row the platform was refusing to
    // serve. The refusal now reaches the same place a database failure does.
    rfqTaxRateResolver: async (organizationId: string) => {
      const org = await (
        container.cradle as never as { organizationTaxProfilePort: OrganizationTaxProfilePort }
      ).organizationTaxProfilePort.taxProfileOf(organizationId);
      const vatStatus = org?.vatStatus ?? 'vat_payer';
      if (vatStatus !== 'vat_payer') return 0;
      const country = org?.country ?? 'PL';
      const resolved = await taxesCradle.taxService.taxRateFor({
        country,
        productType: 'simple',
        vatStatus,
      });
      // `none` is the operator's own configuration state — `taxes` is present
      // and holds no rule that applies and no default — so a quote is priced
      // net, and the quote view drops its VAT row rather than printing a 0%
      // one. An *absent* `taxes` never reaches this line: the port gate above
      // throws (issue #124).
      return resolved.source === 'none' ? 0 : resolved.rate;
    },
  });

  // Feature 072 (T138) — what a login does beyond logging in. Points *outward*
  // from `organizations` to two modules that depend on it, so it cannot be a
  // port; the module defaults it to a no-op and this overwrites that default.
  //
  // Registered after `composeModules` rather than before it, because a value
  // registered before is what the module's own default then overwrites. It is
  // safe this late for the reason it is safe at all: the hook is read at login
  // time, not at construction.
  composedModules.contribute({
    organizationsLoginHook: async (loginCtx: {
      customerAccountId: string;
      organizationId: string | null;
      anonymousCartToken?: string;
      anonymousCompareToken?: string;
    }) => {
      let cartMerge:
        | Awaited<ReturnType<CartsCradle['cartService']['mergeAnonymousIntoCustomer']>>
        | undefined;
      if (loginCtx.anonymousCartToken) {
        cartMerge = await (
          container.cradle as unknown as CartsCradle
        ).cartService.mergeAnonymousIntoCustomer(loginCtx.anonymousCartToken, {
          customerAccountId: loginCtx.customerAccountId,
          organizationId: loginCtx.organizationId,
        });
      }
      // Comparisons' anonymous→authenticated adoption (R-2 / FR-005). Resolved
      // per login rather than captured, so a switched-off `comparisons` cannot
      // go on adopting through an instance this root is holding.
      //
      // D-70 — and the presence question is **decided** here, before the
      // resolution, in the shape D-61 already shipped for
      // `catalogExternalAvailability` above. A closed gate throws rather than
      // resolving to `undefined`, so the probe has to come first. What it buys
      // is not the login's survival — the route's `catch` covers that and stays
      // — but that the one condition an operator creates on purpose stops
      // arriving as a caught error: a skipped adoption is a decision, a caught
      // one is indistinguishable from a database failure. The route then
      // absorbs exactly what feature 037 FR-007/FR-008 say it must, and nothing
      // else.
      if (loginCtx.anonymousCompareToken && effectiveState.isPresent('comparisons')) {
        await (
          container.cradle as unknown as ComparisonsCradle
        ).comparisonService.adoptAnonymousComparison(
          loginCtx.customerAccountId,
          loginCtx.anonymousCompareToken,
        );
      }
      return cartMerge ? { cartMerge } : {};
    },
  });

  // Feature 040 — Customers module. Built after orders + quote_requests so it
  // can reach the OrderListService (late-bound) and the RfqService for the
  // self-service order / RFQ history endpoints.
  // Feature 072 (T140) — `customers` owns its services, its routes and its
  // three settings reads now. Three names stay a composition's: who is asking,
  // who is moderating (both actor-shaped, owner `auth`), and the late-bound
  // order-list service `orders` builds.
  composedModules.contribute({
    customerActorResolver: (request: FastifyRequest) => {
      if (request.actor.kind !== 'customer') {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Customer session required.');
      }
      return {
        customerAccountId: request.actor.customerAccountId,
        organizationId: request.actor.organizationId ?? null,
      };
    },
    customerModerationActorResolver: async (request: FastifyRequest) => {
      const actor = request.actor;
      if (actor.kind !== 'admin') {
        throw new HttpError(401, ERROR_CODES.UNAUTHORIZED, 'Admin session required.');
      }
      const knex = em().getKnex();
      const roleRow = (await knex.raw(
        `select ar."code" as code from "admin_users" au left join "admin_roles" ar on ar."id" = au."admin_role_id" where au."id" = ?`,
        [actor.adminUserId],
      )) as { rows: Array<{ code: string | null }> };
      const isPlatformAdmin = (roleRow.rows[0]?.code ?? null) !== 'sales_representative';
      let allowedOrganizationIds: string[] = [];
      if (!isPlatformAdmin) {
        // Feature 056 — subtree-expanded when the rep holds `organizations:rollup`.
        allowedOrganizationIds = await salesRepScope().listAssignedOrganizationIds(
          actor.adminUserId,
        );
      }
      return { adminUserId: actor.adminUserId, isPlatformAdmin, allowedOrganizationIds };
    },
  });

  // Feature 047 — Invoices. Owns issuance, numbering, PDF rendering, admin +
  // customer routes. Constructed before returns so the corrective-invoice
  // provider can draw correction numbers from the shared number generator.
  // Feature 072 (T113) — `invoices` owns its services and routes now. What
  // stays here is how this composition reaches outside the module,
  // contributed as one bridge.
  composedModules.contribute({
    invoicesBridge: {
      resolveAdminUserId: (req) => adminContextResolver(req).adminUserId,
      resolveCustomerContext: (req: FastifyRequest) => {
        const c = customerResolver(req);
        return { customerAccountId: c.customerAccountId, organizationId: c.organizationId };
      },
      getTransactionalEmailSender: () => emailCradle().transactionalEmailSenderAccessor(),
      resolveRecipientEmail: async (order) =>
        (
          await identityPorts().customerAccountReadPort.findById(order.placedByCustomerAccountId)
        )?.email ?? null,
      resolveLanguage: async (salesChannelId) =>
        (salesChannelId
          ? (await em().findOne(SalesChannel, { id: salesChannelId }))?.defaultLanguage
          : null) ?? 'en-US',
      loadAssetImage: async (assetId) => {
        // T052 — the row read sits **outside** the `try`, deliberately. It is a
        // gated port now, and a `catch` around one turns "this capability is
        // off" into "this asset is not an image" (composition checklist item
        // 7). What the `try` is for is the storage adapter below: a backend
        // that cannot stream the bytes is an invoice rendered without a logo,
        // which is the degrade this bridge is written for.
        const a = await assetReadPort().findById(assetId, { liveOnly: true });
        if (!a || !a.mimeType.startsWith('image/')) return null;
        try {
          const adapter = await assetsLibrary.handle.adapters.getForBackend(a.storageBackend);
          // Legacy resolver only has resolveUrl — cannot stream bytes for PDF embed.
          if (!('open' in adapter) || typeof adapter.open !== 'function') return null;
          const stream = await adapter.open({ locator: a.storageLocator || a.storageUrl });
          const chunks: Buffer[] = [];
          for await (const chunk of stream) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
          }
          return { bytes: Buffer.concat(chunks), mimeType: a.mimeType };
        } catch {
          return null;
        }
      },
    } satisfies InvoicesBridge,
  });

  // Feature 059 — KSeF (Krajowy System e-Faktur). Consumes the invoices
  // domain events, submits FA(3) documents through a durable queue, and feeds
  // the KSeF number/QR back through the invoices port + PDF-renderer seam.
  // Feature 072 (T104) — `ksef` owns its services and routes now.
  composedModules.contribute({
    ksefSellerNipResolver: async () => {
      try {
        // Platform-wide: one legal seller issues every invoice this deployment
        // produces, so there is no channel to read for. This used to be the nil
        // UUID — a well-formed id that addresses no row, which resolved to the
        // same tier by accident rather than by saying so (D-41).
        const raw = await settings.settingsService.get('invoices.seller.tax_id', null, z.string());
        const nip = raw.replace(/^PL/i, '').replace(/[\s-]/g, '');
        return nip.length > 0 ? nip : null;
      } catch {
        return null;
      }
    },
  });
  const ksefCradle = container.cradle as unknown as KsefCradle;
  // PDF QR seam (contracts/invoices-integration.md §3) — one resolver covers
  // every render path; absent/disabled module ⇒ pre-059 output.
  // Feature 072 (T113) — contributed, not set. `invoices` installs its own
  // resolver at construction and reads this per call, so a deployment without
  // KSeF simply has no verification block rather than an unset setter.
  composedModules.contribute({
    ksefVerificationResolver: ksefCradle.ksef.handle.buildVerification,
  });

  // Feature 067 — Product Feed. Projects a sales channel's catalogue into
  // provider-shaped feed files published at a tokenised URL. Every cross-module
  // read is an injected collaborator (Principle I); channel membership goes
  // exclusively through the sanctioned accessor (Principle XII); artefact bytes
  // go through the Assets Library storage adapters WITHOUT creating `Asset`
  // rows (FR-043).
  //
  // Its own `CatalogQueryService` instance, for the same reason promotions has
  // one: it is the documented cross-module catalog port (Constitution I), and
  // sharing one instance between two unrelated consumers would make an
  // unrelated wiring change to one of them a silent change to the other.
  // Feature 072 (T137) — `product_feeds` owns its services and routes now.
  // The four adapters it reaches outside itself through stay a root's: each
  // crosses a boundary the module must not reach through directly.
  composedModules.contribute({
    productFeedsBridge: {
      storageAdapters: {
        getActive: () => assetsLibrary.handle.adapters.getActive(),
        getForBackend: async (backend) => {
          const adapter = await assetsLibrary.handle.adapters.getForBackend(backend);
          // `getForBackend` also answers the legacy resolver, which can only
          // build URLs. A feed artefact is always written by a real adapter, so
          // reaching this branch means the row is corrupt — fail loudly rather
          // than serving nothing.
          if (!('open' in adapter) || typeof adapter.open !== 'function') {
            throw new Error(
              `product_feeds: storage backend "${backend}" cannot stream artefact bytes.`,
            );
          }
          return adapter;
        },
      },
      resolveAvailability: async (productIds: string[], salesChannelId: string) => {
        // T143a — `inventory`'s port. Both roots built a second
        // `StockLevelService` + `WarehouseChannelService` here and spelled this
        // two-step twice; the module owns one pair now, and it stops answering
        // when `inventory` is switched off.
        return inventoryCradle().inventoryAvailabilityPort.resolveAvailabilityBands(
          productIds,
          salesChannelId,
        );
      },
      // Feature 072 (T143a) — `catalog`'s own port. This root used to build a
      // second `CatalogQueryService` here, and a second
      // `CatalogAttributeReadService` whose only purpose was to feed it, while
      // the module built its own of each. Both are gone: one instance now, and
      // it stops answering when `catalog` is switched off, which the root's
      // copy never did.
      expandCategoryProductIds: (categoryIds: string[]) =>
        (
          container.cradle as never as { catalogQueryPort: CatalogQueryService }
        ).catalogQueryPort.expandCategoryProductIds(categoryIds),
      resolvePublicImageUrls: async (assetIds: string[]) => {
        const out = new Map<string, string>();
        if (assetIds.length === 0) return out;
        const assets = (await assetReadPort().findByIds(assetIds, { liveOnly: true })).filter(
          (asset) => asset.visibility === 'public',
        );
        const apiOrigin = configuredPublicApiBaseUrl();
        for (const asset of assets) {
          try {
            const resolved = await assetsLibrary.handle.service.resolveUrl(asset.id);
            if (resolved.expiresAt !== null) continue; // signed ⇒ not stable
            const url = /^https?:\/\//i.test(resolved.url)
              ? resolved.url
              : apiOrigin === null
                ? null
                : `${apiOrigin}/${resolved.url.replace(/^\/+/, '')}`;
            if (url) out.set(asset.id, url);
          } catch {
            // An unresolvable asset is simply not an image for this feed.
          }
        }
        return out;
      },
    } satisfies ProductFeedsBridge,
  });
  // Feature 072 (T137) — the three boot reconciles (predefined templates,
  // bundled taxonomies, per-feed schedules) moved into the module's own
  // `ctx.onBoot`, where the schedule one reads the same `runWorkers` decision
  // this root contributes.

  // Feature 068 — Ergonode PIM integration. A read-only inbound connector that
  // walks Ergonode's cursor-based change streams and keeps the catalogue in step
  // with them.
  //
  // Every catalogue write goes through catalog's own services, so an imported
  // product is audited, channel-bound and tenant-guarded by exactly the code an
  // administrator's edit runs through (Principle XIII). Those services are
  // constructed here rather than shared, for the same reason `product_feeds`
  // gets its own `CatalogQueryService`: they are this module's documented
  // cross-module ports (Principle I), and sharing one instance between two
  // unrelated consumers would make a wiring change to one a silent change to the
  // other.
  // Feature 072 (T142) — the seven `catalog` services this block used to build
  // a **second** time, purely to hand to `pim_ergonode` while `catalog` built
  // its own set inside its plugin, are gone: that module provides them as
  // ports, so there is one instance of each per composition and the Ergonode
  // importer writes through the same one the admin API does. `assetsLibrary`'s
  // is the last one left here, and it drains when that module converts.
  composedModules.contribute({
    assetsLibraryService: assetsLibrary.handle.service,
  });
  // FR-005 — the boot-time schedule reconcile moved into the module's own
  // `ctx.onBoot` in T131, where it reads the same `runWorkers` decision this
  // root contributes.

  // Feature 046 — Returns & Complaints (Refunds, RMA). Reads order facts only
  // through the OrderReturnContextPort (Principle I); settings drive the
  // free-return window and RMA prefix/suffix.
  // Feature 072 (T109) — `returns` owns its services and routes now. The
  // four settlement adapters and the actor resolvers stay here as one
  // bridge: each is a small adapter over `payments`, `invoices`,
  // `credit_limits` and `orders`, and a composition supplies all or none.
  // T143c — the four settlement adapters are their owners' ports now. Each was
  // a class this root constructed out of `orders`, `payments`, `invoices` and
  // `credit_limits`, so the root held an **ungated** second way into all four:
  // a settlement kept refunding, correcting and crediting through modules an
  // operator had switched off. Read per call, so the gate answers at the
  // settlement it is about, which is also why the accessor shape the two
  // money-moving ones already used is no longer needed here.
  const settlementCradle = (): {
    orderReturnContextPort: ReturnsBridge['orderContext'];
    paymentRefundPort: ReturnsBridge['paymentRefund'];
    correctiveInvoicePort: ReturnsBridge['correctiveInvoice'];
    creditTopupPort: ReturnsBridge['creditTopup'];
  } => container.cradle as never;
  composedModules.contribute({
    returnsBridge: {
      resolveCustomerAccountId,
      resolveAdminUserId: (req) => adminContextResolver(req).adminUserId,
      orderContext: {
        getReturnContext: (orderId) =>
          settlementCradle().orderReturnContextPort.getReturnContext(orderId),
      },
      paymentRefund: {
        refund: (input) => settlementCradle().paymentRefundPort.refund(input),
      },
      correctiveInvoice: {
        createCorrection: (input) =>
          settlementCradle().correctiveInvoicePort.createCorrection(input),
      },
      creditTopup: {
        creditFromReturn: (input) => settlementCradle().creditTopupPort.creditFromReturn(input),
      },
      // The notifier itself is `returns`' own class and is built by `returns`
      // since T143c; what a composition still answers is where the message goes
      // and in which language.
      resolveCustomerEmail: async (customerAccountId) =>
        (await identityPorts().customerAccountReadPort.findById(customerAccountId))?.email ?? null,
      resolveChannelLanguage: async (salesChannelId) =>
        (await em().findOne(SalesChannel, { id: salesChannelId }))?.defaultLanguage ?? 'en-US',
    } satisfies ReturnsBridge,
  });

  // Feature 047 — Transactional Emails. Owning modules register their default
  // subject + content here; the module reconciles all manifest-declared emails
  // at boot and exposes the sender port for future send-site cutover.
  // Feature 047 — net-new email subscribers (payment status + shipment created).
  // Feature 072 (T126) — `payments` owns the payment-status notifier now and
  // subscribes through `ctx.subscribe`, so it stops when the module does. The
  // sender stays a contribution: `transactional_emails` announces it through a
  // callback this root holds, later than the module composes.
  composedModules.contribute({
    paymentEmailSender: () => emailCradle().transactionalEmailSenderAccessor(),
  });
  // Feature 072 (T124) — `shipments` owns the shipment-created notifier now and
  // subscribes through `ctx.subscribe`, so it stops when the module does. The
  // sender stays a contribution: `transactional_emails` announces it through a
  // callback this root holds, later than the module composes.
  composedModules.contribute({
    shipmentEmailSender: () => emailCradle().transactionalEmailSenderAccessor(),
  });
  // Feature 049 — Stripe payment gateway. Registers the Stripe PaymentAdapter
  // + gateway refund handler into the shared singletons, seeds one
  // payment_methods row per Stripe method, and mounts the webhook / storefront /
  // admin routes. Coupling (settings, sales channels, default channel) is
  // injected so the module stays isolated (Principle I).

  modules.push();

  // Feature 048 — Newsletter. Own-infrastructure bulk email: subscriber
  // signup (per-channel opt-in), campaigns, automations, and a configurable
  // sending provider. Channel/mailer/settings coupling is injected here so the
  // module stays isolated (Principle I).
  // Feature 072 (T114) — `newsletter` owns its services and routes now.
  // These stay here because they are pinned per composition rather than
  // derived: the token secret and base URLs decide what an unsubscribe link
  // looks like, and the harness needs that predictable.
  composedModules.contribute({
    newsletterBridge: {
      tokenSecret:
        process.env['NEWSLETTER_TOKEN_SECRET'] ??
        process.env['SESSION_COOKIE_SECRET'] ??
        'newsletter-dev-secret',
      // The channel a subscriber with no channel context belongs to. Kept as a
      // *channel* rather than folded into D-41's platform-wide read: opt-in
      // mode and confirmation TTL are per-storefront properties, so "the
      // system-default channel's value" and "the platform-wide value" are
      // different answers and this one wants the former. The provider config
      // reads, which are genuinely platform-wide, no longer take it at all.
      defaultChannelId: (await salesChannels.resolver.getSystemDefault()).id,
      resolveChannelIdByCode: async (code) =>
        (await salesChannels.resolver.getByCode(code))?.id ?? null,
      // The confirm/unsubscribe links this builds are `/api/v1/newsletter/...`
      // paths, so the origin is the API's, never the storefront's. It used to
      // fall back to `STOREFRONT_BASE_URL`, which on the shipped production
      // template pointed every confirmation link at a Next.js host that serves
      // no such route (issue #218).
      publicBaseUrl: resolvePublicApiBaseUrl(),
      storefrontBaseUrl: process.env['STOREFRONT_BASE_URL'] ?? 'http://localhost:3000',
      loadCustomerEmail: async (customerAccountId) =>
        (await identityPorts().customerAccountReadPort.findById(customerAccountId))?.email ?? null,
      mailer: platformMailer,
      emitEvent: (name, payload) =>
        eventBus.emit(name, {
          eventId: randomUUID(),
          occurredAt: new Date().toISOString(),
          ...payload,
        }),
      resolveCustomerAccountId,
    } satisfies NewsletterBridge,
    // Contribution: campaign email carries this deployment's logo and accent,
    // announced by `transactional_emails` after it is built.
    newsletterEmailBranding: async (salesChannelId: string | null) => {
      const branding = emailCradle().emailBrandingAccessor();
      if (!branding) return { logoUrl: '', accentColor: '#1f2937' };
      return branding.resolve(salesChannelId);
    },
  });

  // Feature 049 — Google Analytics. GA4 integration: per-channel activation +
  // Measurement ID, Enhanced Ecommerce, custom events, and server-side tagging.
  // Config lives in the Settings module; server-side delivery is queue-backed.

  // Feature 063 — LinkedIn Ads. Per-channel Insight Tag + conversion mappings.
  // Config lives in the Settings module; the access token is a `secret` setting.

  // Feature 064 — Meta Ads. Per-channel Meta Pixel + custom event mappings.

  // Feature 066 — Google Tag Manager. Settings-only module: per-channel
  // container injection plus the optional server-side tagging relay. It owns
  // no table and no admin page, so no EntityManager and no requireAdmin here.

  // Shopping lists / quick order — depends on the RFQ service built above
  // so the "convert to RFQ" flow goes through the new createForCustomer API.
  // Feature 072 (T133) — `shopping_lists` owns its services and routes now, and
  // reads the quick-order settings itself. Three names stay a composition's:
  // two cross-module services it must not reach for directly, and the sink that
  // hands its own service back to `carts` until that module converts.
  composedModules.contribute({
    shoppingListServiceSink: (svc: ShoppingListService) => {
      shoppingListService = svc;
    },
  });

  // Feature 018 — Module Lifecycle. Builds the static manifest registry
  // from every module's `manifest` export, exposes the orchestrator handle,
  // and starts the Redis-backed enabled-set cache (subscribes to the
  // `b2b:module:state-changed` pub/sub channel). The plugin pushed below
  // does the cache warming on first registration; the registry is built
  // here so other module compositions could consult it.
  // Feature 019 — Admin UI i18n. Built BEFORE the lifecycle so its
  // reconciler can be plugged into the orchestrator at construction
  // time. The boot-time bundle reconciler runs at plugin-attach via a
  // lazy registry accessor (the lifecycle's registry is populated by
  // the time the plugin chain is registered).
  let lifecycleRef: typeof lifecycle | undefined;
  // Feature 072 (T089) — `_i18n` owns its service, its reconciler and its
  // routes now. The root only reads the two the platform consumes.
  const adminI18nCradle = container.cradle as unknown as AdminI18nCradle;

  // Feature 020 — Admin Command Palette actions registry. Built before
  // the lifecycle so its reconciler can be plugged into the orchestrator
  // at construction time.
  // Feature 072 (T099) — `admin_actions` owns its service, its reconcile and
  // its routes now. The operator presence axis stays a root's to supply:
  // which modules a deployment ships is not this module's business.
  composedModules.contribute({
    // Issue #225 — the reading and its generation, contributed as one value.
    // The palette memoises what the reading produced, so a root that handed
    // over the reading alone would hand over a cache nothing can drop: the
    // pub/sub message that announces a flip arrives while `refreshFromDb` is
    // still in flight, and the snapshot rebuilt on it is built from the
    // presence before the flip.
    modulePresenceProbe: {
      isActivated: (moduleId: string): boolean =>
        effectiveState.presence(moduleId)?.operatorActivated ?? true,
      version: (): number => effectiveState.presenceVersion(),
    },
  });

  const lifecycle = lifecycleModuleFromStaticEntries(
    {
      orm,
      redis,
      redisSubscriber,
      emFactory: em,
      auditLog: auditLogService,
      // Feature 080 (T033, D-155.3(c)) — who owns which migration, merged over
      // core plus every installed extension package. This root is where it is
      // known: the orchestrator may not import the ORM config, and the packages
      // half is a runtime discovery, so the merged value arrives as an
      // injected value rather than as an import of anything async. Without it
      // the orchestrator answers from the committed core registry and refuses
      // a hard uninstall of a module that registry cannot enumerate — which is
      // exactly the fail-closed a package's `uninstall --hard` needs.
      migrationOwnership: (await configuredMigrations()).ownership,
      // Feature 080 (T036a, D-159) — the two reconcilers this root used to hand
      // over are gone. `_i18n` and `admin_actions` declare a
      // `lifecycleParticipant` in their own `manifest.ts` and the orchestrator
      // collects it from the registry below, which is the one shape that also
      // reaches a `module:*` command (a platform command composes nothing, so
      // it could resolve neither service) and an installed package.
      //
      // **This changes the admin path's behaviour, deliberately** (D-159 §9,
      // owner's ruling of 2026-08-22). `adminActionsReconciler` was forwarded
      // through a lambda because it is a gated port and `admin_actions` is
      // deactivatable, so a switched-off command palette *aborted* the install
      // of an unrelated module — chosen over the only alternative then on the
      // table, a backend that would not start. The participant is gated on
      // nothing, so the install succeeds and the rows are written whether or
      // not anything is serving them, which is what a projection of manifest
      // data should do.
    },
    // Handed over unmapped: an identity map here is where a field added to
    // `RegisteredManifestEntry` later gets silently dropped, and one just was.
    resolvedRegistry,
  );
  lifecycleRef = lifecycle;
  // Feature 072 (T125) — `_lifecycle` registers its own routes now, through
  // `ctx.ungatedRoutes`. Two names stay a composition's, and both genuinely
  // differ: this deployment boots an orchestrator (the harness does not, because
  // it never populates `module_registrations`), and a committed flip propagates
  // by refreshing from the database and dropping the storefront's cache.
  composedModules.contribute({
    lifecycleOrchestrator: lifecycle.handle.orchestrator,
    lifecycleActivationPropagation: {
      commandBus,
      propagation: {
        // The writing process refreshes itself rather than waiting on its own
        // pub/sub round trip, so the very next request it serves sees the
        // new state.
        refreshLocalState: () => registryCache.refreshFromDb(em),
        publishStateChanged: (payload: Parameters<typeof publishStateChanged>[1]) =>
          publishStateChanged(redis, payload),
        revalidateStorefront: (tags: string[]) =>
          new StorefrontRevalidator({
            baseUrl: process.env['STOREFRONT_BASE_URL'],
            secret: process.env['REVALIDATE_SECRET'],
          }).revalidate(tags),
      },
    },
  });
  // Feature 072 (T089) — the accessor `_i18n` walks to reconcile every module's
  // translation bundles. It stays an accessor rather than the registry itself
  // because of the order this file is written in: `_i18n` composes ~1900 lines
  // above, and the registry it needs does not exist until the line above this
  // one. `_i18n` resolves it at plugin-attach time, which
  // is after this function returns. Goes when `_lifecycle` converts.
  composedModules.contribute({
    lifecycleManifestRegistry: () => lifecycleRef?.handle.registry,
  });

  // The boot half only: reconciling first-boot registrations, warming the
  // registry cache and resuming workers. Its routes are the module's own now.
  modules.push(lifecycle.plugin);

  // Feature 043 — prompt assistant for the admin command palette.
  //
  // Nothing here any more, and the sentence that used to be is worth keeping.
  // The **tools** left this root with D-44: `catalog`, `inventory` and `orders`
  // each push their own from their own boot hook, declaring the edge as
  // `nonBindingDependencies` — a contribution that says nothing about who may
  // switch whom off. The bulk-progress reader could not follow, because what a
  // root cannot hand over is a name a module *defaults*: `prompt_actions`
  // registered `promptActionsBulkProgressResolver` as `undefined` for a
  // deployment that ships no `catalog`, and a module may not write a name
  // another module owns (`kernel.md`). D-72 point 4 turned that slot into
  // `promptActionBulkProgressRegistry`, a table keyed by contributing module,
  // so `catalog` pushes from its own boot hook like the other five and this
  // root stops naming `catalog/prompt-tools.js` at all.

  // Feature 004 / T024 — Boot-time manifest reconciliation. Walks every
  // module's settings manifest and inserts any missing groups/settings
  // idempotently before the HTTP layer starts serving requests. NEVER deletes
  // (R-1); destructive uninstall is CLI-only.
  // Derived from the module registry, not hand-listed: a module that declared
  // `settings:` but was forgotten in a literal array never got its rows, so
  // /settings silently omitted it (see collectRegisteredSettingsManifests).
  // linkedin_ads / meta_ads / tpay / payu / cms need no entry here — registering
  // their manifests is enough.
  // Feature 075, Phase C — the registry is passed in rather than imported by
  // `settings`. Which modules a deployment ships is this root's input, which is
  // why `resolvedModuleRegistry` is a platform-owned name.
  //
  // Feature 080 (T046) — the argument was bare-core `REGISTERED_MANIFESTS`,
  // recorded here as "a cut and not a widening". The cut had a live cost on the
  // operator axis (Principle XVII): an **overlay** module's presence is
  // converged by `loadModulePresence` above, so no `install` ever runs for it
  // and this reconcile is the only author its activation Setting can have.
  // `example_overlay` declares one and never got a row — it was installed,
  // gated and switchable in every respect except that the operator had nothing
  // to switch.
  //
  // The population is therefore `deploymentShippedEntries`, the same split
  // D-157.6(b) ruled for the first-boot insert and the same function, not a
  // second copy of the origin test (D-100). A **package** is excluded for a
  // reason of its own rather than for symmetry: since D-157.6(b) it has exactly
  // one author, `install`, which reconciles its settings inside the operation
  // that also applies its migrations — so reconciling them here as well would
  // let a `SettingCodeConflict` in something an operator merely `pnpm add`ed
  // abort this boot.
  const settingsManifests: ModuleSettingsManifest[] = settingsManifestCollectionPort().collect(
    deploymentShippedEntries(resolvedRegistry),
  );
  const reconcilerEm = em();
  const reconciler = new ManifestReconciler(reconcilerEm);
  const reconciliation = await enterSystemScope(
    'boot: reconcile module settings manifests',
    () => reconciler.apply(settingsManifests),
    { entryPoint: 'boot' },
  );
  for (const m of reconciliation.perModule) {
    if (m.orphanSettings.length > 0 || m.orphanGroups.length > 0) {
      // Boot-time logging path; the Fastify logger is not yet available here.
      console.warn(
        `[settings] orphan rows for module "${m.moduleCode}": ` +
          `${m.orphanSettings.length} settings, ${m.orphanGroups.length} groups`,
      );
    }
    eventBus.emit('settings.module_reconciled', {
      eventId: `settings.module_reconciled:${m.moduleCode}:${Date.now()}`,
      occurredAt: new Date().toISOString(),
      moduleCode: m.moduleCode,
      addedCount: m.addedGroups + m.addedSettings,
      updatedCount: m.updatedGroups + m.updatedSettings,
      orphanCount: m.orphanGroups.length + m.orphanSettings.length,
    } as never);
  }

  // The explicit boot phase (FR-021), run **once**, after every registration
  // and every contribution above and before `index.ts` calls `buildServer`
  // (D-45). That is what makes the rule statable in one sentence: a boot hook
  // may resolve anything, and a root contribution goes between `composeModules`
  // and this line.
  //
  // Why one phase rather than several: a contribution registered *after* a boot
  // hook has already run is invisible to that hook, which reads the owning
  // module's default instead and reports nothing — no error, no warning, a
  // value that is simply the wrong one. Any split of this phase reopens that
  // window for every name a module defaults; D-45 counted six live ones when it
  // closed the split (`organizationsLoginHook`, `ksefVerificationResolver`,
  // `newsletterEmailBranding`, `shoppingListServiceSink`, `lifecycleOrchestrator`,
  // `promptActionsBulkProgressResolver`). One `composeModules` call, one
  // contribution slot, one `runBootHooks()` is what keeps that unspellable.
  //
  // Issue #52 — and this line is what closes the slot: every
  // `composedModules.contribute(…)` below it throws
  // `ContributionWindowClosedError` naming the rule, rather than landing
  // somewhere no hook will read.
  await composedModules.runBootHooks();

  return {
    orm,
    redis,
    modules,
    commandBus,
    apiInterceptors,
    container,
    // Bound to the composed object rather than re-implemented: a second way to
    // build a module's context is a second answer about what that module
    // resolves (T042b).
    contextFor: (moduleId) => composedModules.contextFor(moduleId),
    resolvedModules: resolvedRegistry,
    errorEnvelope: {
      errorTranslationTargets: ERROR_TRANSLATION_KEYS,
      // Issue #234 — the ladder is one kernel function, and the root keeps the
      // one rung that reads a module's table (D-137). What stood here was
      // `if (request.actor.kind !== 'admin') return null`, which the envelope
      // turns into the platform fallback: every Polish error sentence the
      // platform ships was unreachable for a buyer.
      resolvePreferredLanguage: createRequestLanguageResolver({
        adminPreferredLanguage: async (adminUserId) =>
          (await identityPorts().adminUserReadPort.findById(adminUserId))?.preferredLanguage ??
          null,
      }),
      translateErrorMessage: async ({ moduleId, key, language, originalMessage, params }) => {
        const translated = await adminI18nCradle.adminI18nService.translate(
          moduleId,
          key,
          language,
          params,
        );
        return translated === `${moduleId}.${key}` ? originalMessage : translated;
      },
    },
    dispose: async () => {
      // Feature 062 — drain the webhook delivery pipeline before dropping the
      // Redis connections (graceful shutdown). Every part of that is the
      // container's job since T143a: `ctx.subscribe` unsubscribes with the
      // module, the queue registration carries its own disposer, and the
      // delivery worker is `webhooks`' own. Disposing the container runs those
      // disposers — for every module, not only this one — and it runs *before*
      // the Redis sockets go, which is the ordering the drain needs.
      //
      // The call is new here, and its absence was a quiet leak: production
      // never disposed the container at all, so the BullMQ producer queue
      // T098 moved into the module was never closed on shutdown. The harness
      // has always disposed it (`teardownBackendServer`).
      await container.dispose();
      redis.disconnect();
      redisSubscriber.disconnect();
      await closeOrm();
    },
  };
}
