/**
 * `./composition` — the platform's sixth subpath, and the one that is **not**
 * public API (feature 109, T010; ruling **D-160.14**, whose full text and
 * measurements are `specs/080-f4-real-scope/contracts/host-package.md` §2.7).
 *
 * ## What is on it
 *
 * The platform symbols a composition root needs and no published barrel
 * carries. The original set was derived two independent ways that agree — a
 * parse of the five barrels' `ExportDeclaration` nodes, and a `tsc` compile of
 * one-line consumers against the built package's `exports` map. Build the
 * server, open the container, register the ORM, compose the settings and
 * sales-channel kernels, reconcile the manifests and the default channel, prime
 * the registry cache, establish or fork a tenant context, attach the logger —
 * and, since `specs/110-instance-repository/` T118, **perform the composition
 * itself**. **Not one of them is an assertion, a fixture or a matcher**, which
 * is why the subpath is called `composition` and not `testing` (§2.7.4).
 *
 * **How many that is is not written here** (D-100). It read *"the 27"* in three
 * places in this file and in the assertion that checks it, and T118 moved the
 * number twice inside one merge request. `HOST_COMPOSITION_SURFACE` in
 * `test/unit/kernel/published-surface.test.ts` is the attribution table, and
 * the barrel is held to it in both directions.
 *
 * ## The rule it carries: no module may name it, ever
 *
 * Production source or test alike. A module package's server-bound test composes
 * a server through the test kit's `composeTestServer`, never through
 * `composeModules`. That is enforced rather than asserted:
 * `check:platform-surface` gives a declared-but-unpublished subpath a third
 * state and a module's reach into one a finding of its own kind
 * (`host-internal-subpath`), which is §2.7.5(a)'s requirement and the reason
 * this subpath is *not* a sixth `PUBLISHED_SUBPATHS` entry — that list is keyed
 * by target file with no subpath dimension, so an entry there would publish
 * `composeModules` out of `kernel/compose.ts` for a module's *relative* reach
 * too, and change nothing the check prints.
 *
 * ## What it is not
 *
 * It is not a widening of the public surface. §1.3's classification is not
 * re-opened, the five public barrels gain nothing, and no entry is deleted from
 * `published-surface.test.ts`' `NOT_PUBLISHED`. The decisive measurement is that
 * **every one of them has zero module-package consumers**,
 * production or test, so publishing any of them would be publishing supported
 * API on the strength of a *harness's* necessity: D-160.8's failure mode
 * arriving through a door D-160.8 did not think to watch.
 *
 * A symbol **graduates** to a public barrel in the merge request that first
 * gives it a module-package **production** consumer, and leaves this subpath in
 * the same merge request (R3.1a — a symbol is never on both). That is derivable
 * on any day and moving a symbol here to a barrel is not a breaking change, so
 * deferring the judgement costs nothing and buys the only merge request in which
 * *"is this public API?"* is answerable.
 *
 * ## Why it re-exports out of three directories, where a barrel may not
 *
 * `kernel/index.ts` says a barrel carries **its own** directory's symbols and
 * nothing else, because each of the five is a package boundary in waiting
 * (D-160.6). This file is deliberately not one: it is the host's composition
 * surface, spanning `http/`, `kernel/` and `tenancy/` because a composition
 * root does. Splitting the platform would leave it where it is, naming three
 * packages, which is exactly what a composition root does today.
 *
 * The specifier each name is re-exported through is the one
 * `backend/test/helpers/test-server.ts` reached it by, so the ruling's own
 * table and this barrel are read against each other symbol by symbol.
 */

// --- the composition itself ----------------------------------------------
// `specs/110-instance-repository/` T118 (R1.4). Every other name here is a
// piece a composition root uses to build a composition; this one **is** the
// composition — the assembly sequence a deployment used to write out, and the
// single contribution slot it hands its own values through.
//
// `AppComposition` and `AppOrmLifecycle` are deliberately **not** here.
// R3.1a's second direction: a name no consumer outside the platform imports is
// surface parked against a future need. Both are reachable through
// `ComposeAppOptions` for `tsc`, and a caller builds the object literal without
// naming either — measured on the one consumer there is.
export {
  composeApp,
  type ComposeAppHandle,
  type ComposeAppOptions,
  type ComposedAppContext,
} from './compose-app.js';

// --- http ---------------------------------------------------------------
export { buildServer, type ModulePlugin } from '../http/server.js';
export { ApiInterceptorRegistry } from '../http/interceptors/index.js';
// `registerErrorEnvelope` attaches the envelope to a Fastify instance the root
// built. `./http` carries `HttpError`, which is what a module raises, and not
// this — a module does not own an app to attach anything to.
export { registerErrorEnvelope } from '../http/error-envelope.js';
// The proxy trust level is a deployment input the root reads off the
// environment and hands to `buildServer`; a module never sees it.
export { parseTrustedProxy, type TrustedProxy } from '../http/trusted-proxy.js';

// --- kernel: the container and the composition pass ----------------------
export {
  createRootContainer,
  registerOrm,
  registerValues,
  type KernelContainer,
} from '../kernel/container.js';
export {
  composeModules,
  ModuleCompositionError,
  type DecorationRecord,
  type ModuleEntry,
} from '../kernel/compose.js';
// The context the host constructs and hands a module, the sink it collects the
// module's registrations in, and the three refusals composition raises at the
// root. `NOT_PUBLISHED` already names the first three *composition*, which is
// this subpath's own word; the decoration errors join them because a decoration
// is asserted by the composer over a registration a module made, so the throw
// lands in the root's stack and never in the module's.
export {
  createModuleContext,
  createModuleRegistrationSink,
  AmbiguousDecorationError,
  ForeignDecorationError,
  PackageDecorationNotOfferedError,
  createRegistrationOwnership,
  type ModuleRegistrationSink,
} from '../kernel/module-context.js';
export { registerRequestScopeHook } from '../kernel/request-scope-hook.js';
export { platformLogger } from '../kernel/logging.js';
// `absolutizePublicUrl` was here — the absolutiser a root applied to a
// configured public base URL — and D-223 removed its last consumer. The
// composition root had two call sites, for the `pwa` asset bridge and the
// transactional-email asset URL; `assets_library` resolves the origin itself
// now and returns absolute URLs, so no application rebases one. `./kernel`
// still carries the factory types and the configuration refusal, which is what
// a module reads.
//
// `AdminActorPromotion` came off for the same reason when T118c drained
// `mfaActorBridge`. The barrel is held to its consumers **both** ways, so a
// name nobody names comes off rather than standing as parked surface; the
// declaration itself is untouched in `../kernel/public-api-base-url.js`, and it
// returns here the day an application needs it again. Neither branch is ever
// wrong alone: one merge request adds a name because a consumer exists, another
// removes the consumer.

// --- kernel: the lifecycle a root primes and reconciles -------------------
export { registryCache, publishStateChanged } from '../kernel/lifecycle/registry-cache.js';
export { activationDeclarationsFrom } from '../kernel/lifecycle/activation-resolver.js';
export { requiredModulesFrom } from '../kernel/lifecycle/required-modules.js';
// `specs/110-instance-repository/` T119c. The platform-availability row itself —
// the entity class `module_registrations` is mapped by. It is here and **not** on
// `./kernel`, and that is `host-package.md` §1.3's **A** classification applied
// rather than revised: **A** means *not public API*, `./composition` is not
// public API, and the registry cache a root primes off these rows is on this
// barrel two lines above. Putting the class on `./kernel` would let every module
// package name the row that records whether its siblings are installed, which is
// the reach §1.3 refused.
//
// It is on a barrel at all because the entity registry a build ships has to name
// it: `db/entities-registry.generated.ts` hands MikroORM this class, and until
// this export existed the generator could name it only by relative path into
// `packages/platform/dist/`, which resolves in this checkout and in no client's.
// One unaddressable class was enough to hold the other five — all on `./kernel`
// already — to the same spelling, so this single export is what let all six
// become bare specifiers and all six shims go.
export { ModuleRegistration } from '../kernel/lifecycle/module-registration.entity.js';

// --- kernel: the sub-kernels a root composes ------------------------------
export { composeSettingsKernel, type SettingsKernel } from '../kernel/settings/compose.js';
export { ManifestReconciler } from '../kernel/settings/manifest-reconciler.js';
export {
  composeSalesChannelsKernel,
  type SalesChannelsKernel,
} from '../kernel/sales-channels/compose.js';
export { DefaultChannelReconciler } from '../kernel/sales-channels/default-channel-reconciler.js';
// T118 — `createRequestLanguageResolver` left this barrel with the assembly that
// wrapped it. Both roots constructed it; neither does now, because the whole
// error-envelope assembly is one platform function, and R3.1a's rule cuts both
// ways — a name here with no consumer outside the platform is surface parked
// against a future need, which is what `published-surface.test.ts`' second
// direction refuses. The resolver is still the ladder; it is simply no longer a
// composition root's to construct.
export { composeErrorEnvelopeOptions } from '../kernel/i18n/error-envelope-options.js';
export { AuditLogService } from '../kernel/audit/audit-log-service.js';

// --- tenancy: establishing and forking a context --------------------------
export { forkScopedEm } from '../tenancy/scoped-em.js';
export { resolveTenantContext, systemTenantContext } from '../tenancy/resolve-tenant-context.js';
