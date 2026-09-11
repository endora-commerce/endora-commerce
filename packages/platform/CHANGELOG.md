# @endora-commerce/platform

## 0.7.0

### Major Changes

- c53fef3: **`WorkerLogger` is gone; the type is `PlatformLogger`.** One structured-logger shape had
  three exported names, and two of them were the same word.

  `@endora-commerce/platform/kernel` no longer exports `WorkerLogger`. The identical interface —
  `info(obj, msg)` / `warn(obj, msg)` / `error(obj, msg)` — is exported as `PlatformLogger`,
  from the file that documents and produces it. It is the type of `ModuleContext.log`, of
  `DefineModuleWorkerOptions.logger`, and of every `log` a module is handed or holds.

  ```ts
  // before
  import type { WorkerLogger } from '@endora-commerce/platform/kernel';
  class RefundHandler {
    constructor(private readonly log: WorkerLogger) {}
  }

  // after
  import type { PlatformLogger } from '@endora-commerce/platform/kernel';
  class RefundHandler {
    constructor(private readonly log: PlatformLogger) {}
  }
  ```

  The rename is the whole migration: the shape is byte-identical, so nothing but the imported
  name changes. A `type WorkerLogger = PlatformLogger` shim in your own code compiles, but it
  re-creates the second name this release exists to remove.

  Also removed: `ModuleLifecycleLogger` from `kernel/module-context.ts`, an alias of the same
  interface that no barrel published — a module could not name it, only meet it by hovering
  `ctx.log`. Nothing importable is lost.

  **Why it was a defect and not untidiness.** `@endora-commerce/contracts` exports a
  `ModuleLifecycleLogger` of its own, and it is a _different_ shape: the install/uninstall hook
  logger, `info(msg: string)`, one argument. The platform's alias claimed the same name for the
  two-argument shape. An author who read the published contracts package — the package whose job
  is to be the published shape — and wrote `ctx.log.info('…')` got `TS2554: Expected 2
arguments, but got 1`, with two names resolving and both of them ours.

  `@endora-commerce/contracts` keeps `ModuleLifecycleLogger` unchanged. Its name was the accurate
  one: it is the logger of `ModuleLifecycleContext` and of the two lifecycle-participant events,
  all called by the orchestrator, which tags the module id so the hook author writes plain
  messages. Its doc block now says what it is not.

- a84ad28: Remove `enroll` and `verifyTotp` from the kernel barrel, and delete
  `kernel/crypto/totp` with them.

  The primitive had no caller left once the superseded `/api/v1/me/two-factor/*`
  path was deleted: `mfa` ships its own TOTP over its own `otpauth` dependency,
  and nothing else in the tree named these symbols. `otpauth` is dropped from
  the platform's and the backend's manifests and stays where it is used.

  Withdrawing a published export is `major` even though the measured consumer
  count is zero — the barrel is what a third-party module compiles against, and
  this repository cannot see who has already done so.

- 2cd9c14: `@TransitivelyScoped` chains are now walked to their end, and one that reaches no tenant is refused at boot.

  `assertTransitiveParentsResolve()` used to check each transitive entity's **immediate** parent and stop.
  It now walks the whole chain and requires it to terminate at a classification that carries a tenant key —
  `@OrgScoped` or `@CustomerScoped`. Four shapes that used to pass now throw
  `UnresolvableTenantParentError` (the same error class as before — there is deliberately no second one)
  and stop the boot:
  - a chain terminating at a `@GlobalEntity` parent;
  - a chain terminating at a `@RuleScoped` parent (a foreign key cannot evaluate a rule);
  - a cycle, `A → B → A`, which resolves at every step and grounds nowhere;
  - a run of `@TransitivelyScoped` entities that reaches none of the above.

  Each of them left the child entity reachable with no tenant predicate anywhere on its path.

  **If your package ships an entity that now fails to boot**, the message names the entity, its foreign key
  and the whole chain. Either point the chain at an ancestor that owns the tenant, or — if the entity
  genuinely has no tenant — classify it `@GlobalEntity()` itself, which is a one-word change in the same
  decorator block.

  A chain terminating at a `@CustomerScoped` parent stays legal and now emits one `info` line naming the
  chain: `customerFilterCond()` yields no predicate in `allowed-set` mode, so such a chain is unfiltered for
  an org-scoped admin.

  `assertTransitiveParentsResolve()` also takes an optional reporter — `{ info(obj, msg) }`, which a
  `PlatformLogger` satisfies — as its first argument, for that line. Existing zero-argument calls keep
  working and write to `console.info`.

- 764b379: **`customerFilterCond`'s `allowed-set` arm stops returning `{}`, and the function takes an
  argument.**

  `customerFilterCond()` is now `customerFilterCond(organizationColumn: CustomerOrganizationColumn)`,
  where `CustomerOrganizationColumn` is `'present' | 'absent'` — both exported from
  `@endora-commerce/platform/tenancy`'s `filters` module. Any direct caller must pass one:

  ```ts
  // before
  const where = customerFilterCond();
  // after — `'present'` iff the entity you are filtering carries `organizationId`
  const where = customerFilterCond('absent');
  ```

  `@CustomerScoped()` itself is source-compatible and takes no new argument. It derives the answer
  per query from the ORM's discovered metadata, so an entity that gains an `organizationId` column
  starts being filtered on it with no further change.

  **The behaviour change is confined to the `allowed-set` mode** — the mode a scoped
  (assignment-limited) administrator resolves to. It previously contributed **no predicate at all**
  to any `@CustomerScoped` entity, so such an entity behaved as if it were `@GlobalEntity` for that
  actor. It now contributes `{ organizationId: { $in: allowed } }` when the entity carries the
  column, and a predicate that matches nothing when it does not. `all`, `system` and `single-org`
  are unchanged, and a buyer resolves `single-org`.

  A surface that has already established the caller's authority by other means and reads a
  `@CustomerScoped` entity with no organization column will now read nothing under a scoped
  administrator. Cross that deliberately with `withSystemScope(reason, fn)` after the check that
  establishes the authority; do not catch.

  `@endora-commerce/mod-quick-order`'s `registerQuickOrderAdminRoutes` takes a new required dep,
  `customerAccounts: CustomerAccountReadPort`. It is the tenant boundary of the admin build route:
  `onBehalfOf` names the customer account and organization the built Cart or Quote Request is
  written to, and it arrives in the request body, where no read filter can reach it.

- 0a2bbd4: `TransitivelyScoped` names its parent aggregate by **class name** instead of by a class
  thunk, so an entity can express a tenancy chain into a module whose package publishes an
  `entities` array and no named entity class.

  ```diff
  -import { Order } from '../../orders/entities/order.entity.js';
  -
  -@TransitivelyScoped(() => Order, 'orderId')
  +@TransitivelyScoped('Order', 'orderId')
   @Entity({ tableName: 'invoices' })
   export class Invoice {}
  ```

  The thunk overload is **gone**, not deprecated: it had no remaining call site once the
  platform's own two were converted, and keeping both forms would have been two ways to say
  one thing.

  `ClassificationMeta.parent` (`() => EntityClass`) is replaced by
  `ClassificationMeta.parentClassName` (`string`). Nothing in the platform read the old field.

  **Three new exports on `tenancy/org-scoped.decorator.js`**, none of them on the `./tenancy`
  barrel — they are the host's, as `tenantClassifications` already is:
  - `resolveTransitiveParent(child)` — the parent's `ClassificationMeta`, resolved lazily
    against the registry, so a child decorated before its parent is imported resolves fine.
  - `assertTransitiveParentsResolve()` — reconciles every transitive chain at once. Call it
    where the host enumerates its entity classes, after every classification decorator has
    run and before the ORM is configured.
  - `UnresolvableTenantParentError` — thrown by both when a parent name matches no classified
    entity, or matches more than one. There is no fallback: a transitively scoped entity has
    no tenant column of its own, so a chain that stopped resolving would be an untenanted
    read.

  The class name is the key because the registry is already addressed by it and MikroORM
  refuses two entities sharing one at discovery. The schema does not change — same foreign
  key, same column, same chain.

### Minor Changes

- 4db867c: **`@endora-commerce/platform` gains a sixth subpath, `./composition`, and it is not public API** (D-160.14; `specs/080-f4-real-scope/contracts/host-package.md` §2.7).

  It carries the 27 composition symbols a composition root needs and no published barrel carries — `buildServer`, `composeModules`, `createRootContainer`, `registerOrm`, `registerValues`, `createRegistrationOwnership`, `registerRequestScopeHook`, `platformLogger`, `registryCache`, `publishStateChanged`, `activationDeclarationsFrom`, `requiredModulesFrom`, `composeSettingsKernel`, `ManifestReconciler`, `composeSalesChannelsKernel`, `DefaultChannelReconciler`, `createRequestLanguageResolver`, `AuditLogService`, `forkScopedEm`, `resolveTenantContext`, `systemTenantContext`, and the types `ModulePlugin`, `ApiInterceptorRegistry`, `KernelContainer`, `DecorationRecord`, `SettingsKernel`, `SalesChannelsKernel`.

  **Nothing became public API.** `./kernel`, `./http`, `./tenancy`, `./commands` and `./events` are unchanged. **No module may name `./composition`** — production source or test alike; a module's server-bound test composes through the test kit's `composeTestServer`, never through `composeModules`. A symbol graduates to a public barrel in the merge request that first gives it a module-package production consumer.

  `@endora-commerce/cli` learns the rule: `resolveHostSpecifier` answers a third way — `host-internal-subpath`, a subpath the host's `exports` map declares and no barrel carries — and `check:platform-surface` reports a module's reach into one as a finding of its own kind. `HostPackage` gains a required `declaredSubpaths` field, read off the host manifest's own `exports` map; a consumer constructing a `HostPackage` by hand must supply it.

- fbf1bf8: `ctx.di.decorate` now **enqueues**, and `composeModules` drains the queue after the last module
  has registered — plus a new refusal, `PackageDecorationNotOfferedError`, for a deployment's
  overlay wrapping a registration an installed extension package owns (D-176).

  **The drain.** A decoration used to write the container at the call, while the registration pass
  was still running, so array order decided whether it was possible at all: a module composed
  before the owner of the name it wraps got _"nothing is registered under that name"_ — the right
  error for the wrong reason. That is now one pass and one drain, with no sort and no dependency
  graph. Three consequences for a caller:
  - **A decoration may name any registration in the composition, whatever the order.** Nothing that
    composed before is affected: an entry that worked at the call works at the drain.
  - **`hasRegistration`'s refusal changed meaning, and its message with it.** It now means _"no
    module in this composition ever registers that name"_ — check the spelling, and that the owner
    is composed — where it used to say the owning module had to be composed first. There is no such
    order any more, so any code matching on the old wording should stop.
  - **Refusals are raised at the drain, not inside `registerModule`.** `ForeignDecorationError` and
    `AmbiguousDecorationError` are unchanged and still name every module they named. Anything else a
    wrap throws is now wrapped as `ModuleCompositionError` with a new phase, `'decorate'` — so
    `ModuleCompositionError['phase']` is `'register' | 'decorate' | 'boot'`. Narrow on it rather
    than assuming two values.

  Call order is preserved: one module decorating one name twice still wraps in the order it wrote
  the calls, which is why that case is exempt from `AmbiguousDecorationError` and why the queue is a
  queue.

  **The refusal.** `ModuleEntry` gains `installedPackage?: boolean`, set by the host that discovers
  a package and never by the package. When the owner of a decorated name carries it, `decorate`
  throws `PackageDecorationNotOfferedError` — including for a deployment's overlay module, which is
  otherwise exempt from the ownership rule. Nothing that composed before is affected: an overlay
  wrapping a core or overlay registration is unchanged, a package wrapping its own registration is
  unchanged, and a module wrapping another module's is refused exactly as it was, one error class
  more specifically where the owner is a package.

  Its reason, which the message carries in full: a package's `exports` map publishes
  `registerModule`, its entities, its migrations and `./ports`, and a container name it registers
  internally is published by none of them — so the wrap would be written against a name the package
  never offered and may rename in a patch release. The message says _not offered yet_ rather than
  _forbidden_, and names the exit: a package declaring which of its registrations are decoratable,
  `./ports` being the natural home, where changing the shape costs a major bump.

  `PackageDecorationNotOfferedError` and `createDecorationQueue` are exported from
  `kernel/compose.js` and `kernel/module-context.js` beside the errors already there.

- 7e71642: Added the deployment divergence report's shape, and gave `decorationOrder` a supply.

  **`@endora-commerce/contracts`** exports `DivergenceReport`, `DivergenceEntry`,
  `DivergenceKind`, `DivergenceDetail`, `DivergenceBoundary` and `DivergenceKey` — the shape of
  the committed record of how one deployment's tree differs from core. Nine kinds, one per seam a
  deployment can use, each entry naming what was changed, the module that changed it, the module
  that owns what was changed, the rung of the customisation ladder it sits on, and the
  deployment's own sentence.

  Two fields are nullable on purpose and a consumer has to handle both. `entry.rung` is `null`
  for `registration`, `worker` and `omission`: the ladder ranks ways of changing what _core_ does,
  and those three are a module contributing its own surface or a declaration. `detail.depth` is
  `null` on every `decoration` in a committed report, because depth is a fact about a composition
  rather than about a tree — the runtime half of the report fills it in.

  **`@endora-commerce/platform`**: `ComposeModulesOptions.decorationOrder` is read by both of
  this repository's composition roots for the first time. Nothing about the field's type or its
  semantics changed — it is still _checked, never applied_ — but a composition that passes it now
  gets the assertion it always described, and `AmbiguousDecorationError`'s message changes with
  it: it names the deployment's own declaration file and the field, and suggests the order
  composition would apply, instead of telling its reader that there is no way to declare one.

  `ForeignDecorationError`, `PackageDecorationNotOfferedError` and `DuplicateRegistrationError`
  each gained the rung they refused and the nearest lower rung that works, by mechanism. **If you
  assert on any of these four messages, they have moved.** `error.name` and the constructor
  arguments are unchanged.

  **`@endora-commerce/cli`**: one estate row, `check:divergence`, classified `repository-only` —
  a rule's subject there is a deployment, and a module package is not one.

- 4e964e0: The lifecycle subsystem now ships with the platform (D-160.11).

  `_lifecycle`'s platform-safe files moved into `packages/platform/src/lifecycle/`:
  the module's manifest, its composition entry, its admin and storefront routes,
  its activation Commands, its i18n bundles, and eight services — the
  orchestrator, the manifest loader, the static registry, the dependency graph,
  the gating graph, the deactivation ledger, the lease lock and the presence load.
  An instance that installs the platform now has the lifecycle machinery with it,
  rather than depending on a separate package it could be missing.

  Two new modules are emitted from this package and are internal:
  `lifecycle/services/migration-ownership.js` declares the `MigrationOwnership`
  shape the orchestrator consumes (the host builds the value), and
  `lifecycle/services/module-origin.js` declares `ModuleIdClaimOrigin` and
  `deploymentShippedEntries`. `lifecycle/services/dep-graph.js` gains
  `stronglyConnectedComponents` and `moduleDependencyCycles`, which are now the
  one graph walk both the install refusal and the migration order read.

  Three behaviour changes for a caller that constructs the machinery itself:
  - `ModuleLifecycleOrchestrator` no longer defaults `migrationOwnership` to the
    committed core registry. Omitting it refuses every hard uninstall, naming the
    field; pass `coreMigrationOwnership()` for the previous behaviour, or
    `(await configuredMigrations()).ownership` from a composition root.
  - `gatingGraph()` no longer falls back to the host's manifest registry on its
    own. A composed process is unaffected — the presence load installs the real
    graph — and anything else calls `provideDefaultGatingManifests(supplier)`
    first or gets a throw instead of an empty graph that refuses nothing.
  - `loadModulePresence({ em, entries })` takes `declaredOmissions` instead of
    reading the deployment's reduced-deployment declaration itself. Omitting it
    declares no omission, which is the fail-closed direction.

  No published subpath changed: the `exports` map is still the five of D-160.7.
  The package's build now copies its runtime assets, so `dist/lifecycle/i18n/`
  travels with it.

- 63be98c: A module can declare the error codes it owns, and a branded type keeps a typo out of a raise site

  Feature 090 (`specs/090-module-owned-error-codes/`), Phase 1 of D-182. Nothing routes
  differently yet — the prefix chain in `@endora-commerce/mod-i18n` is untouched and is still
  what the composition roots inject.

  **`@endora-commerce/contracts`**
  - `ModuleManifest` gains `errorCodes?: { code: string; tokens?: string[] }[]` — the codes a
    module owns. The sentence for each still lives in the module's own
    `i18n/<language>.json` under `errors.<CODE>`; there is deliberately no `message` field,
    because the raising code's own English already exists and can interpolate.
    `defineModuleManifest` refuses four things, naming the module and the code: a code that is
    not SCREAMING*SNAKE_CASE, the same code twice in one manifest, a refusal token that does not
    match `^[a-z]a-z0-9*]\*$`, and the same token twice under one code.
  - New: `defineModuleErrorCodes(['ACME_SYNC_REJECTED'])` returns each code as a branded
    `ModuleErrorCode`. This is the authoring shape for a module's own codes, and it is
    mandatory rather than a convenience — a bare string literal is assignable to neither
    `ErrorCode` nor `ModuleErrorCode`, so a typo at a raise site is a compile error. It does
    **not** make a typo in an `error.code === '…'` comparison an error; that is unchanged and
    measured.
  - New: `errorCodeRe`, `errorCodeTokenRe`, `ModuleErrorCodeDeclarationSchema`.
  - `errorEnvelopeSchema.error.code` relaxes from `z.enum(Object.values(ERROR_CODES))` to a
    regex over the same grammar, so a module-declared code validates. `ERROR_CODES` and
    `ErrorCode` are unchanged and stay closed. `ErrorEnvelope['error']['code']` is now
    `ErrorCode | ModuleErrorCode`: every value valid before is valid after, in both directions.

  **`@endora-commerce/platform`**
  - `HttpError`'s `code` parameter and field widen from `ErrorCode` to
    `ErrorCode | ModuleErrorCode`. Purely a relaxation; no call site changes.

  **`@endora-commerce/mod-i18n`**
  - New: `buildErrorTranslationTargets(manifests)`, which derives the routing map from the
    modules' own declarations, and `describeErrorCodeCollisions`. Two modules declaring one
    code routes it to **neither** and names every claimant with the file that declares it —
    there is no tie-break by origin, order or id, because each of those renders one raiser's
    condition under the other's sentence with no symptom anyone can detect. Exported but not
    yet wired: the composition roots still inject `ERROR_TRANSLATION_KEYS`.
  - `ErrorTranslationTarget['key']` widens from `errors.${ErrorCode}` to `errors.${string}`.

- 1f4475e: `InProcessCacheRegistry` now carries the platform's cross-process cache
  invalidation, so a module can drop a snapshot on a module-state change without
  naming the Redis channel that announces it (D-174).

  Two additions to `@endora-commerce/platform/kernel`, both on the already
  published `InProcessCacheRegistry`:
  - `register(namespace, layer, opts?)` takes a third argument,
    `{ invalidateOnModuleStateChange?: boolean }`, default `false`. Existing
    two-argument calls are unaffected and keep the old behaviour exactly.
  - `invalidateForModuleStateChange(): Promise<void>` drops every layer that
    opted in. Every layer is started synchronously before the first `await`, and a
    layer that throws is reported and skipped rather than propagated.

  `ModuleRegistryCache.watch` calls it on each `b2b:module:state-changed` message,
  before the PostgreSQL refresh — so the drop lands on receipt.

  Why a consumer would want it: `registryCache.presenceVersion()` is a content
  hash of the two presence axes and of nothing else, so a cache derived from what
  an install _rewrites_ — a module's command-palette rows, another module's
  translation bundles — is structurally blind to those inputs. The notification is
  the only cross-process announcement of them, and it is not something a module
  should be subscribing to itself: the channel is a transport detail and the
  payload is one the consumer does not read.

  ```ts
  import { inProcessCaches } from '@endora-commerce/platform/kernel';

  const unregister = inProcessCaches.register(
    'my_module',
    {
      invalidateAll: async () => {
        cache.clear();
        return 0;
      },
    },
    { invalidateOnModuleStateChange: true },
  );
  ```

  Opt in only where the layer's content really is derived from module state. A
  layer that owns a Redis key space clears it with SCAN+DEL, and running that in
  every API and worker process on every operator flip is a storm — which is why
  the flag exists instead of the notification dropping everything registered.

- ce1d197: New package: `@endora-commerce/platform`, the host an extension package compiles against
  (feature 080, T042a; contract `specs/080-f4-real-scope/contracts/host-package.md`, rulings
  D-160.1 and D-160.7).

  **Five enumerated subpaths, no root export and no wildcard.**

  ```ts
  import { lazyPort, type ModuleContext } from '@endora-commerce/platform/kernel';
  import { HttpError } from '@endora-commerce/platform/http';
  import { GlobalEntity } from '@endora-commerce/platform/tenancy';
  import { CommandBus } from '@endora-commerce/platform/commands';
  import { EventBus } from '@endora-commerce/platform/events';
  ```

  `@endora-commerce/platform` itself, `/db`, `/overlay`, `/packages` and any deep file path are
  `ERR_PACKAGE_PATH_NOT_EXPORTED`, and that is the contract rather than an omission: a wildcard
  map would publish all fourteen accidental-reach platform files as supported API — `db/index`
  among them, which cannot be published at all, because it reaches the ORM configuration and
  through it 219 module-owned entity references, making the host import every module. The five
  subpaths are also the boundaries a five-package split would take, so that option stays open at
  the price of one release.

  **`@mikro-orm/core`, `@mikro-orm/postgresql`, `fastify` and `zod` are peer dependencies, and
  the host is a non-optional peer of every module package** — never a `dependencies` entry.
  Measured: two copies of `@mikro-orm/core` share one metadata registry (`globalThis`, no
  version in the key) and the package's entity is registered and then **silently dropped from
  discovery** — no throw, no warning, exit 0, and a table nobody creates. Two copies of the
  _host_ are the loud case, `MetadataError: Duplicate entity names are not allowed`.

  The package emits from `backend/src`'s five platform directories, so nothing in the
  application tree moved and every existing relative specifier is untouched.

- 028d8b4: The package's sources are now its own: `kernel`, `http`, `tenancy`, `commands` and `events`
  live in `packages/platform/src/`, and `tsconfig.build.json` compiles them with
  `rootDir: "./src"`.

  **No exported symbol, subpath or type changes.** The five enumerated subpaths and their
  contents are byte-identical, and a consumer's imports need no edit:

  ```ts
  import { lazyPort, SalesChannel } from '@endora-commerce/platform/kernel';
  import { HttpError } from '@endora-commerce/platform/http';
  ```

  **What changes is identity.** The package used to emit `dist/` from
  `rootDir: ../../backend/src`, so its artefact was the application's own five directories
  _compiled a second time_. The application ran the originals; anything resolving the bare
  specifier ran the copy. Measured across the two: **59 identity-bearing exports, none of them
  shared** — `new HttpError(…) instanceof HttpError` was `false` across the boundary, so a
  packaged module's every 404 and 409 rendered as a 500; `effectiveState` and
  `getResolvedChannel` were module-scoped singletons the host never populated; and
  `MikroORM.init` over both copies of `SalesChannel` threw
  `MetadataError: Duplicate entity names are not allowed`.

  Everything the acceptance fixture took from the host was a **type**, and types are erased —
  which is why nothing had noticed, and why the criterion could be 9/9 throughout. There is now
  exactly one copy of every one of those 59 values, and
  `backend/test/unit/kernel/platform-single-copy.test.ts` fails if a second one returns.

  The package also declares `"endora": { "type": "platform" }`, the block the host's own tooling
  reads to find it — the same shape a module package uses for `{ "type": "module", "id" }`.

- 81f4b08: `defineModuleWorker` now stops a queue consumer whose module is switched off, on **both**
  presence axes and in **every** process (Constitution XVII).

  Before this, `pauseWorkersFor` was the only thing that could stop a worker, and it had two
  call sites — both on the platform-availability axis, inside the lifecycle orchestrator's
  `disable`. A business operator's deactivation refreshed the presence cache, took the module's
  routes to 503 and left the BullMQ worker consuming. `pauseWorkersFor` is also process-local:
  it iterates a registry the calling process filled, so it never reached a `BACKEND_ROLE=worker`
  process, and never reached anything at all from the `module:*` CLI, which composes no modules.

  Two gates, both reading the `ModuleRegistryCache` that every composed process already keeps
  fresh from `b2b:module:state-changed`:
  - **the fetch gate** — every presence install reconciles every registered worker to
    `effectiveState.isPresent`, pausing the absent and resuming the present. Level-triggered and
    idempotent, so a missed notification is retried by the degraded-mode refresh rather than
    lost.
  - **the work gate** — `defineModuleWorker` wraps the worker's processor, so a job already
    fetched when presence flipped does not run.

  **A refused job is left waiting**, never failed and never dropped: the work gate uses BullMQ's
  `Worker.rateLimit` + `RateLimitError`, which returns the job to the wait list with no attempt
  consumed and no `failed` event, and it drains when the module comes back.

  New API on `ModuleRegistryCache`:

  ```ts
  const stop = registryCache.onPresenceInstalled(() => reconcileMyThing());
  ```

  Called on every presence install — the pub/sub refresh, the degraded-mode refresh, the cold
  load. Use it where `presenceVersion()` is not enough because the thing you own is stateful
  rather than memoised. Listeners must be idempotent; their throws are contained and logged.

  Also exported from `kernel/lifecycle/plugin-helpers`: `reconcileModuleWorkers()` and the test
  seam `resetModuleWorkersForTesting()`.

  **One behavioural requirement on callers.** `defineModuleWorker` now **throws** when the value
  it is given carries no BullMQ processor, instead of registering a worker it cannot gate. A
  hand-written stub passed as `as unknown as Worker` must supply `processFn`, `isPaused()` and
  `on()` alongside `pause()` / `resume()`; a real `Worker` already does.

- 31975ca: `SalesChannelResolutionPort` and `SalesChannelMembershipPort` each gain one method, both
  implemented by the kernel services behind the `salesChannelResolutionPort` and
  `salesChannelMembershipPort` container names.
  - `SalesChannelResolutionPort.listAll(): Promise<CachedChannel[]>` — every channel, ordered by
    code. A consumer that needed the whole list previously had to reach the module's admin
    service or query `sales_channels` itself; both are boundary violations.
  - `SalesChannelMembershipPort.replaceChannelsForEntity(entityType, entityId, channelIds,
options?)` — replace an entity's complete membership set in one transaction. Composing
    `removeFromChannel` and `addToChannel` cannot express it: the intermediate state either
    trips the at-least-one-channel invariant or leaves the system default bound alongside the
    channel the caller actually wants. Callers are complete-record integrations, where the
    delivered record names the exact set.

  Both are additive. An existing implementation of either interface written outside this
  repository needs the new method; every implementation inside it is the kernel's own service.

- 456ffa7: A listing that a viewer's organization scope emptied now says so.

  `@endora-commerce/contracts` adds `SCOPE_NOTICE_CODES`, `scopeNoticeCodeSchema`,
  `ScopeNoticeCode`, `scopeNoticeMetaSchema`, `ScopeNoticeEnvelope` and `scopeNoticeOf`.
  The last is the reader both sides share: `meta.scopeNotice` on any successful response,
  absent when there is nothing to say.

  ```ts
  import { scopeNoticeOf } from '@endora-commerce/contracts';

  const res = await apiClient.get<ListResult>('/api/v1/admin/comparisons');
  const notice = scopeNoticeOf(res); // 'ORGANIZATION_ATTRIBUTION_PENDING' | null
  ```

  `@endora-commerce/platform` adds `TenantScopeNotices` and
  `noteOrganizationAttributionRefusal` to `./tenancy`, an optional `notices` field on
  `TenantContext`, and a `preSerialization` hook inside `registerRequestScopeHook` that puts
  the code on the envelope. **This changes what every route registered behind that hook
  answers**: a successful object body gains `meta.scopeNotice` when the `customerAccount`
  filter refused a whole table during that request. Error bodies, arrays, buffers and string
  bodies are untouched, and a viewer whose reach is not restricted never sees the key,
  because only an `allowed-set` context carries a sink for the filter to write to.

  Nothing to do to adopt it: no route sets a flag, and the notice stops being emitted for a
  table on the day that table gains an `organization_id`, because the same filter arm starts
  granting instead of refusing.

  `@endora-commerce/mod-i18n` adds the two operator-facing sentences to the `core` bundle in
  `en` and `pl`: `scopeNotice.organizationAttributionPending.title` and `.body`.

### Patch Changes

- 469a5f4: Removed `ERROR_TRANSLATION_KEYS` and `composeErrorTranslationTargets` from
  `@endora-commerce/mod-i18n/backend`. Error-code routing is now nothing but the modules' own
  `errorCodes` declarations, composed by `buildErrorTranslationTargets`, which was already
  published and is unchanged.

  `ERROR_TRANSLATION_KEYS` was a static table generated by a private prefix chain
  (`moduleIdForErrorCode`) over the closed `ERROR_CODES` enumeration, so a module written outside
  this repository could not produce a translated error at all: its code was in neither, and the
  envelope answered whatever English the raising code wrote, for ever. The chain's last line was
  `return 'core'`, so a code no rule matched was routed silently to the platform bundle and
  rendered as a raw code with nothing anywhere reporting it.

  **If you named `ERROR_TRANSLATION_KEYS`**, build the map from the manifests instead. The input is
  every registered manifest — core, this deployment's overlay modules and every installed package.

  ```diff
  -import { ERROR_TRANSLATION_KEYS } from '@endora-commerce/mod-i18n/backend';
  -const target = ERROR_TRANSLATION_KEYS[code];
  +import { buildErrorTranslationTargets } from '@endora-commerce/mod-i18n/backend';
  +const { targets, collisions } = buildErrorTranslationTargets(await resolvedManifestEntries());
  +const target = targets[code];
  ```

  **If you called `composeErrorTranslationTargets`**, call `buildErrorTranslationTargets` with the
  same argument. It was a transitional shape that laid the declarations over the chain so the
  migration could be delivered one owning module per merge request; all eighteen owners have
  declared, so there is nothing left to lay them over.

  Two behavioural differences follow, and both are the point rather than side effects. A code **no
  registered manifest declares** is now absent from the map, so the envelope answers the raising
  code's own message — there is no fall-through to the platform bundle. And a code **more than one
  module declares** is absent too, and named in `collisions` with every claimant and the file it
  was declared in: nobody wins, because routing one raiser's condition under another's sentence is
  good prose about the wrong thing, with no symptom a client can detect.

  `ErrorTranslationTarget`, `ErrorTranslationTargets`, `ErrorCodeDeclarationSource`,
  `ErrorCodeClaim`, `ErrorCodeCollision` and `describeErrorCodeCollisions` are unchanged.

  `@endora-commerce/platform` carries a documentation correction only: the
  `ErrorEnvelopeOptions.errorTranslationTargets` doc block no longer describes the injected map as
  a static table, and records that a deployment's overlay module can now own a code by declaring
  it. No emitted behaviour changes.

- ee02c59: The per-deployment declaration is `divergence`, and it is an object (D-205).

  `ReducedDeploymentDeclarationSchema` and its `ReducedDeploymentDeclaration` type
  are gone. The entry survives as `OmittedModuleSchema` / `OmittedModule`,
  unchanged in substance — a `moduleId` and a 20–800 character `reason` — and it
  now sits inside `DeploymentDivergenceDeclarationSchema`, which is what a
  deployment's `backend/src/apps/<deployment>/divergence.ts` exports as
  `divergence`.

  Before:

  ```ts
  import type { ReducedDeploymentDeclaration } from '@endora-commerce/contracts';

  export const reducedDeployment: ReadonlyArray<ReducedDeploymentDeclaration> = [
    { moduleId: 'blog', reason: '…' },
  ];
  ```

  After:

  ```ts
  import type { DeploymentDivergenceDeclaration } from '@endora-commerce/contracts';

  export const divergence: DeploymentDivergenceDeclaration = {
    omittedModules: [{ moduleId: 'blog', reason: '…' }],
    decorationOrder: {},
    reasons: {},
  };
  ```

  The file is renamed with the export, because _reduced_ encodes a direction two
  of the three new contents do not have: `decorationOrder` declares the wrapping
  order for a registration more than one of a deployment's overlay modules
  decorates, and `reasons` carries one sentence per divergence the platform
  derives, keyed by the derived entry's own key. Both parse today and are read by
  nothing yet — they are supplied and checked by later phases of
  `specs/107-override-report-and-ladder/`.

  Three details a consumer will meet:
  - Every field defaults to empty, so a declaration that leaves one out means
    "none of these" — the reading an absent file already gets.
  - The object is **strict**: a fourth field, or a misspelled one, is refused
    rather than stripped, because a stripped field reads as "this deployment
    declares nothing" for a file whose author wrote a declaration.
  - `@endora-commerce/platform`'s D-101 boot refusal is unchanged in behaviour and
    changed in wording: it names `divergence.ts` and the `omittedModules` inside
    it. `ReducedDeploymentError` keeps its name — all three of its findings are
    about a module set that is genuinely reduced.

- cc9c2f4: `registerErrorEnvelope` no longer lets a failing localisation replace the error
  it was localising.

  The `preSerialization` hook that swaps an error's written message for the
  registered sentence in the caller's language calls two host-injected callbacks —
  `resolvePreferredLanguage` and `translateErrorMessage`. Either can throw, and a
  throw there is not an ordinary failure: the hook runs while a reply Fastify is
  already treating as an error is being serialised, so Fastify cannot route it
  back through `setErrorHandler` and falls back to its own serialiser. The
  response then stops being an `ErrorEnvelope` at all — `{ statusCode, code,
error, message }`, in which `error` is the status phrase and `error.code` is
  `undefined`, so the admin's API client builds an `ApiError` reading
  `undefined: undefined`.

  Every other exit from that hook already returns the payload unchanged (no
  translation target, a `VALIDATION_FAILED` carrying a machine-readable token, a
  sentence with an unfilled placeholder). The throw now does the same: the
  untranslated envelope is served, in `LANGUAGE_FALLBACK`, and the failure is
  logged at `warn`. Nothing about a successful response passes through the guard —
  a payload that is not an error envelope never enters the decoration.

  No exported signature changes. The behavioural change is visible to a host whose
  `resolvePreferredLanguage` reads a gated port: that host now gets the envelope
  plus a `warn` line instead of a bare Fastify error body.

  `RequestLanguageDeps.adminPreferredLanguage`'s doc block is corrected in the same
  change. It asserted that the dependency is supplied by the composition root
  "rather than resolved as a port" precisely so it could not throw here; a host in
  this repository has supplied it out of a gated port since the module packaging
  work removed the named entity class it used to read. The dependency may throw,
  and the guarantee is now stated at the renderer instead.

- a47dcc8: `kernel/public-api-base-url.ts` gains `absolutizePublicUrl`, which makes an asset or API path
  absolute for a consumer that is not a browser on this host.

  It is **not** on the `./kernel` barrel and is not public API: no module reaches it, and its
  only caller is the composition root, for the PWA asset bridge and the transactional-email
  asset URL. It arrived from `backend/src/modules/email/`, where it was filed under the module
  that first needed it and had no consumer inside that module at all.

  Its default base is still `BACKEND_PUBLIC_URL ?? PUBLIC_API_BASE_URL`, deliberately rather
  than `configuredPublicApiBaseUrl` beside it: the two disagree on precedence when both
  variables name different origins, so unifying them would move a URL rather than move a file.

- aab1f32: `runWithoutTenantContext` now keeps the context cleared across an `await` on Node 22.

  It was implemented with `AsyncLocalStorage.exit(fn)`, which on every runtime before Node 24
  is `disable(); try { fn() } finally { enable() }` — a synchronous try/finally around a
  callback that may be `async`. Where the caller's context had been installed with
  `enterTenantContext` and the callback opened a nested `runWithTenantContext` of its own, the
  re-enable resurfaced the caller's context and everything after that point read it: the
  function's documented "no ambient context" ended partway through, silently. Node 24 made
  `AsyncContextFrame` the default and the same call became frame-scoped, so the defect was
  invisible on a newer local runtime and live on the 22.17 floor `engines.node` declares.

  The implementation is now `storage.run(undefined, fn)`. The contract is unchanged —
  `getTenantContext()` answers `undefined` inside, the caller's context is restored on both
  return and throw — and it holds across `await` on 22.17 and on 26 alike. Callers need no
  change; a caller that had worked around the old behaviour by re-asserting the clear after an
  await can drop the workaround.

- Updated dependencies [73d0887]
- Updated dependencies [0a08996]
- Updated dependencies [93a300c]
- Updated dependencies [b2552d5]
- Updated dependencies [cebad9c]
- Updated dependencies [196fbfa]
- Updated dependencies [543151a]
- Updated dependencies [e5ae42c]
- Updated dependencies [f11ccdb]
- Updated dependencies [21dac4f]
- Updated dependencies [43e1968]
- Updated dependencies [a28c796]
- Updated dependencies [727cbf5]
- Updated dependencies [f66359f]
- Updated dependencies [81726cf]
- Updated dependencies [1ba52e1]
- Updated dependencies [86359f8]
- Updated dependencies [b0df9c1]
- Updated dependencies [4ed4b84]
- Updated dependencies [11fc9f3]
- Updated dependencies [f66ce9b]
- Updated dependencies [a80e2bb]
- Updated dependencies [d23bce2]
- Updated dependencies [2f04481]
- Updated dependencies [04cba90]
- Updated dependencies [7e71642]
- Updated dependencies [ee02c59]
- Updated dependencies [cb44af0]
- Updated dependencies [eeb6a47]
- Updated dependencies [cd013dd]
- Updated dependencies [3c8102e]
- Updated dependencies [dc5c19d]
- Updated dependencies [c53fef3]
- Updated dependencies [c94c52d]
- Updated dependencies [4013a8b]
- Updated dependencies [fc34995]
- Updated dependencies [1050b9a]
- Updated dependencies [32cc6e4]
- Updated dependencies [63be98c]
- Updated dependencies [9ce0b40]
- Updated dependencies [07b2715]
- Updated dependencies [9b2a43e]
- Updated dependencies [c4703f9]
- Updated dependencies [49164fb]
- Updated dependencies [284276b]
- Updated dependencies [d59f846]
- Updated dependencies [566f233]
- Updated dependencies [0ec3f95]
- Updated dependencies [13e12bd]
- Updated dependencies [f2fa9ea]
- Updated dependencies [28c7f22]
- Updated dependencies [30a5475]
- Updated dependencies [31975ca]
- Updated dependencies [e1465e0]
- Updated dependencies [a47dcc8]
- Updated dependencies [456ffa7]
- Updated dependencies [49164fb]
- Updated dependencies [49164fb]
- Updated dependencies [7f02d62]
- Updated dependencies [bbf9258]
- Updated dependencies [e3a6a02]
- Updated dependencies [184fa9f]
- Updated dependencies [2c8635b]
- Updated dependencies [aab5273]
  - @endora-commerce/contracts@0.7.0
