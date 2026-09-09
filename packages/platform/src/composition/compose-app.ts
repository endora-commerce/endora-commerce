/**
 * `composeApp` — the production half of what `composeTestServer` already is
 * (`specs/110-instance-repository/` T118; `contracts/instance-repository.md`
 * R1.4 and R2.4).
 *
 * ## What "the platform's" means here, precisely
 *
 * Everything in a deployment's composition that is true of **any** Endora
 * platform and mentions no module: refuse a boot with no public origin, open the
 * ORM, build the container, register the ORM-derived names and the host values,
 * construct the audit writer, the event bus, the command bus and the two Redis
 * clients, load presence from the database, compose the settings and
 * sales-channel kernels, run `composeModules` once, open the contribution window
 * once, install the request-scope hook, reconcile the settings manifests, run
 * the boot phase once, assemble the error envelope, and give back a handle that
 * can take all of it down again.
 *
 * Everything else — which modules, which ORM configuration, which manifests,
 * which contributions, which actor a request carries — is the caller's, and
 * reaches this function either as {@link AppComposition} or as one of the hooks
 * below.
 *
 * ## The contribution wiring is the point, and it is a callback
 *
 * R1.4 puts *the contribution wiring* in this package; it does **not** put the
 * 61 values `backend/src/composition.ts` contributes here. 41 of them carry a
 * module's type or a value built out of a module's services, which D-52/D-53
 * refuses from inside this package — so what moves is the *slot*, and the values
 * arrive through {@link ComposeAppOptions.contribute}. Twenty do move, and every
 * one of them is a kernel sub-kernel's object, a host value or an environment
 * read; they are contributed **before** the caller's callback, so a deployment
 * can still overwrite one.
 *
 * That is what makes R2.4 true the day this lands rather than after a sweep: an
 * instance supplies no callback, so no file in a client's tree contributes over
 * a name a module defaults, while this repository's `composition.ts` keeps its
 * own as the **reference deployment's** — which is what it is, and not an
 * instance.
 *
 * ## The one ordering rule, and why it is a shape rather than a comment
 *
 * `composeModules` runs once and `runBootHooks` runs once, immediately before
 * this function returns, so a boot hook may resolve anything. A contribution
 * over a name a module defaults goes in the single slot between them — earlier
 * and the module's own registration overwrites it, later and a boot hook has
 * already read the default (D-45). That slot is
 * {@link ComposeAppOptions.contribute}, and both edges are enforced by the
 * platform rather than remembered: the early one because `ComposedModules` does
 * not exist until every module has registered, the late one because `contribute`
 * throws `ContributionWindowClosedError` once `runBootHooks` has started
 * (issue #52).
 *
 * ## Why no module may name this file
 *
 * It is on `./composition`, the host-internal subpath D-160.14 rules: declared
 * by the `exports` map, carried by no published barrel, and answered for a
 * module's reach with `host-internal-subpath`.
 */

import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type { FastifyRequest } from 'fastify';
import { Redis } from 'ioredis';
import type {
  AdminI18nTranslatePort,
  AdminUserReadPort,
  ModuleSettingsManifest,
  SettingsManifestCollectionPort,
} from '@endora-commerce/contracts';

import { CommandBus } from '../commands/index.js';
import { configuredEntitiesFrom } from '../db/configured-entities.js';
import { discoverConfiguredMigrations } from '../db/configured-migrations.js';
import { mikroOrmConfigFrom } from '../db/mikro-orm.config.js';
import { createOrmBootstrap } from '../db/orm.js';
import { EventBus } from '../events/bus.js';
import type { ErrorEnvelopeOptions } from '../http/error-envelope.js';
import { ApiInterceptorRegistry } from '../http/interceptors/index.js';
import type { ModulePlugin } from '../http/server.js';
import { StorefrontRevalidator } from '../http/storefront-revalidator.js';
import { AuditLogService } from '../kernel/audit/audit-log-service.js';
import { composeModules } from '../kernel/compose.js';
import {
  createRootContainer,
  registerOrm,
  registerValues,
  type KernelContainer,
} from '../kernel/container.js';
import { composeErrorEnvelopeOptions } from '../kernel/i18n/error-envelope-options.js';
import {
  buildErrorTranslationTargets,
  describeErrorCodeCollisions,
} from '../kernel/i18n/error-translation.js';
import { effectiveState } from '../kernel/lifecycle/effective-state.js';
import { publishStateChanged, registryCache } from '../kernel/lifecycle/registry-cache.js';
import { requiredModulesFrom } from '../kernel/lifecycle/required-modules.js';
import { platformLogger } from '../kernel/logging.js';
import { createRegistrationOwnership } from '../kernel/module-context.js';
import {
  assertPublicApiBaseUrlConfigured,
  resolvePublicApiBaseUrl,
} from '../kernel/public-api-base-url.js';
import { registerRequestScopeHook } from '../kernel/request-scope-hook.js';
import {
  composeSalesChannelsKernel,
  type SalesChannelsKernel,
} from '../kernel/sales-channels/compose.js';
import { enterSystemScope } from '../kernel/scope.js';
import { composeSettingsKernel, type SettingsKernel } from '../kernel/settings/compose.js';
import { ManifestReconciler } from '../kernel/settings/manifest-reconciler.js';
import {
  deploymentShippedEntries,
  loadModulePresence,
  resolveManifestEntries,
  type RegisteredManifestEntry,
} from '../lifecycle/index.js';
import { activeOverlayModulesRoot } from '../overlay/deployment-roots.js';
import { overlayModuleEntriesUnder } from '../overlay/overlay-runtime.js';
import {
  discoverPackageModuleManifests,
  installedPackageModuleIdClaims,
  loadPackageModuleEntries,
} from '../packages/package-runtime.js';
import { nodeModulesRootsFor } from '../packages/installed-packages.js';
import { forkScopedEm } from '../tenancy/scoped-em.js';
import { systemTenantContext } from '../tenancy/resolve-tenant-context.js';
import type { TenantContext } from '../tenancy/tenant-context.js';

/** One composed module, named through `composeModules`' own signature. */
type ModuleEntry = Parameters<typeof composeModules>[0][number];

/** `composeModules`' return, named through its signature, for the same reason. */
type ComposedModules = ReturnType<typeof composeModules>;

/**
 * How a composition opens and closes its ORM.
 *
 * A pair rather than an instance, for the reason the application's own
 * `initOrm`/`closeOrm` are a pair: the ORM configuration captures
 * `DATABASE_URL` at import, so *when* it is opened is part of what the caller
 * decides.
 */
export interface AppOrmLifecycle {
  open(): Promise<MikroORM>;
  close(): Promise<void>;
}

/**
 * What only this build knows about itself.
 *
 * Every member is optional, and the default is the same call with the
 * **compiled-in half empty** — which is exactly an instance: it ships no
 * generated manifest index, no committed entity registry and no committed
 * migration registry, so its modules, its entities and its migrations are the
 * packages it installed and nothing else (R1.2, D-119/D-155).
 *
 * A member is therefore never a second derivation of an answer the platform
 * already has. `resolveManifestEntries`, `configuredEntitiesFrom` and
 * `discoverConfiguredMigrations` are the same functions the application's own
 * bindings call; what an application supplies is their `core*` argument.
 */
export interface AppComposition {
  /**
   * The module entries to compose — this repository's `MODULES` plus its
   * overlay modules plus its discovered packages, or an instance's own set.
   *
   * A composition lacking a module that declares `activation.nonDeactivatable`
   * is refused by `composeModules` before the first module registers (issue
   * #258), and nothing here adds a second check or swallows the refusal.
   */
  readonly modules?: readonly ModuleEntry[];
  /** An opener and a closer, per {@link AppOrmLifecycle}. */
  readonly orm?: AppOrmLifecycle;
  /**
   * The instance-resolved manifest set: core, this deployment's overlay
   * modules, and every installed module package.
   *
   * It is what the required-module set, the presence load, the error-code
   * routing and the settings reconcile are all derived from — four derivations
   * from one input, on every composition, so a caller that withdraws a module
   * changes all four in the same run and there is no list anywhere (D-100).
   */
  readonly manifests?: readonly RegisteredManifestEntry[];
}

/** What every hook is handed once the modules have registered. */
export interface ComposedAppContext {
  readonly orm: MikroORM;
  /** A fresh tenant-filtered fork per call — the seam production forks through. */
  readonly em: () => EntityManager;
  readonly container: KernelContainer;
  readonly eventBus: EventBus;
  readonly commandBus: CommandBus;
  readonly auditLogService: AuditLogService;
  readonly apiInterceptors: ApiInterceptorRegistry;
  readonly redis: Redis;
  readonly redisSubscriber: Redis;
  readonly settings: SettingsKernel;
  readonly salesChannels: SalesChannelsKernel;
  /** The manifest set this composition was built from, resolved once. */
  readonly resolvedModules: readonly RegisteredManifestEntry[];
  /** The contribution window itself — `composed.contribute({ … })`. */
  readonly composed: ComposedModules;
}

export interface ComposeAppOptions {
  /**
   * The absolute path of the directory that holds `apps/`.
   *
   * **A composition input, not a container contribution** (T114a,
   * `contracts/application-root-supplier.md` R1.1). The proof is an ordering
   * rather than a preference: the overlay entries it locates are spread into
   * the module list `composeModules` receives, so a value deciding which
   * modules exist cannot arrive through D-45's window, which opens on that
   * call's return value.
   *
   * **It is required, and that is the point.** In this repository the answer is
   * `overlay-roots.ts`' one expression and it would be easy to default to; in an
   * instance the platform came out of `node_modules` and any default it could
   * compute names a directory holding no `apps/` at all — silently, because an
   * absent declaration and an empty one are deliberately the same answer.
   */
  readonly deploymentRoot: string;
  /** What only this build knows — see {@link AppComposition}. */
  readonly composition?: AppComposition;
  /**
   * Host values **no module defaults** — a deployment flag, a resolver only a
   * composition can write. Registered before the modules do, where a value
   * comes into existence, because there is nothing to overwrite and therefore
   * no contribution window (AGENTS.md § Composition item 8).
   *
   * The platform registers its own here too: `redis`, `redisSubscriber`,
   * `eventBus`, `commandBus`, `auditLogService`, `apiInterceptors`,
   * `resolvedModuleRegistry` and the deployment dials derived from
   * `BACKEND_ROLE`. A caller's entry of the same name wins.
   */
  readonly values?: Readonly<Record<string, unknown>>;
  /**
   * The contribution window (D-45, issue #52) — the one slot where a value a
   * module defaults may be overwritten.
   *
   * It runs **after** the platform's own twenty contributions, so a deployment
   * that wants a different answer for one of them says so here.
   */
  readonly contribute?: (ctx: ComposedAppContext) => void | Promise<void>;
  /**
   * Route plugins mounted after every module's own, after the modules' root
   * plugins, and **before** the request-scope hook.
   */
  readonly plugins?: readonly ModulePlugin[];
  /**
   * Route plugins mounted **after** the request-scope hook.
   *
   * The scope sits in the middle of the chain rather than at its end, so there
   * are two sides to it and a caller needs both. The platform's own
   * sales-channel resolver is the first entry on this side, because it writes
   * the resolved channel into the open request scope.
   *
   * Both arrays are read after the contribution window closes, so a caller may
   * push into either from inside {@link contribute}, where the value a plugin
   * needs finally exists.
   */
  readonly scopedPlugins?: readonly ModulePlugin[];
  /**
   * Establish the ambient `TenantContext` for a request (Principle XI).
   *
   * Omitting it is not "no tenancy": the platform installs
   * `registerRequestScopeHook` either way and the default context is a system
   * one. There is no path through this function that leaves the hook off.
   *
   * The actor → context mapping is the caller's until
   * `specs/110-instance-repository/` T118b relocates the `request.actor`
   * augmentation: reading `request.actor` needs a `declare module 'fastify'`
   * block `auth` owns, and a platform file that named it would be the
   * D-52/D-53 reach this function exists to end.
   */
  readonly buildTenantContext?: (request: FastifyRequest) => Promise<TenantContext>;
  /**
   * The wrapping order this deployment declares for a name more than one of its
   * overlay modules decorates (feature 107, FR-040/FR-041).
   *
   * The deployment's own fact, read from its `divergence.ts` and handed over.
   * Forwarded to `composeModules` unchanged and **checked, never applied**.
   */
  readonly decorationOrder?: Readonly<Record<string, readonly string[]>> | undefined;
  /**
   * The modules this deployment declares it omits (D-101), from the same
   * declaration `decorationOrder` comes from.
   *
   * Supplied rather than read here: which deployment this process runs as is a
   * fact about the process, and the file that locates the declaration is the
   * application's (D115-3).
   */
  readonly declaredOmissions?: readonly string[];
}

export interface ComposeAppHandle {
  orm: MikroORM;
  redis: Redis;
  modules: ModulePlugin[];
  errorEnvelope: ErrorEnvelopeOptions;
  /** Feature 054 — the Command Bus, exposed so migrated module wiring can consume it. */
  commandBus: CommandBus;
  /**
   * Feature 060 — the API interceptor registry. An entry point passes it to
   * `buildServer({ apiInterceptors })`; modules receive it at registration.
   */
  apiInterceptors: ApiInterceptorRegistry;
  /**
   * Feature 080 (T042b, D-157.12 item 1) — the composed kernel container.
   *
   * Passing it is mandatory rather than convenient for anything that opens a
   * scope over this composition: `composeApp` deliberately does **not** call
   * `setRootContainer` (see the reason at the container's construction below),
   * so an `enterSystemScope` with no `container` branches off a process-wide
   * root that has nothing registered.
   */
  container: KernelContainer;
  /**
   * Feature 080 (T042b, D-157.12 item 2) — a post-registration `ModuleContext`
   * for one composed module, forwarded from `ComposedModules.contextFor`.
   */
  contextFor: ComposedModules['contextFor'];
  /**
   * The instance-resolved manifest set this composition was actually built
   * from: core, this deployment's overlay modules and every installed package.
   */
  resolvedModules: readonly RegisteredManifestEntry[];
  /** Closes the ORM + redis connections; call from a SIGTERM handler. */
  dispose: () => Promise<void>;
}

/**
 * The container reads this function makes, declared as **what it calls**.
 *
 * A composition resolves a **container name**, and a name is a string. Where the
 * owner registers that name as a `providePort` over a published shape, the read
 * names that shape — which is the one the provider is already checked against —
 * and never the provider's own class, because D-52/D-53 refuses a type reach
 * into a module from inside this package.
 *
 * These are narrow on purpose. Widening one to the module's whole service would
 * restate a declaration this function is not the author of.
 */
interface PlatformContainerReads {
  /** Owner: `_i18n`. The error envelope's translation step (D-127). */
  readonly adminI18nService: AdminI18nTranslatePort;
  /** Owner: `admin_users`. The envelope's admin-language lookup. */
  readonly adminUserReadPort: AdminUserReadPort;
  /** Owner: `sales_channels`. The code⇄id lookup's reverse direction. */
  readonly salesChannelsService: {
    list(options: Record<string, unknown>): Promise<{
      items: Array<{ id: string; code: string }>;
    }>;
  };
  /** Owner: `settings`. The boot reconcile's manifest collection (T046). */
  readonly settingsManifestCollectionPort: SettingsManifestCollectionPort;
}

/**
 * The default {@link AppComposition} — the compiled-in half empty.
 *
 * An instance ships no generated manifest index and no committed registry, so
 * its modules are its overlay modules plus the packages it installed, its
 * entities are those packages' entities, and its migrations are those packages'
 * migrations. Each is the same platform function the application's own binding
 * calls, with `core` empty, so there is no second derivation of any of them.
 */
async function defaultComposition(
  deploymentRoot: string,
  env: NodeJS.ProcessEnv,
): Promise<Required<AppComposition>> {
  const overlayRoot = activeOverlayModulesRoot(deploymentRoot, env);
  const claims = installedPackageModuleIdClaims(nodeModulesRootsFor(env));
  const overlay = overlayRoot === null ? [] : await overlayModuleEntriesUnder(overlayRoot, claims);
  const packages = await loadPackageModuleEntries(env);
  const manifests = await resolveManifestEntries({
    core: [],
    overlay: async () => [],
    packages: () => discoverPackageModuleManifests(env),
  });
  const bootstrap = createOrmBootstrap(async () => {
    const [entities, migrations] = await Promise.all([
      configuredEntitiesFrom({ coreEntities: [], env }),
      discoverConfiguredMigrations({ coreEntries: [], manifests: [] }, env),
    ]);
    return mikroOrmConfigFrom({ entities, migrations });
  });
  return {
    modules: [...overlay, ...packages],
    manifests,
    orm: { open: bootstrap.initOrm, close: bootstrap.closeOrm },
  };
}

/**
 * Every environment value below is read as `process.env['NAME']` at its own
 * site, and never through a local alias.
 *
 * That is a rule about `check:env-inputs`, not about style: its walk reconciles
 * `ENVIRONMENT_INPUTS` against the `process.env` reads it can **see**, and an
 * alias hides every read behind it. Measured on the first draft of this file,
 * which bound `const env = process.env` once: the check's site count fell from
 * 67 to 58 and `REDIS_URL` and `REVALIDATE_SECRET` were reported as
 * `unread-input` — an operator asked for two values that appeared to change
 * nothing, on the merge request that made them load-bearing for every
 * deployment at once.
 */
export async function composeApp(options: ComposeAppOptions): Promise<ComposeAppHandle> {
  const { deploymentRoot } = options;

  // Issue #218 — before anything is opened, refuse a production boot with no
  // public origin. `PUBLIC_API_BASE_URL` is what every payment-gateway callback
  // URL, public product-feed URL and newsletter confirmation link is built on,
  // and its old `http://localhost:3001` default produced a wrong-but-plausible
  // URL nothing logged and nothing refused. Every deployment entry point goes
  // through this function, so one line covers all of them — and an application's
  // `index.ts` turns a throw from here into a "this is almost always a
  // configuration problem" message plus `exit(1)`.
  assertPublicApiBaseUrlConfigured();

  // Resolved once, and only for the members the caller did not supply: the
  // default builds an ORM bootstrap and scans `node_modules`, and doing that
  // beside a caller that already handed over both would be two answers to one
  // question.
  const supplied = options.composition ?? {};
  const fallback =
    supplied.modules !== undefined && supplied.manifests !== undefined && supplied.orm !== undefined
      ? undefined
      : await defaultComposition(deploymentRoot, process.env);
  const moduleEntries = supplied.modules ?? fallback?.modules ?? [];
  const resolvedRegistry = supplied.manifests ?? fallback?.manifests ?? [];
  const ormLifecycle = supplied.orm ?? (fallback?.orm as AppOrmLifecycle);

  const orm = await ormLifecycle.open();
  // Feature 050 — the single EM-injection seam. `forkScopedEm` is a bare
  // `orm.em.fork()`: it stamps NOTHING, because the tenant filters read the
  // ambient TenantContext from AsyncLocalStorage **when the query is built**
  // (`tenancy/filters.ts`), not when the manager is forked. That is what makes
  // the EntityManager stateless with respect to tenancy, and it is the property
  // the whole request seam rests on.
  const em = (): EntityManager => forkScopedEm(orm);

  // Feature 072 — the kernel container. Modules composed through
  // `composeModules` register into it; the deployment values assembled below
  // are handed to that call and register nothing themselves.
  //
  // It is deliberately **not** installed as the process root
  // (`setRootContainer`). Doing so makes every `enterPlatformScope` branch a
  // child off this graph, and a scope is what lives in an `AsyncLocalStorage`
  // store — so every retained store starts pinning a whole composed
  // application. Phase 4 measured the cost: the suite died with `JavaScript
  // heap out of memory` at file 78 of 930 with the root installed.
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
  //   - 'worker'         → workers only (set by `worker.ts`; no HTTP listen)
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

  // Feature 090 Phase 2 — which bundle holds which error code's sentence,
  // derived from the manifests this deployment resolved rather than from a table
  // (`specs/090-module-owned-error-codes/contracts/error-code-declaration.md` §4).
  // Activation is deliberately not consulted: a code owned by a switchable
  // module is raised by other modules too, so a switched-off `carts` must not
  // cost `orders` its checkout sentence.
  //
  // Reported here rather than at the injection site because a collision is a
  // fact about the composition and an operator has to be able to read it before
  // the first request that renders wrong — and it is `warn` rather than a
  // refusal: §3.3's severity gradient reserves a refused boot for the
  // irreversible, and the blast radius of a contested code is one sentence.
  const errorTranslation = buildErrorTranslationTargets(resolvedRegistry);
  if (errorTranslation.collisions.length > 0) {
    platformLogger().warn(
      { collisions: errorTranslation.collisions.length },
      'error codes are claimed by more than one module and therefore route to none of ' +
        `them:\n${describeErrorCodeCollisions(errorTranslation.collisions)}`,
    );
  }

  // Feature 072 (D-38) — module presence is a **composition input**, so it is
  // loaded here: before the first module registers, and therefore before any
  // boot hook, plugin body or worker registration asks for it. It used to be
  // warmed inside `_lifecycle`'s plugin body, which runs in `buildServer` —
  // after all of them — and the platform stopped booting the moment a boot hook
  // resolved a gated port, because the cache still answered "not installed" for
  // everything.
  //
  // Awaited and fatal, and that costs nothing new: opening the ORM above
  // already makes a reachable PostgreSQL a boot precondition. Arming the Redis
  // pub/sub side is separate (`registryCache.watch()`, from `_lifecycle`'s
  // plugin) and must never fail a boot — a lost notification channel means
  // stale, not off.
  await enterSystemScope(
    'boot: load module presence',
    // The **entries**, not their manifests: `loadModulePresence` narrows the
    // first-boot insert to what this build ships (D-157.6(b)), and `filePath` is
    // what says which entry that is.
    async () =>
      loadModulePresence({
        em,
        entries: resolvedRegistry,
        declaredOmissions: options.declaredOmissions ?? [],
      }),
    { entryPoint: 'boot' },
  );

  const eventBus = new EventBus();

  // Feature 054 (Principle XIII) — the Command Bus: the single, guaranteed audit
  // writer for sensitive writes. It forks the scoped EM, runs the write + one
  // audit insert co-transactionally, and dispatches the domain event on commit.
  const commandBus = new CommandBus(orm, auditLogService, eventBus);

  // Feature 060 — API interceptor registry. Modules register pre/post
  // interceptors against endpoints owned by other modules; execution is
  // lifecycle-gated per interceptor via the enabled-set cache predicate.
  const apiInterceptors = new ApiInterceptorRegistry({
    isModuleEnabled: (moduleId) => registryCache.isEnabled(moduleId),
  });

  // Feature 072 — the **host values** a composition owns outright. No module
  // registers a default for any of them, so they have no contribution window
  // (D-45's one-slot rule is about overwriting a module's default) and are
  // registered where the value comes into existence rather than after
  // `composeModules`. Everything a module does default is contributed below,
  // between that call and `runBootHooks()`.
  registerValues(container, {
    redis,
    // Feature 072 (T125) — the interceptor registry, so `_lifecycle` can serve
    // the read-only diagnostics screen over it.
    apiInterceptors,
    // A module's `ctx.onBoot` schedule reconcile resolves these; nothing else
    // in this composition has an opinion about them.
    pimErgonodeRunWorkers: runWorkers,
    pimAkeneoRunWorkers: runWorkers,
    pimPimcoreRunWorkers: runWorkers,
    pimUnopimRunWorkers: runWorkers,
    productFeedsRunWorkers: runWorkers,
    pimAkeneoPublicBaseUrl: resolvePublicApiBaseUrl(),
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
    // modules plus every installed package. `admin_roles` builds the permission
    // catalogue from it and cannot see it itself: which modules a deployment
    // ships is a composition input, not something a module decides.
    resolvedModuleRegistry: resolvedRegistry,
    auditLogService,
    storefrontBaseUrl: process.env['STOREFRONT_BASE_URL'] ?? 'http://localhost:3000',
    // No verification-token probe outside a harness.
    organizationsExposeTestProbe: false,
    ...options.values,
  });

  /**
   * The container reads this function makes, against
   * {@link PlatformContainerReads}.
   *
   * A function rather than a captured object, for the reason every accessor in
   * a composition root is one: a gated name resolves per call, so a switched-off
   * owner answers at the call site instead of through a handle this composition
   * is holding.
   */
  const reads = (): PlatformContainerReads => container.cradle as never;

  // Where this call sits no longer decides whether a cache is fresh, and that
  // is the point of D-93. Channel *resolution* is kernel infrastructure for the
  // reason T110 gave: every channel-scoped read depends on it (Principle XII),
  // so it must keep working whether or not an operator wants the administration
  // screens. The module owns the admin CRUD service and its routes.
  const salesChannels = composeSalesChannelsKernel({
    emFactory: em,
    eventBus,
    redis,
    auditLogService,
  });
  // Feature 072 (T118) — the universal settings *reader* is kernel
  // infrastructure: almost every module calls `SettingsService.get`, so it
  // cannot be gated on whether an operator wants the settings screens.
  const settings = composeSettingsKernel({
    emFactory: em,
    redis,
    ...(process.env['SETTINGS_SECRET_ENCRYPTION_KEY']
      ? { secretEncryptionKey: process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] }
      : {}),
  });

  // Secret settings (e.g. prompt_actions API keys) are AES-256-GCM encrypted at
  // rest with SETTINGS_SECRET_ENCRYPTION_KEY. The key is read from the
  // environment once at boot, so a value added to `.env` only takes effect
  // after a restart. Warn loudly here so a missing key is obvious instead of
  // surfacing only as a 500 when an operator tries to save a secret.
  if (!process.env['SETTINGS_SECRET_ENCRYPTION_KEY']) {
    // Boot-time logging path; the Fastify logger is not yet available here.
    console.warn(
      '[settings] SETTINGS_SECRET_ENCRYPTION_KEY is not set — secret settings ' +
        '(e.g. prompt_actions API keys) cannot be saved. Set a base64 32-byte key ' +
        '(openssl rand -base64 32) in the deployment environment and restart the backend.',
    );
  }

  // Feature 072 — the module list, composed in one pass (D-45). Registration
  // resolves nothing, so this call has no opinion about the order the caller
  // assembled; the boot hooks it collects run once, at the bottom of this
  // function, after every contribution below.
  const composedModules = composeModules(moduleEntries, {
    container,
    eventBus,
    // Issue #269 — composition runs before `buildServer`, so there is no
    // `app.log` yet. This is late-bound rather than a snapshot: `buildServer`
    // attaches the application's own pino instance the moment it exists.
    log: platformLogger(),
    interceptorRegistry: apiInterceptors,
    ownership: registrationOwnership,
    // Issue #258 — the modules this deployment is required to have, derived
    // from the manifest set it resolved above rather than written down (D-100).
    requiredModules: requiredModulesFrom(resolvedRegistry.map((entry) => entry.manifest)),
    // Feature 107 (FR-040/FR-041) — **checked, never applied.** The composer
    // emits in its own order and drains decorations once; this asserts that the
    // resulting order was the intended one and refuses when the two disagree.
    decorationOrder: options.decorationOrder,
  });

  const composedContext: ComposedAppContext = {
    orm,
    em,
    container,
    eventBus,
    commandBus,
    auditLogService,
    apiInterceptors,
    redis,
    redisSubscriber,
    settings,
    salesChannels,
    resolvedModules: resolvedRegistry,
    composed: composedModules,
  };

  // --- the platform's own contributions ------------------------------------
  //
  // The twenty of `composition.ts`' sixty-one whose value expression names no
  // module: a sub-kernel's object, a host value or an environment read. They
  // are contributed here rather than by a caller because a deployment that had
  // to write them would be writing the platform's own wiring — R1.4 — and an
  // instance that forgot one would compose a platform missing a name eleven
  // modules resolve.
  //
  // They go **before** `options.contribute`, so a deployment that genuinely
  // wants a different answer for one of them can still say so.

  // Feature 072 (T110) — the channel-resolution names. The kernel itself is
  // composed above `composeModules`, for the subscriber ordering; what belongs
  // here is the registration, in the one contribution slot.
  composedModules.contribute({
    salesChannelsCache: salesChannels.cache,
    // The kernel-reserved membership port. `payment_methods` and
    // `delivery_methods` resolve it to auto-bind a new method to the system
    // default channel; both read it when their routes register.
    salesChannelMembershipPort: salesChannels.membershipService,
    // The channel resolver itself. `inventory` has resolved this name since
    // T129 and neither root registered it, so the channel-scoped storefront
    // stock read threw `AwilixResolutionError` on its first call.
    salesChannelResolutionPort: salesChannels.resolver,
    /**
     * The channel a **channel-scoped** settings read resolves against outside a
     * request (worker, boot hook, CLI): the deployment's system-default sales
     * channel.
     *
     * D-48 removed the `?? null` — the resolver cannot fail to find a default,
     * so this cannot answer "none". The return type stays `string | null`
     * because the *seam* still admits one: a composition may register a
     * resolver of its own that has no channel to offer.
     */
    settingsChannelResolver: async (): Promise<string | null> =>
      (await salesChannels.resolver.getSystemDefault()).id,
    // Feature 072 (wave 2) — the sales-channel code⇄id lookup
    // `google_analytics` resolves. `idByCode` is the kernel resolver's;
    // `codeById` reads the module's own gated `salesChannelsService` port by
    // container name, against the one method it calls.
    salesChannelCodeIdPort: {
      idByCode: async (code: string) => (await salesChannels.resolver.getByCode(code))?.id ?? null,
      codeById: async (id: string) => {
        const { items } = await reads().salesChannelsService.list({});
        return items.find((c) => c.id === id)?.code ?? null;
      },
    },
    // Feature 042 / D-96 — the default channel an MFA challenge is scoped to.
    mfaDefaultChannelIdResolver: async () =>
      (await salesChannels.resolver.getSystemDefault()).id,
  });

  // Feature 072 (T118) — the settings names. The kernel itself is composed
  // above `composeModules`, for the subscriber ordering; what belongs here is
  // the registration, in the one contribution slot.
  composedModules.contribute({
    // The kernel's `SettingsService` already implements the read port.
    settingsReadPort: settings.settingsService,
    // The same cache, seen from the writing side (issue #45). The `settings`
    // module owns the one write seam, so it is the one place that can drop the
    // cache *as part of* the write instead of announcing the write and hoping a
    // subscriber gets there first.
    settingsCache: settings.cache,
    settingsSecretEncryptionKey: process.env['SETTINGS_SECRET_ENCRYPTION_KEY'],
    // Feature 073 — the effective-state reader. Registered here rather than
    // imported inside the module so the dependency direction stays declared in
    // a composition: `_lifecycle` reads this module's `Setting` rows, and this
    // module reads nothing of `_lifecycle`'s.
    settingsModulePresence: {
      presenceOf: (moduleId: string) => effectiveState.presenceOf(moduleId),
      activationControlOwner: (code: string) => effectiveState.activationControlOwner(code),
    },
    // US2 — the delete-integrity guard reaches settings only through this port
    // (Principle I): `SettingsService.listReferencesToConfiguration`.
    credentialsSettingsPort: settings.settingsService,
  });

  composedModules.contribute({
    // Principle X — whether this process runs each module's queue consumers.
    // Only the *flag* was ever a deployment decision; the workers themselves
    // are their modules' own (T143a).
    webhooksRunWorkers: runWorkers,
    pwaRunWorkers: runWorkers,
    catalogRunBulkOperationWorker: runWorkers,
    searchRunWorkers: runWorkers,
    // Feature 072 (T127) — whether a wall-clock status sweeper runs.
    priceListsEnableStatusSweeper: true,
    // Feature 072 (wave 2) — the connection a module may build a BullMQ
    // producer queue on. Deliberately a different name from `redis`: "no queue
    // in this composition" is a statement a composition should be able to make
    // rather than something inferred from a missing option.
    moduleQueueRedis: redis,
    // Blog ships no storefront ports today — the factory defaulted this to `{}`
    // and no composition ever passed one.
    blogStorefrontDeps: undefined,
    // Issue #225 — the reading and its generation, contributed as one value.
    // The palette memoises what the reading produced, so a composition that
    // handed over the reading alone would hand over a cache nothing can drop.
    modulePresenceProbe: {
      // Issue #187 — the platform axis, which the palette used to read by
      // joining `module_registrations` itself. `?? false` where the operator
      // axis defaults `true`, and the asymmetry is the tri-state rather than an
      // oversight.
      isPlatformAvailable: (moduleId: string): boolean =>
        effectiveState.presence(moduleId)?.platformAvailable ?? false,
      isActivated: (moduleId: string): boolean =>
        effectiveState.presence(moduleId)?.operatorActivated ?? true,
      version: (): number => effectiveState.presenceVersion(),
    },
    // Feature 072 (T125) — how a committed activation flip propagates: the
    // writing process refreshes itself rather than waiting on its own pub/sub
    // round trip, so the very next request it serves sees the new state.
    lifecycleActivationPropagation: {
      commandBus,
      propagation: {
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

  // The caller's own, in the same window and after the platform's.
  await options.contribute?.(composedContext);

  const buildTenantContext =
    options.buildTenantContext ??
    (async (request: FastifyRequest): Promise<TenantContext> =>
      systemTenantContext(`${request.method} ${request.url}`));

  // Assembled here rather than above the contribution window, and that is a
  // guarantee rather than a placement: a caller adds to `options.plugins` or
  // `options.scopedPlugins` from inside `contribute`, where the value a plugin
  // needs finally exists.
  const modules: ModulePlugin[] = [
    // Feature 072 — every module's route contribution, in the composer's order.
    //
    // They sit ahead of the root plugins, and that is not an ordering claim:
    // `buildServer` calls each of these with the root instance, so an
    // `onRequest` hook any of them adds is a root hook, and Fastify assembles a
    // route's hook chain when the application is readied rather than when the
    // route is registered (D-45).
    ...composedModules.sink.plugins,
    // Feature 072 (T078) — the auth plugin is `auth`'s own contribution,
    // collected by `ctx.rootPlugin` because it decorates `request.actor` for
    // the whole application rather than contributing routes.
    async (app) => {
      for (const plugin of composedModules.sink.rootPlugins) await plugin(app);
    },
    ...(options.plugins ?? []),
    // Feature 050 / 072 (T027) — establish the ambient TenantContext for every
    // request from the already-authenticated actor (never from request
    // inputs), and open the request's resolution scope. One hook factory,
    // shared with the test kit, so the two cannot drift.
    async (app) => {
      await registerRequestScopeHook(app, { buildTenantContext });
    },
    // Feature 005 — the sales-channel resolver middleware writes the resolved
    // channel into the open request scope, so it mounts after the hook.
    salesChannels.plugin,
    ...(options.scopedPlugins ?? []),
  ];

  // Feature 004 / T024 — boot-time manifest reconciliation. Walks every
  // module's settings manifest and inserts any missing groups/settings
  // idempotently before the HTTP layer starts serving requests. NEVER deletes
  // (R-1); destructive uninstall is CLI-only.
  //
  // Feature 080 (T046) — the population is `deploymentShippedEntries`, the same
  // core-plus-overlay split D-157.6(b) ruled for the first-boot presence
  // insert. A **package** is excluded for a reason of its own rather than for
  // symmetry: since D-157.6(b) `install` is its only author, and reconciling a
  // stranger's manifest here would let a `SettingCodeConflict` in something an
  // operator merely `pnpm add`ed abort this boot.
  const settingsManifests: ModuleSettingsManifest[] = reads()
    .settingsManifestCollectionPort.collect(deploymentShippedEntries(resolvedRegistry));
  const reconciler = new ManifestReconciler(em());
  const reconciliation = await enterSystemScope(
    'boot: reconcile module settings manifests',
    () => reconciler.apply(settingsManifests),
    { entryPoint: 'boot' },
  );
  for (const perModule of reconciliation.perModule) {
    if (perModule.orphanSettings.length > 0 || perModule.orphanGroups.length > 0) {
      // Boot-time logging path; the Fastify logger is not yet available here.
      console.warn(
        `[settings] orphan rows for module "${perModule.moduleCode}": ` +
          `${perModule.orphanSettings.length} settings, ${perModule.orphanGroups.length} groups`,
      );
    }
    eventBus.emit('settings.module_reconciled', {
      eventId: `settings.module_reconciled:${perModule.moduleCode}:${Date.now()}`,
      occurredAt: new Date().toISOString(),
      moduleCode: perModule.moduleCode,
      addedCount: perModule.addedGroups + perModule.addedSettings,
      updatedCount: perModule.updatedGroups + perModule.updatedSettings,
      orphanCount: perModule.orphanGroups.length + perModule.orphanSettings.length,
    } as never);
  }

  // The explicit boot phase (FR-021), run **once**, after every registration
  // and every contribution above and before an entry point calls `buildServer`
  // (D-45). That is what makes the rule statable in one sentence: a boot hook
  // may resolve anything, and a contribution goes between `composeModules` and
  // this line.
  //
  // Why one phase rather than several: a contribution registered *after* a boot
  // hook has already run is invisible to that hook, which reads the owning
  // module's default instead and reports nothing — no error, no warning, a
  // value that is simply the wrong one.
  //
  // Issue #52 — and this line is what closes the slot: every `contribute(…)`
  // below it throws `ContributionWindowClosedError` naming the rule, rather
  // than landing somewhere no hook will read.
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
    // The assembly is one function's, and what a composition supplies is the
    // three things only a composition holds: its own resolved routing table and
    // the two gated ports the envelope's callbacks read. The twenty lines that
    // used to stand in each root stood character-for-character in both, which
    // is the drift `harness-parity.test.ts` exists for and which issue #234
    // already paid for once.
    errorEnvelope: composeErrorEnvelopeOptions({
      errorTranslationTargets: errorTranslation.targets,
      adminUserReadPort: () => reads().adminUserReadPort,
      translate: () => reads().adminI18nService,
    }),
    dispose: async () => {
      // Feature 062 — drain the webhook delivery pipeline before dropping the
      // Redis connections (graceful shutdown). Every part of that is the
      // container's job since T143a: `ctx.subscribe` unsubscribes with the
      // module, the queue registration carries its own disposer, and the
      // delivery worker is `webhooks`' own. Disposing the container runs those
      // disposers — for every module, not only one — and it runs *before* the
      // Redis sockets go, which is the ordering the drain needs.
      await container.dispose();
      redis.disconnect();
      redisSubscriber.disconnect();
      await ormLifecycle.close();
    },
  };
}
