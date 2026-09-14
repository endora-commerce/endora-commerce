/**
 * `composeTestServer` — the host-shaped half of `setupBackendServer`, lifted
 * (feature 109, T023).
 *
 * ## What "host-shaped" means, precisely
 *
 * Everything in the harness's composition that is true of **any** Endora
 * platform and mentions no module: open the ORM, build the container, register
 * the ORM-derived names, construct the audit writer, the event bus, the command
 * bus and the two Redis clients, prime the registry cache from the manifests,
 * compose the settings and sales-channel kernels, run `composeModules` once,
 * open the contribution window once, install the request-scope hook, run the
 * boot phase once, build the server, and take all of it down again.
 *
 * Everything else — which modules, which schema, which fixtures, which actor a
 * request carries — is the caller's, and reaches this function either as
 * {@link PlatformComposition} or as one of the hooks below. The hooks are at
 * the four points the boot order makes load-bearing (D-45) and nowhere else:
 * before the modules register, in the contribution window, before the boot
 * phase, and after the server is ready. A fifth hook would be a fifth place for
 * two composition roots to drift.
 *
 * ## The one ordering rule, and why it is a shape rather than a comment
 *
 * `composeModules` runs once and `runBootHooks` runs once, immediately before
 * the app is built, so a boot hook may resolve anything. A contribution over a
 * name a module defaults goes in the single slot between them — earlier and the
 * module's own registration overwrites it, later and a boot hook has already
 * read the default. That slot is {@link ComposeTestServerOptions.contribute},
 * and both edges are enforced by the platform rather than remembered: the early
 * one because `ComposedModules` does not exist until every module has
 * registered, the late one because `contribute` throws once `runBootHooks` has
 * started.
 *
 * ## What it refuses, and with whose words
 *
 * A composition whose `modules` lacks a module declaring
 * `activation.nonDeactivatable` is refused by `composeModules`, before the
 * first module registers, with `RequiredModuleAbsentError` — naming the module,
 * the sentence its own manifest gives and the remedy. This function adds no
 * second check and catches nothing on that path (R2.4): a stranger composing an
 * incomplete set has to get the platform's answer, because the kit's would be a
 * paraphrase that goes stale.
 *
 * What it *does* do on that path is give back the two connections and the ORM
 * it had already opened. That is not a swallow — the refusal is re-thrown
 * unchanged, and unconditionally — it is the difference between a test that
 * reports one refusal and a run that reports it once and then dies of a
 * connection leak.
 */

import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { Redis } from 'ioredis';

import {
  ApiInterceptorRegistry,
  AuditLogService,
  activationDeclarationsFrom,
  buildServer,
  composeModules,
  composeSalesChannelsKernel,
  composeSettingsKernel,
  createRegistrationOwnership,
  createRootContainer,
  forkScopedEm,
  healthRoutePlugin,
  platformLogger,
  registerOrm,
  registerRequestScopeHook,
  registerValues,
  registryCache,
  requiredModulesFrom,
  systemTenantContext,
  type KernelContainer,
  type ModulePlugin,
  type SalesChannelsKernel,
  type SettingsKernel,
} from '@endora-commerce/platform/composition';
import { CommandBus } from '@endora-commerce/platform/commands';
import { EventBus } from '@endora-commerce/platform/events';
import type { TenantContext } from '@endora-commerce/platform/tenancy';

import { mergeTestSupportRegistrations } from '../support/index.js';
import type { PlatformComposition } from './composition.js';

/**
 * `buildServer`'s own options, named through its signature.
 *
 * `BuildServerOptions` is on no barrel and this feature widens none (R3.1), so
 * the type is taken from the function that *is* published rather than by
 * publishing a second symbol to spell it. It stays correct by construction: a
 * field added to `buildServer` is a field here in the same compile.
 */
type BuildServerOptions = Parameters<typeof buildServer>[0];

/**
 * `ComposeModules`' return, named through its signature, for the same reason.
 */
type ComposedModules = ReturnType<typeof composeModules>;

/**
 * A subscriber-shaped object that subscribes to nothing.
 *
 * Every composition *asks* for a subscriber, because a module that arms an
 * invalidation channel from `onBoot` resolves one. Production hands it the real
 * client; a test gets this unless it opted into pub/sub, because a live
 * subscription per composition is a leak measured in hundreds of megabytes
 * across a suite — and because a module that never receives an invalidation
 * still behaves correctly, it just falls back to the cache's TTL.
 */
function inertRedisSubscriber(): Redis {
  const inert = {
    subscribe: async () => 0,
    on: () => inert,
    removeAllListeners: () => inert,
    unsubscribe: async () => 0,
    disconnect: () => undefined,
  };
  return inert as unknown as Redis;
}

/** What every hook is handed before the modules have registered. */
export interface TestPlatformContext {
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
}

/** What every hook is handed once the modules have registered. */
export interface ComposedPlatformContext extends TestPlatformContext {
  readonly composed: ComposedModules;
}

export interface ComposeTestServerOptions {
  /** The four things only the caller knows. */
  readonly composition: PlatformComposition;
  /**
   * Host values **no module defaults** — a deployment flag, a base URL, a
   * substitute transport. Registered before the modules do, where a value comes
   * into existence, because there is nothing to overwrite and therefore no
   * contribution window (AGENTS.md § Composition item 8).
   *
   * The kit registers the platform's own here too: `redis`, `redisSubscriber`,
   * `eventBus`, `commandBus`, `auditLogService`, `apiInterceptors` and
   * `resolvedModuleRegistry`. A caller's entry of the same name wins, and that
   * is deliberate — the alternative is a caller with no way to substitute a
   * connection.
   */
  readonly values?: Readonly<Record<string, unknown>>;
  /**
   * Truncate, seed, reconcile — whatever this caller's schema needs before the
   * modules register.
   *
   * It runs after the ORM is open and the caches are the caller's to drop, and
   * before `composeModules`, because a module's registration may not observe a
   * half-seeded database.
   */
  readonly prepareDatabase?: (ctx: TestPlatformContext) => Promise<void>;
  /**
   * The contribution window (D-45, issue #52) — the one slot where a value a
   * module defaults may be overwritten.
   */
  readonly contribute?: (ctx: ComposedPlatformContext) => void | Promise<void>;
  /**
   * Route plugins mounted after every module's own, after the modules' root
   * plugins, and **before** the request-scope hook.
   *
   * This is where a harness's synthetic authentication goes: it registers after
   * the platform's own auth plugin so its `onRequest` hook runs second and the
   * synthetic actor wins, through the same decorator — and before the scope
   * hook, which builds its {@link TenantContext} out of the actor that hook
   * resolved.
   */
  readonly plugins?: readonly ModulePlugin[];
  /**
   * Route plugins mounted **after** the request-scope hook.
   *
   * The scope sits in the middle of the chain rather than at its end, so there
   * are two sides to it and a caller needs both. Production's own root has the
   * same shape: `authModulePlugin`, `tenantContextModulePlugin`, then
   * `salesChannels.plugin` — and the sales-channel resolver is exactly why the
   * second slot exists, because it writes the resolved channel into the open
   * request scope and refuses when there is none.
   *
   * Both arrays are read after the contribution window closes, so a caller may
   * push into either from inside `contribute`, where the value a plugin needs
   * finally exists.
   */
  readonly scopedPlugins?: readonly ModulePlugin[];
  /**
   * Establish the ambient `TenantContext` for a request (Principle XI).
   *
   * Omitting it is not "no tenancy": the kit installs the platform's own
   * `registerRequestScopeHook` either way, and the default context is a system
   * one. There is no path through this function that leaves the hook off,
   * because a server composed without it is one under which every tenant-scope
   * test passes for the wrong reason.
   */
  readonly buildTenantContext?: (request: FastifyRequest) => Promise<TenantContext>;
  /**
   * Runs after every contribution and **before** the boot phase — a manifest
   * reconcile, a settings write a boot hook will read.
   */
  readonly beforeBoot?: (ctx: ComposedPlatformContext) => Promise<void>;
  /** Runs after `app.ready()`, with the composed platform and the app. */
  readonly afterReady?: (ctx: ComposedPlatformContext, app: FastifyInstance) => Promise<void>;
  /**
   * Whatever this caller wants on `buildServer` — the error envelope, the
   * OpenAPI metadata, a rate-limit ceiling.
   *
   * `modules` and `apiInterceptors` are the kit's and are ignored here: the
   * first is assembled from the composition plus {@link plugins} plus the
   * request-scope hook, in that order, and the second is the registry every
   * module was handed at registration.
   */
  readonly server?: Omit<Partial<BuildServerOptions>, 'modules' | 'apiInterceptors'>;
  /** Defaults to `REDIS_URL`, or `redis://localhost:6379`. */
  readonly redisUrl?: string;
  /**
   * Register the **real** subscriber client rather than an inert one.
   *
   * Off by default, because one armed subscription per composition is the leak
   * this opt-in was measured into existence to stop. A test that exercises the
   * cross-process invalidation path asks for it.
   */
  readonly exercisePubSub?: boolean;
  /**
   * The wrapping order this instance declares for a name more than one module
   * decorates (feature 107, FR-040/FR-041).
   *
   * A caller's fact and not the kit's: it is read from the deployment's own
   * `divergence.ts` in this repository, and from whatever an instance keeps it
   * in elsewhere. It is forwarded to `composeModules` unchanged and **checked,
   * never applied** — the composer emits in its own topological order and
   * drains decorations once; this declaration asserts that the resulting order
   * was the intended one and `AmbiguousDecorationError` names it when the two
   * disagree.
   *
   * It is an option rather than a fifth `PlatformComposition` member because
   * `PlatformComposition`'s four members are the things a composition cannot be
   * built without (R2.1); an instance that declares no ambiguity resolution
   * composes perfectly well, and every test in this repository's own suite
   * passes an empty one.
   */
  readonly decorationOrder?: Readonly<Record<string, readonly string[]>> | undefined;
  /**
   * Which module ids presence reports as enabled.
   *
   * Defaults to every module the composition's manifests declare, which is what
   * a test wants: production loads presence from `module_registrations`, and a
   * harness that never boots the orchestrator would otherwise 503 every gated
   * route. An off-state test passes a narrower set.
   */
  readonly enabledModuleIds?: readonly string[];
}

/**
 * A composed platform, and everything the kit itself owns in it.
 *
 * **It names no module**, which is the property Phase 2 is about: the
 * application's own handle carries 29 module-specific fields today, and every
 * one of them is a container resolution its readers can make for themselves.
 * `container.cradle` is how a caller reaches a module's service from here.
 */
export interface TestServerHandle {
  readonly app: FastifyInstance;
  readonly orm: MikroORM;
  readonly em: () => EntityManager;
  readonly container: KernelContainer;
  readonly eventBus: EventBus;
  readonly commandBus: CommandBus;
  readonly auditLogService: AuditLogService;
  readonly apiInterceptors: ApiInterceptorRegistry;
  readonly redis: Redis;
  readonly redisSubscriber: Redis;
  /** Whether the real subscriber client was registered — `teardownTestServer` needs it. */
  readonly pubSubArmed: boolean;
  readonly settings: SettingsKernel;
  readonly salesChannels: SalesChannelsKernel;
  readonly composed: ComposedModules;
  /** The composition's own closer, kept so teardown needs no second reference. */
  readonly closeOrm: () => Promise<void>;
}

export async function composeTestServer(
  options: ComposeTestServerOptions,
): Promise<TestServerHandle> {
  const { composition } = options;
  const manifests = composition.manifests.map((entry) => entry.manifest);

  const orm = await composition.orm.open();
  // Mirror the production seam: forks stamp the tenant filter from the ambient
  // `TenantContext`, which the request-scope hook below establishes.
  const em = (): EntityManager => forkScopedEm(orm);

  const redisUrl = options.redisUrl ?? process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  // ioredis puts a subscribed client into a mode where it will not accept
  // ordinary commands, so production keeps subscriptions on a second
  // connection. A harness with one client cannot exercise that path at all, and
  // the pub/sub channel is the platform's only cross-process invalidation
  // mechanism — the EventBus is in-process and the caches converge by TTL.
  //
  // **Opened only when it is armed** (issue #199). It used to be opened on
  // every composition while reaching `teardownTestServer` only through
  // `pubSubArmed`, so an unarmed composition — which is nearly every
  // composition in the suite — left a connected ioredis client behind that
  // nothing ever closed. Measured over twelve compose/teardown cycles in one
  // process: `process.getActiveResourcesInfo()` reported one more
  // `TCPSocketWrap` after each, twelve in all, and none after this change.
  // (That call is not the general instrument — it excludes an `unref`ed timer,
  // which is how the companion leak stayed invisible — but a socket is not
  // `unref`ed and it does show one.)
  //
  // An open socket is a libuv handle and therefore a GC root. That is why it is
  // worth repairing, and it is also the honest limit of the claim: measured on
  // a full `test:backend` shard, this one is **not** where the heap went —
  // `ksef`'s undisposed reconcile sweep was, and a run with that repaired and
  // this left alone reads the same live set to 0.8 MB. What this costs is one
  // ioredis client and one connection per composition, which a developer's
  // long-lived local Redis notices long before the heap does.
  // `heap-ceiling.test.ts` now refuses a `TCPWRAP` that survives a cycle.
  //
  // Not opening it is the repair rather than closing it, because a composition
  // that never subscribes has no use for the connection: a resource that is
  // never created cannot be left behind by any path, including the ones that
  // throw before they reach a disconnect.
  const pubSubArmed = options.exercisePubSub === true;
  const realSubscriber = pubSubArmed
    ? new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false })
    : undefined;
  const redisSubscriber = realSubscriber ?? inertRedisSubscriber();

  // Everything from here is disposable, and a failure between here and the
  // handle has to give it back. The re-throw is unconditional: this catch
  // releases resources and decides nothing.
  const release = async (): Promise<void> => {
    redis.disconnect();
    realSubscriber?.disconnect();
    await composition.orm.close();
  };

  try {
    const container = createRootContainer();
    registerOrm(container, orm);
    const registrationOwnership = createRegistrationOwnership();

    const apiInterceptors = new ApiInterceptorRegistry({
      isModuleEnabled: (moduleId) => registryCache.isEnabled(moduleId),
    });
    const auditLogService = new AuditLogService(em);
    const eventBus = new EventBus();
    const commandBus = new CommandBus(orm, auditLogService, eventBus);

    const salesChannels = composeSalesChannelsKernel({
      emFactory: em,
      eventBus,
      redis,
      auditLogService,
    });
    const settings = composeSettingsKernel({
      emFactory: em,
      redis,
      ...(process.env['SETTINGS_SECRET_ENCRYPTION_KEY']
        ? { secretEncryptionKey: process.env['SETTINGS_SECRET_ENCRYPTION_KEY'] }
        : {}),
    });

    const platform: TestPlatformContext = {
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
    };

    await options.prepareDatabase?.(platform);

    // Presence is seeded **before** the modules compose, not after: the enabled
    // set is a precondition for every gated resolution, and a converted
    // module's port is resolved as soon as something asks for it. While no
    // module provided a port the late seeding was invisible; the first one that
    // did turned it into `Module 'auth' is currently disabled` on a platform
    // where nothing was disabled.
    registryCache.setActivationDeclarations(activationDeclarationsFrom(manifests));
    registryCache.__setEnabledForTesting([
      ...(options.enabledModuleIds ?? manifests.map((manifest) => manifest.id)),
    ]);

    // The host values this root owns outright. No module registers a default
    // for any of them, so they have no contribution window and are registered
    // where the value comes into existence.
    registerValues(container, {
      redis,
      redisSubscriber,
      eventBus,
      commandBus,
      auditLogService,
      apiInterceptors,
      resolvedModuleRegistry: composition.manifests,
      ...options.values,
    });

    const composed = composeModules(composition.modules, {
      container,
      eventBus,
      log: platformLogger(),
      interceptorRegistry: apiInterceptors,
      ownership: registrationOwnership,
      // Issue #258 — derived from the same manifest set presence was seeded
      // from, so a caller that withdraws a required module meets the refusal
      // production would meet, at the point production meets it.
      requiredModules: requiredModulesFrom(manifests),
      // Feature 107 — the caller's declaration, forwarded unchanged. A root
      // that resolves an ambiguity in production and not in its tests composes
      // a different platform on the one axis a deployment can change.
      decorationOrder: options.decorationOrder,
    });

    const composedContext: ComposedPlatformContext = { ...platform, composed };

    const buildTenantContext =
      options.buildTenantContext ??
      (async (request: FastifyRequest): Promise<TenantContext> =>
        systemTenantContext(`test-kit:${request.method} ${request.url}`));


    // The module test-support substitutions, then the caller's own: a test that
    // wants a different stub than its module's default says so at its own call
    // site, which is where the coupling is visible.
    const supportRegistrations = mergeTestSupportRegistrations(composition.testSupport ?? []);
    if (Object.keys(supportRegistrations).length > 0) composed.contribute(supportRegistrations);
    await options.contribute?.(composedContext);
    await options.beforeBoot?.(composedContext);

    // Assembled here rather than above the contribution window, and that is a
    // guarantee rather than a placement: a caller adds to `options.plugins` or
    // `options.scopedPlugins` from inside `contribute`, where the value a plugin
    // needs finally exists. The reference application's harness pushes the
    // sales-channel plugin and a test's `extraModules` exactly there.
    const modules: ModulePlugin[] = [
      // D-229 — the platform's liveness and readiness probe, in the position
      // `composeApp` keeps it in. Not a module any more, and not a copy: the
      // factory is the platform's, so the route this harness serves is the one
      // production serves. `health_checks` existed in production and nowhere
      // else for years because this root and that one wired it separately.
      healthRoutePlugin({ orm, redis }),
      // Every module's route contribution, in the composer's order, ahead of
      // the root plugins for the same reason production keeps them there.
      ...composed.sink.plugins,
      async (app) => {
        for (const plugin of composed.sink.rootPlugins) await plugin(app);
      },
      ...(options.plugins ?? []),
      async (app) => {
        // Principle XI. The same hook factory the production composition root
        // uses — two hand-written copies is how the request seam gets a leak
        // that no test can see, and a composition without it is one under which
        // every tenant-scope assertion passes for the wrong reason.
        await registerRequestScopeHook(app, { buildTenantContext });
      },
      ...(options.scopedPlugins ?? []),
    ];

    // The explicit boot phase, run **once**, after every registration and every
    // contribution and immediately before the app is built — exactly where a
    // production composition root runs it (D-45). A boot hook may therefore
    // resolve anything. It is also what closes the contribution window.
    await composed.runBootHooks();

    const app = await buildServer({
      sessionCookieSecret: 'test-secret-do-not-use-in-production',
      openApi: { title: 'Endora Commerce API (test)', version: 'test', serverUrl: 'http://localhost' },
      disableRateLimit: true,
      ...options.server,
      modules,
      apiInterceptors,
    });
    await app.ready();
    await options.afterReady?.(composedContext, app);

    return {
      app,
      orm,
      em,
      container,
      eventBus,
      commandBus,
      auditLogService,
      apiInterceptors,
      redis,
      redisSubscriber,
      pubSubArmed,
      settings,
      salesChannels,
      composed,
      closeOrm: () => composition.orm.close(),
    };
  } catch (error) {
    await release();
    throw error;
  }
}

/**
 * Take the composed platform down.
 *
 * Every step is here rather than in a caller's own teardown for the reason
 * `check:harness-teardown` refuses a hand-written one: a copy of this sequence
 * is frozen at the moment it was copied, so it cannot learn about the container
 * or the second Redis client, and both leak for the length of the run.
 */
export async function teardownTestServer(handle: TestServerHandle): Promise<void> {
  await handle.app.close();
  // Runs every registration's disposer and drops the resolution cache, so a
  // file's composed services do not outlive its server.
  await handle.container.dispose();
  handle.redis.disconnect();
  // Unsubscribe and drop listeners **before** disconnecting. A subscribed
  // client that is merely disconnected keeps its subscription set, and ioredis
  // re-establishes it on any reconnect.
  handle.redisSubscriber.removeAllListeners('message');
  // Only when something actually subscribed: `unsubscribe()` on a client that
  // never entered subscriber mode rejects asynchronously from ioredis's socket
  // close handler — a rejection no `try` around this call can catch, which
  // surfaces as an unhandled rejection failing otherwise-green runs.
  if (handle.pubSubArmed) {
    try {
      await handle.redisSubscriber.unsubscribe();
    } catch {
      // Already closed — nothing left to unsubscribe from.
    }
  }
  handle.redisSubscriber.disconnect();
  await handle.closeOrm();
}
