/**
 * `./composition` — the platform's sixth subpath, and the one that is **not**
 * public API (feature 109, T010; ruling **D-160.14**, whose full text and
 * measurements are `specs/080-f4-real-scope/contracts/host-package.md` §2.7).
 *
 * ## What is on it
 *
 * The **27** platform symbols a composition root needs and no published barrel
 * carries. They were derived two independent ways that agree — a parse of the
 * five barrels' `ExportDeclaration` nodes, and a `tsc` compile of 165 one-line
 * consumers (33 names × 5 subpaths) against the built package's `exports` map,
 * which gives 159 errors and six resolutions. Build the server, open the
 * container, register the ORM, compose the settings and sales-channel kernels,
 * reconcile the manifests and the default channel, prime the registry cache,
 * establish or fork a tenant context, attach the logger. **Not one of them is an
 * assertion, a fixture or a matcher**, which is why the subpath is called
 * `composition` and not `testing` (§2.7.4).
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
 * `published-surface.test.ts`' `NOT_PUBLISHED` — 15 of these 27 are in it. The
 * decisive measurement is that **all 27 have zero module-package consumers**,
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

// --- http ---------------------------------------------------------------
export { buildServer, type ModulePlugin } from '../http/server.js';
export { ApiInterceptorRegistry } from '../http/interceptors/index.js';

// --- kernel: the container and the composition pass ----------------------
export {
  createRootContainer,
  registerOrm,
  registerValues,
  type KernelContainer,
} from '../kernel/container.js';
export { composeModules, type DecorationRecord } from '../kernel/compose.js';
export { createRegistrationOwnership } from '../kernel/module-context.js';
export { registerRequestScopeHook } from '../kernel/request-scope-hook.js';
export { platformLogger } from '../kernel/logging.js';

// --- kernel: the lifecycle a root primes and reconciles -------------------
export { registryCache, publishStateChanged } from '../kernel/lifecycle/registry-cache.js';
export { activationDeclarationsFrom } from '../kernel/lifecycle/activation-resolver.js';
export { requiredModulesFrom } from '../kernel/lifecycle/required-modules.js';

// --- kernel: the sub-kernels a root composes ------------------------------
export { composeSettingsKernel, type SettingsKernel } from '../kernel/settings/compose.js';
export { ManifestReconciler } from '../kernel/settings/manifest-reconciler.js';
export {
  composeSalesChannelsKernel,
  type SalesChannelsKernel,
} from '../kernel/sales-channels/compose.js';
export { DefaultChannelReconciler } from '../kernel/sales-channels/default-channel-reconciler.js';
export { createRequestLanguageResolver } from '../kernel/i18n/request-language.js';
export { AuditLogService } from '../kernel/audit/audit-log-service.js';

// --- tenancy: establishing and forking a context --------------------------
export { forkScopedEm } from '../tenancy/scoped-em.js';
export { resolveTenantContext, systemTenantContext } from '../tenancy/resolve-tenant-context.js';
