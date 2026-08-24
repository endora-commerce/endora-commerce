/**
 * CI check — a module declares the modules whose ports it resolves
 * (feature 072, T061 / FR-040).
 *
 * The port rule says a module never imports another module's service: it
 * declares the shape it needs and resolves it from the container, and the
 * owning module registers the default. That leaves one thing unchecked, and it
 * is the thing that decides whether the platform is composable: **the resolving
 * module has to declare the owning module in `manifest.dependencies`.** Without
 * that declaration the dependency exists at runtime and nowhere else — the
 * lifecycle cannot fail closed on it, the migration order cannot correct for
 * it, and an operator switching the provider off finds out from a 503 in a
 * module whose manifest says it depends on nothing.
 *
 * Three properties are enforced:
 *
 *   1. Every name a module resolves is owned by *something* — a module, the
 *      kernel, or the platform. A name nobody registers is a wiring bug that
 *      currently surfaces as an `AwilixResolutionError` at boot, in whichever
 *      environment happens to compose that module first.
 *   2. When the owner is another module, that module is in the resolver's
 *      **transitive** `manifest.dependencies` closure — the same closure the
 *      migration ordering and the lifecycle dependency check use.
 *   3. No **gated port** is resolved before the platform serves its first
 *      request — not from a `ctx.onBoot` hook, not from a `ctx.routes` body
 *      (feature 072, D-39). Both run whatever the owning module's effective
 *      state is, so the gate has a real "no" answer there, and answering it
 *      turns an operator's supported off-switch into a backend that will not
 *      start. A name whose whole contract is "a table of inert descriptors the
 *      host walks" should not have been a port; one that computes, decides,
 *      decrypts, sends or charges should not be resolved that early.
 *
 * **This is a hard failure, not a report-only ratchet**, and it can be because
 * it only sees modules that actually resolve through the container: the check
 * measures port resolutions, not imports. Research counted 261
 * imported-but-undeclared edges across the tree; this check found **one**
 * (`blog` → `auth`) on its first run, because three modules are converted. A
 * ratchet armed now, while the cost of clearing it is one line, is the only
 * version of this check that survives the sweep — each conversion pays for its
 * own declarations instead of leaving a 261-entry allow-list nobody will ever
 * drain.
 *
 * Static analysis through the TypeScript compiler API. Sits alongside
 * `check-container-imports.ts` and `check-kernel-boundary.ts`.
 *
 * ## Installed packages (feature 080, T034)
 *
 * The port→owner map was `src/modules/**` plus {@link HOST_REGISTERED_PORTS},
 * and since T031 that is a fraction of the platform: a module can arrive as an
 * npm package installed into the instance's `node_modules`. A name such a
 * package owns resolved to nobody, so property 1 above reported the *consumer*
 * as broken — `unowned-name`, a wiring bug — when the wiring is right and the
 * map was short. That is the ordinary case of the F4 endgame, where a module
 * leaves this tree for a package and every core consumer of its port starts
 * reading as a defect.
 *
 * `scripts/lib/package-declarations.ts` supplies the third source, read out of
 * the package's `./backend` artefact with the analyzers below — the same
 * {@link providedPortNames} and {@link registeredNames} the tree is read with,
 * so the two derivations cannot disagree about what a registration looks like.
 *
 * **What it does when it cannot attribute one: it refuses.** A `./backend`
 * export whose own source does not declare the `registerModule` it hands out is
 * bundled or re-exported; its registrations are unreadable and the run stops at
 * exit 2, naming the package, rather than crediting it with zero names. So
 * `packages=0` means "no package is installed" and `package-names=0` means "the
 * installed packages register nothing" — neither can mean "the map stopped
 * looking".
 *
 * Usage: `tsx scripts/check-port-dependencies.ts [--list]`
 * Exit 0 = every resolved port is declared; exit 1 = at least one is not;
 * exit 2 = the walk read a residue of the module tree, saw no resolution or no
 * ledger edge at all, or could not enumerate an installed package.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';
import type { ModuleManifest } from '@endora-commerce/contracts';
import { deploymentsOnDisk } from '../src/overlay/overlay-roots.js';
import { discoverOverlayModuleManifests } from '../src/overlay/overlay-runtime.js';
import {
  buildDeactivationLedger,
  type CrossModuleRead,
  type DeactivationLedger,
  type UnassignedEdge,
} from '../src/modules/_lifecycle/services/deactivation-ledger.js';
import {
  acknowledgedPortEdgesFrom,
  nonBindingPortEdgesFrom,
  type NonBindingPortEdge,
} from '../src/modules/_lifecycle/services/gating-graph.js';
import { moduleIdOf, refuseVacuousModulePopulation } from './lib/module-population.js';
import { declaresRegisterModule, requireModuleLayout } from './lib/module-roots.js';
import {
  loadPackageDeclarations,
  packageCoverage,
  refuseUnreadablePackages,
} from './lib/package-declarations.js';
import { reportReadSize, type ReadCoverage } from './lib/read-size.js';

const SRC_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

/**
 * Names the platform registers, owned by no module: the kernel's own
 * registrations and the process-level infrastructure a composition root
 * creates. Resolving one needs no dependency declaration — the kernel is the
 * part every deployment has, and there is no manifest it could be declared in.
 *
 * **The list is hand-written, and every consequence of being on it is derived**
 * (issue #49, D-73). The list has to be hand-written: "the platform owns this
 * name" is a statement about the deployment and nothing in the tree can infer
 * it. What must not be hand-written is the belief that each entry is true —
 * being here grants two exemptions, the dependency-declaration skip in
 * `findViolations` and exclusion from feature 074's deactivation-consequence
 * ledger in `main`, and until D-73 nothing verified either. That cost a
 * production defect: `salesChannelResolutionPort` was resolved by `inventory`
 * and registered by neither root, so the channel-scoped storefront stock read
 * threw `AwilixResolutionError` on its first call, in production only, while
 * typecheck, lint and this check all read green (`composition.ts` says so in
 * its own comment).
 *
 * `findRootIssues` now sweeps this set for four findings — unsupplied,
 * divergence, owned-by-a-module and stale — over the same three supply sources
 * every composition really has: the two roots and `src/kernel/**`. Two entries
 * went on its first run: `organizationsSettingsChannelId`, whose name D-41 had
 * deleted, and `priceListsPricingCacheTtlMs`, which `price_lists` registers
 * itself and which was therefore a module-owned name laundering a cross-module
 * edge past both exemptions.
 */
export const PLATFORM_OWNED_NAMES: ReadonlySet<string> = new Set([
  'orm',
  'em',
  'emFactory',
  'redis',
  // The one connection ioredis has put into subscriber mode. Process-level
  // infrastructure exactly as `redis` is, and shared for the same reason a
  // process has one of it: a subscriber connection cannot serve commands.
  'redisSubscriber',
  // The connection a module may build a BullMQ *producer* queue on. Process
  // infrastructure exactly as `redis` is, and a separate name from it because
  // "this composition wants no queues" is a statement a root makes — the test
  // harness registers `redis` but must hand out no queue, since one built per
  // `setupBackendServer()` is never closed.
  'moduleQueueRedis',
  'eventBus',
  'commandBus',
  'apiInterceptors',
  'settingsReadPort',
  // The same kernel object as `settingsReadPort`, seen from the writing side:
  // `composeSettingsKernel` builds one `SettingsCache` and a root contributes
  // both names off it. The `settings` module reads this one at its write seam,
  // which is where the cache is dropped since issue #45 — the drop used to be
  // an EventBus subscriber, and therefore a function of dispatch order.
  'settingsCache',
  // The resolved module registry is a composition-root input by nature: which
  // modules a deployment ships is not something a module may decide.
  'resolvedModuleRegistry',
  'auditLogService',
  'commandBus',
  // Who an admin actor is, resolved differently by production and the harness
  // — which is exactly the difference a composition root exists to hold.
  'adminContextResolver',
  // `configurationTypeRegistry` left this list in T143a. It read "the root
  // creates and populates it", and the second half stopped being true: each
  // configuration type is declared by the module that owns it, from that
  // module's boot hook, so the name is `credentials`' own registration and the
  // two other contributors declare that dependency like any other.
  'credentialsSettingsPort',
  // Which channel a global-scope settings read resolves against: the
  // deployment's system-default channel, or its configured fallback. A
  // property of the deployment, not of any module.
  'settingsChannelResolver',
  'salesChannelResolutionPort',
  'salesChannelMembershipPort',
  // The channel cache the kernel resolver reads through. Composed by the root
  // via `composeSalesChannelsKernel` (T110), because channel resolution backs
  // every channel-scoped read and must not be gated on any one module.
  'salesChannelsCache',
  // The settings reader's cache and the two deployment properties the settings
  // admin surface needs: the `secret` encryption key, and the effective-state
  // reader that classifies each setting (Constitution XVII, FR-033). All three
  // are root-composed, for the same reason the channel cache is — a settings
  // read backs behaviour in nearly every module.
  'settingsSecretEncryptionKey',
  'settingsModulePresence',
  // How a committed activation flip reaches the rest of a deployment. Root-
  // shaped by nature (T125): production refreshes from the database and drops
  // the storefront cache, the harness refreshes through the cache seam because
  // it never populates `module_registrations`.
  'lifecycleActivationPropagation',
  // Two properties of a composition rather than of the pricing module: does
  // this process run a wall-clock status sweeper, and how does this deployment
  // name a non-admin caller on an audit record (T127).
  //
  // `priceListsPricingCacheTtlMs` was a third and is gone (D-73, the
  // `platform-name-owned-by-module` finding): `price_lists` registers the name
  // itself with its own default, production deliberately contributes nothing
  // and only the harness overrides it. That makes it an ordinary
  // contribution-point default, and leaving it here would have let a consumer
  // in another module resolve it with no dependency declared and no row in the
  // deactivation-consequence ledger. Nothing outside `price_lists` resolves it
  // today, which is why the correction is a deletion here rather than a move of
  // the registration.
  'priceListsEnableStatusSweeper',
  'priceListsAdminAuditContext',
  // Whether this process runs the Ergonode import and reaper consumers
  // (Principle X). A deployment decision, read at construction because it
  // decides whether the consumers are built at all (T131).
  'pimErgonodeRunWorkers',
  'productFeedsRunWorkers',
  // Pinned per composition and read at construction, so each root registers
  // them early beside the worker flag: production derives the feed base URL
  // from the environment, the harness pins one because a test asserts the
  // exact link an administrator is handed (T137).
  'productFeedsPublicBaseUrl',
  'productFeedsTokenEncryptionKey',
  // Same shape for `inventory` (T129): how this deployment names a non-admin
  // caller on an audit record.
  'inventoryAdminAuditContext',
  // Same shape for `catalog` (T142): whether this process runs the
  // bulk-operation consumer (Principle X), how it names an acting admin on an
  // audit record, and the three adapters that reach modules `catalog` must not
  // read through directly — availability bands, the image placeholder, and the
  // Meilisearch reindex production runs and the harness must not.
  'catalogRunBulkOperationWorker',
  'catalogAdminAuditContext',
  'catalogExternalAvailability',
  'catalogImagePlaceholderUrl',
  'catalogSearchReindex',
  // The storefront origin a customer-facing link points at — an invitation, a
  // set-password mail. One name, because it is one environment fact:
  // `organizations` (T138) and `customers` (T140) both send such links, and two
  // names for `STOREFRONT_BASE_URL` would be two things to keep in step.
  'storefrontBaseUrl',
  // `organizations`' remaining root-supplied input (T138): the
  // verification-token probe is a harness fact, and a route that hands back the
  // last token must not exist in production. Not something the module could
  // default.
  //
  // `organizationsSettingsChannelId` was the second and is gone (D-73, the
  // `platform-name-stale` finding). D-41 deleted the name — `organizations`
  // reads its settings through the kernel's channel resolver now, and
  // `organizations/backend.ts` says why in its own comment: "a DI name that
  // carries a sentinel is one no static check can see". The exemption outlived
  // the name by two features, pre-clearing whatever landed on that string next.
  'organizationsExposeTestProbe',
]);

/**
 * Ports a **composition root** registers on behalf of the module that owns the
 * name. Each entry is a stand-in for a `ctx.di.providePort` call in that
 * module's `backend.ts`, and the staleness sweep in `main` deletes it for you
 * the day the owner makes that call.
 *
 * **What the sweep does not see, and what that costs the comments here.** It
 * fires on one condition only: the owner's `backend.ts` registers the name
 * itself. All 65 modules are composed through the container now, so "the owner
 * is converted" and "the owner provides this port" are two different facts, and
 * only the second one is checked. An entry can therefore be correct while the
 * sentence next to it is not — several said "still hand-wired" of a module that
 * had been converted for weeks. Write each reason as a statement about *this
 * name* (who owns it, why a root supplies it, what would let the entry go), not
 * as a statement about the owner's conversion status, which nothing here
 * verifies.
 */
export const HOST_REGISTERED_PORTS: Readonly<Record<string, string>> = {
  // `requireAdmin` and `requireAdminAny` are gone from here: `auth` provides
  // them itself since T078, and the staleness check below fails the build if an
  // entry outlives its owner's conversion.
  //
  // Registered as `undefined` today: blog ships no storefront ports and both
  // composition roots pass nothing. The name is blog's own.
  blogStorefrontDeps: 'blog',
  // The lazy accessor `_i18n` and `admin_actions` walk to reconcile every
  // module's bundles and palette actions. It is an accessor rather than the
  // registry because `_lifecycle`'s orchestrator is built after both of them, so
  // the value does not exist at the moment either module registers; a root
  // supplies the closure that will read it later.
  //
  // This comment used to predict that the entry goes "when `_lifecycle`
  // provides the accessor as a port of its own". **D-98.5 ruled the other way**:
  // which modules a deployment ships is a composition-root input, so there is no
  // manifest port to come. The entry retires when both consumers read
  // `resolvedModuleRegistry` — whose entries already carry `filePath` — and the
  // accessor with the chicken-and-egg it exists to break both go away.
  lifecycleManifestRegistry: '_lifecycle',
  // `requireCustomer` is gone from here too (issue #43): `auth` provides it
  // beside the two admin guards, the roots declare none, and the 16 consumers
  // declare the edge in their manifests like any other port.
  //
  // How a composition names the acting admin on an audit record. Root-shaped
  // by nature — production reads `request.actor`, the harness `request.testActor`
  // — so it is a composition input rather than any module's property.
  adminAuditActorResolver: 'auth',
  // The sales-channel code⇄id lookup `google_analytics` resolves. `sales_channels`
  // owns the name and has been container-composed since T110, but it provides
  // `salesChannelsService` rather than this two-method projection of it, so each
  // root still assembles the projection. The entry goes when the module provides
  // the projection itself — not when it converted, which it already has.
  salesChannelCodeIdPort: 'sales_channels',
  // How a composition resolves the calling customer. Root-shaped for the same
  // reason `requireCustomer` is; owned by `auth` in principle.
  customerContextResolver: 'auth',
  // Who is asking and who is moderating, in `customers`' own shapes — the same
  // actor-shaped family, named as such by both roots at the point they register
  // them. They were absent from this table until issue #90: `customers` reads
  // them through a cradle accessor, which this check could not see, so nothing
  // checked that both compositions supply them.
  customerActorResolver: 'auth',
  customerModerationActorResolver: 'auth',
  // The calling customer as a bare id. Root-shaped for the same reason
  // `customerContextResolver` is — production reads `request.actor`, the harness
  // `request.testActor` — and owned by `auth` in principle. Read by the four
  // payment gateways (wave 3).
  customerAccountIdResolver: 'auth',
  // Which organizations a sales-rep admin may see (T141) — actor-shaped like
  // the four above. Its transactional-sender twin drained in T120.
  ordersAdminScopeResolver: 'auth',
  // The calling customer's Organization, or `null`. The fourth member of the
  // family above and root-shaped for the same reason, but softer than all of
  // them on purpose: it answers `null` for anonymous traffic *and* for a
  // Customer with no Organization, where `customerContextResolver` throws 401
  // or 422. That difference is the point — it is read on restriction checks
  // (T138), and catching a throw to mean "unrestricted" is how a fail-closed
  // gate becomes fail-open.
  customerOrganizationIdResolver: 'auth',
  // The admin-editable transactional sender, as a getter because
  // `transactional_emails` announces it after `organizations` composes. Same
  // shape and same owner as `inventoryTemplateEmail`; the two drain together.
  // Who is asking, in the cart's own shape (signed-in customer or anonymous
  // cookie token). The identical divergence already recorded for
  // `customerContextResolver` and `customerAccountIdResolver`, same owner, and
  // it drains with them (T136).
  cartActorResolver: 'auth',
  // **Drained, and the notes kept because the drain order is the record of how
  // this table empties.** No root bridges any of these names now: the guard that
  // refuses a cart mutation for an organization that may not transact
  // (`organizations`), `inventory`'s warehouse-assignment adapter (T129), its
  // transactional-email twin (T120, replaced by one `templateEmailPort` for
  // every module that sends unscoped template mail), and the nine `catalog`
  // names `pim_ergonode` used to read, `catalogAttributeReadPort` and
  // `catalogQueryPort` among them (T142).
  // The asset service the Ergonode media pipeline stores through.
  assetsLibraryService: 'assets_library',
  // How this composition assembles a feed row: opening a storage backend,
  // resolving availability bands, expanding a category through the catalog
  // port, and turning asset ids into stable public URLs (T137). Each crosses a
  // boundary `product_feeds` must not reach through directly.
  productFeedsBridge: 'product_feeds',
  // Drained as well: `shopping_lists`' four cross-module reaches (T133) — the
  // RFQ service a list converts into, the org restriction the preference routes
  // re-check against, the lazy order service one-click buy places through, and
  // the sink that hands its own service back to `carts`.
  // `quote_requests`' three composition-shaped inputs (T132): who is asking
  // (production reads `request.actor`, the harness `request.testActor`), the
  // organization's tax rate, and the subtree the RFQ admin scope rolls up over.
  rfqCustomerContextResolver: 'auth',
  rfqAdminContextResolver: 'auth',
  rfqTaxRateResolver: 'taxes',
  // Inherited credit limits (feature 056). Owned by `organizations`, still
  // hand-wired; the entry goes when that module converts.
  // The composed attribute read model (feature 061). Owned by `catalog`, still
  // hand-wired; the entry goes when that module converts.
  // `megamenu`'s existence checks and URL lookups against `catalog`, `cms` and
  // `assets_library` tables. Root-owned by design — see the note in
  // `megamenu/backend.ts` on why they must not move into the module.
  megamenuValidatorDeps: 'megamenu',
  megamenuStorefrontDeps: 'megamenu',
  // `catalog`'s query service. Root-built until that module converts — see the
  // note in `promotions/backend.ts` on why this is the last live instance of it.
  // The organization-status gate feature 026 US5 added: an org-targeted
  // promotion only fires for an active Organization. Owned by `organizations`.
  // The operator presence axis the command palette filters on, plus the
  // generation of the data it answers from (issue #225). A root's to supply —
  // which modules a deployment ships is not a module's business — and one name
  // rather than two, so a root cannot wire the reading without the generation.
  modulePresenceProbe: '_lifecycle',
  // Every way `pwa` reaches outside itself — the `assets_library` upload facade,
  // the sales-channel code⇄id helpers, the admin audit context and the FR-024
  // push-target resolvers — contributed as one bridge by a root.
  pwaBridge: 'pwa',
  // Whether this composition runs the push-delivery consumer. A deployment
  // decision: production follows `BACKEND_ROLE`, the harness runs none.
  pwaRunWorkers: 'pwa',
  // How this composition reaches outside the invoices module.
  invoicesBridge: 'invoices',
  // How this composition settles a return and who is asking: four small
  // adapters over `payments`, `invoices`, `credit_limits` and `orders`, plus
  // the actor resolvers and the notifier.
  returnsBridge: 'returns',
  // The seller's NIP, read from the invoices seller settings. A root's, because
  // the setting belongs to `invoices` and the format handling is composition
  // policy rather than a KSeF concern.
  ksefSellerNipResolver: 'ksef',
  newsletterBridge: 'newsletter',
  searchRunWorkers: 'search',
  // Whether this composition runs the webhook delivery consumer (T143a). The
  // worker itself is `webhooks`' own now; only the deployment half — production
  // follows `BACKEND_ROLE`, the harness runs none — stays a root's.
  webhooksRunWorkers: 'webhooks',
};

/**
 * Stand-in recorded when a `lazyPort` name is not a string literal. It is owned
 * by nobody on purpose, so it surfaces as an `unowned-name` violation naming the
 * file and line — the same way a genuinely unregistered name does.
 */
export const NON_LITERAL_PORT_NAME = '<computed>';

/**
 * *When* a resolution happens, which is what the gated-port rule below keys on
 * (feature 072, D-39).
 *
 * `kind` answers "once or per call"; this answers "before or after the platform
 * serves its first request". They are independent — a boot-hook read is
 * genuinely deferred and still fatal — and only this one sees the failure that
 * took the backend down twice:
 *
 *  - `boot` — lexically inside a `ctx.onBoot` hook. `runBootHooks()` does not
 *    consult module presence, so the hook runs whatever the module's effective
 *    state is.
 *  - `wiring` — the body of the `ctx.routes` callback itself. It runs inside
 *    `buildServer`, unconditionally: `defineModuleRoutes` gates *requests*, not
 *    the registration. A read inside a handler is not this — that is `call`.
 *  - `call` — everything else: a request handler, a subscriber, a worker
 *    processor, a method on a service.
 */
export type ResolutionSite = 'boot' | 'wiring' | 'call';

export interface PortResolution {
  readonly moduleId: string;
  readonly name: string;
  readonly file: string;
  readonly line: number;
  /**
   * How the name is read, which is the whole point of the capture rule below.
   *
   *  - `captured` — destructured from a factory's cradle parameter, so Awilix
   *    resolves it once, when the registration is first constructed.
   *  - `deferred` — read through `ctx.cradle<C>()`, so it resolves at the
   *    moment of use.
   */
  readonly kind: 'captured' | 'deferred';
  /** See {@link ResolutionSite}. */
  readonly site: ResolutionSite;
  /**
   * **Which seam the name was written into**, which is a different question
   * from `kind` and from `site` and is the one `check-port-shape`'s third
   * signal keys on (issue #196, D-98.2).
   *
   *  - `lazyPort` — `lazyPort<T>(ctx, 'name')`, the shape a module uses to
   *    reach a *published* port. The name is a literal a developer copied out
   *    of a contract's doc block, which is exactly why it is checkable against
   *    one.
   *  - `cradle` — every other shape this function reads: a factory's cradle
   *    parameter, `ctx.cradle<C>()`, a module-local alias of either. Those are
   *    **contribution seams**, where a module reads a name a composition root
   *    or the kernel supplies, and where naming a published contract would be
   *    the wrong requirement — four of the five names the two populations
   *    disagree on are of that kind.
   *
   * Recorded here rather than re-derived by the consumer so that "this
   * resolution is a `lazyPort`" is decided in the one place that already
   * decides it. A predicate that exists twice can go half-missing while the
   * check still prints `violations=0`.
   */
  readonly via: 'lazyPort' | 'cradle';
}

/**
 * The only names a module may safely **capture**.
 *
 * These are registered by a composition root before any module composes — the
 * ORM-derived names and the process-level infrastructure created at the top of
 * a root — so destructuring them in a factory cannot resolve too early, and
 * none of them is a transient port gate.
 *
 * Every other name must be read through `ctx.cradle<C>()` at the point of use.
 * Two distinct failures make this a rule rather than a preference, and feature
 * 072 hit both repeatedly:
 *
 *  1. **Lifetime.** A port registered with `providePort` is a transient gate
 *     that consults the module's effective state. Awilix's strict mode refuses
 *     a singleton that captures one — correctly, because a captured gate keeps
 *     answering after the operator switches its module off.
 *  2. **Ordering.** A name a root registers may not exist yet when a module
 *     registers: a root's contribution slot is *after* `composeModules`, which
 *     is where the module bodies run. Capturing resolves against a name that is
 *     not there, and the failure is a boot crash rather than a type error.
 *
 * Both are invisible at the call site and neither is caught by `tsc`.
 */
export const CAPTURABLE_NAMES: ReadonlySet<string> = new Set([
  'orm',
  'em',
  'emFactory',
  'redis',
  'redisSubscriber',
  'moduleQueueRedis',
  'eventBus',
  'commandBus',
  'auditLogService',
  'resolvedModuleRegistry',
  'apiInterceptors',
  // Plain deployment values rather than gates: a string read from the
  // environment, and a reader over the lifecycle's in-memory state. Neither is
  // a module port, so capturing one cannot outlive a module being switched off.
  'settingsSecretEncryptionKey',
  'settingsModulePresence',
  // Plain deployment values that decide what gets *constructed*, so they cannot
  // be deferred past construction: whether a wall-clock sweeper interval starts
  // at all, and the TTL the pricing LRU is built with (T127).
  'priceListsEnableStatusSweeper',
  'priceListsPricingCacheTtlMs',
  // Same category: a plain boolean that decides whether the Ergonode import and
  // reaper consumers are constructed at all, so it cannot be deferred past
  // construction (T131).
  'pimErgonodeRunWorkers',
  // Same category: whether this process runs the feed generation and reaper
  // consumers, read at construction because it decides whether they are built
  // at all (T137).
  'productFeedsRunWorkers',
  // Same category again: whether this process runs the bulk-operation consumer,
  // read at construction because it decides whether it is built at all (T142).
  'catalogRunBulkOperationWorker',
  // Pinned per composition and read at construction, so they are registered
  // early alongside the worker flag: production derives the feed base URL from
  // the environment, the harness pins one because a test asserts the exact link
  // an administrator is handed (T137).
  'productFeedsPublicBaseUrl',
  'productFeedsTokenEncryptionKey',
  // The storefront origin a customer-facing link points at, and whether this
  // deployment exposes the `organizations` verification-token probe. Plain
  // deployment values in the sense this list means: a string read from the
  // environment and a boolean a root pins, neither of them a gate, so capturing
  // one cannot outlive a module being switched off. `customers` and
  // `organizations` both read them at construction, through the cradle accessor
  // this check learned to follow in issue #90.
  'storefrontBaseUrl',
  'organizationsExposeTestProbe',
]);

/**
 * Captures that are allowed, keyed `<moduleId>:<name>`, each with the reason.
 *
 * The escape hatch exists because one thing genuinely cannot be deferred: a
 * **presence** decision. `lazyPort` forwards method calls, so it can defer
 * *what a collaborator does*; it cannot defer *whether a collaborator exists*,
 * because a proxy is always there. A factory that branches on
 * `x === undefined ? {} : { x }` has to read `x` at construction.
 *
 * Keep this list short and keep the reasons concrete. An entry is a statement
 * that the composition order is load-bearing at that point, which is exactly
 * the thing the rest of this check exists to eliminate — so each one is a debt,
 * not a design.
 */
export const ALLOWED_CAPTURES: Readonly<Record<string, string>> = {
  'credentials:credentialsSettingsPort':
    'Presence decides the constructor shape: an absent port must be an omitted ' +
    'property rather than an explicit `undefined`, which `exactOptionalPropertyTypes` ' +
    'treats as a different type. Both roots register the port two lines before they ' +
    'resolve `credentialsService`, and that ordering is load-bearing — it goes when ' +
    '`settings` converts and the port stops being root-registered.',
};

/**
 * Gated ports still resolved in a `ctx.routes` body, keyed `<moduleId>:<name>`
 * — the standing inventory of D-39's second hazard, **meant to drain**.
 *
 * Route *registration* runs inside `buildServer` whatever the module's
 * effective state is; only requests are gated. So a destructured port here asks
 * the gate while the app is being wired, and an operator who switched the owner
 * off stops the next start instead of stopping the routes. `comparisons` and
 * `credit_limits` shipped exactly that and were fixed in D-40; this table is the
 * other ten, found when the check learned to see the shape.
 *
 * The fix is one line each — hand the registrar `lazyPort<T>(ctx, '<name>')`
 * instead of the destructured value, as `credit_limits/backend.ts:88` now does.
 * Inside a handler the gate is open by construction, and a closed one is the 503
 * it was always supposed to be.
 *
 * **The table is empty, and the constant stays.** Issue #90 drained all ten
 * — one line each, in eight modules — along with the three `carts` reads and
 * the `settings` one that only became visible when this check learned to follow
 * a module-local cradle alias. What remains is the ratchet: a **new**
 * occurrence fails the build, and the entry that would silence it has to be
 * written down here with a reason.
 * Ports owned by a `nonDeactivatable` module are not here and never will be —
 * that exemption is computed from the manifests (see {@link CheckInput}).
 */
export const WIRING_RESOLUTIONS_TO_DRAIN: ReadonlySet<string> = new Set([]);

/**
 * Resolutions that existed all along and became **visible** only when this check
 * learned to follow a module-local cradle alias (issue #90), keyed
 * `<moduleId>:<name>` — **meant to drain**, and not the same debt as the table
 * above.
 *
 * The wiring table's entries each cost one line to fix. These do not: every one
 * of them is a real edge whose repair is a manifest or lifecycle decision with
 * an operator-visible consequence, and making that decision inside the MR that
 * widened a static check would be smuggling it in. So each entry says what the
 * edge is, what the obvious repair would break, and what would have to be
 * decided first.
 *
 * An entry suppresses **every** violation kind for that pair, because the two
 * kinds these produce are two views of one fact — a cross-module read the
 * manifests do not model. Keep that in mind when adding one: it is the widest
 * suppression in this file, and the staleness sweep in `main` deletes it for you
 * the moment the site stops resolving.
 */
export const ALIAS_HIDDEN_RESOLUTIONS: Readonly<Record<string, string>> = {
  // **Empty, and the constant stays as the ratchet.** Eight entries drained in
  // two steps, and the two steps are worth telling apart because they are two
  // different repairs.
  //
  // `auth:apiKeyResolver`, `catalog:requireApiKey`, `catalog:requireBoundApiKey`
  // and `customers:orderListServiceAccessor` were the same shape — a real edge
  // whose ordinary declaration would have made the owner's activation control
  // unusable — and D-44 gave that shape a spelling:
  // `manifest.nonBindingDependencies`, with the degradation written down, a
  // presence probe at the call site and an off-state test per edge. They are
  // declared, not suppressed, now.
  //
  // The other four were `orders` reading two method modules' plain
  // `ctx.di.register` names **at construction**, so their violation was
  // `captured-name`, which no manifest entry can clear: the values went into
  // `commerceModule`'s options object and kept answering after their owner was
  // switched off. That constructor takes accessors now (feature 074, FR-024),
  // three of the edges are declared as `degrades-without`, and the fourth —
  // `orders:shippingMethodEligibility` — turned out to be an option nothing in
  // the plugin ever read, so it was deleted rather than deferred.
};

/**
 * Port edges a module may resolve **without** declaring the owner, because
 * declaring it would close a manifest cycle.
 *
 * This used to be a constant here, and that was the defect: it was the only
 * record that the edges existed, so the flip-time refusals could not see them
 * and an operator could switch `price_lists` off underneath `catalog`'s
 * `pricingService` resolution with nothing to stop them (feature 073,
 * Amendment A1). The edges now live in the declaring module's manifest, as
 * `acknowledgedDependencies`, and this check and the refusal read the same
 * declarations — the runtime port-layer twin of
 * `test/unit/db/acknowledged-fk-edges.ts`.
 *
 * Keep the set as short as that one: an entry is a statement that the edge is
 * real and mutual, not that nobody has looked.
 */
export function acknowledgedPortEdges(
  manifests: readonly ModuleManifest[],
): Record<string, string> {
  return Object.fromEntries(
    acknowledgedPortEdgesFrom(manifests).map((edge) => [
      `${edge.moduleId}:${edge.port}`,
      edge.reason,
    ]),
  );
}

/**
 * Port edges a module resolves and deliberately keeps out of `dependencies`
 * because the owner disappearing is a state it handles — D-44.
 *
 * Merged into the same keyed lookup `acknowledgedPortEdges` feeds, because the
 * ownership rule this check enforces takes no interest in which of the three
 * arrays the declaration lives in: *the name you read belongs to someone, and
 * you said whose*. What differs is everything downstream — an acknowledged edge
 * reaches the flip-time refusal, one of these reaches nothing.
 *
 * Keyed `<resolving module>:<name>` and **direct only**: there is no closure to
 * walk, so contributing to a module does not inherit that module's own
 * dependencies. That is deliberate — the declaration is about one name.
 */
export function nonBindingPortEdges(
  manifests: readonly ModuleManifest[],
): Record<string, string> {
  return Object.fromEntries(
    nonBindingPortEdgesFrom(manifests).map((edge) => [
      `${edge.moduleId}:${edge.name}`,
      edge.reason,
    ]),
  );
}

export interface NonBindingIssue {
  readonly kind:
    | 'wrong-owner'
    | 'nothing-resolves'
    | 'contribution-registry-without-policy'
    | 'contribution-over-a-gated-port'
    | 'contribution-not-pushed-at-boot';
  readonly edge: NonBindingPortEdge;
  readonly detail: string;
}

export interface NonBindingInput {
  readonly edges: readonly NonBindingPortEdge[];
  readonly owners: ReadonlyMap<string, string>;
  readonly providedPorts: ReadonlyMap<string, string>;
  readonly resolutions: readonly PortResolution[];
  /** Defaults to {@link CONTRIBUTION_POLICY_STATED}; a fixture supplies its own. */
  readonly contributionPolicies?: Readonly<Record<string, 'skip' | 'honour'>> | undefined;
}

/**
 * What a `nonBindingDependencies` entry has to be true of, checked against the
 * tree rather than taken on the author's word.
 *
 * Two of the five are about the declaration itself — it names the module that
 * really owns the name, and something really resolves it — because the entry
 * clears an `undeclared-dependency` outright and a wrong or stale one clears a
 * resolution nobody declared. The other three are D-44 §7's guard-rails on
 * `contributes-to`, and they exist because that kind withdraws the refusal on
 * the strength of an argument that only holds for a push into a stated-policy
 * registry. `degrades-without` withdraws it on the strength of a written
 * degradation and an off-state test, which no static check can see, so it is
 * held only to the first two.
 */
export function findNonBindingIssues(input: NonBindingInput): NonBindingIssue[] {
  const policies = input.contributionPolicies ?? CONTRIBUTION_POLICY_STATED;
  const issues: NonBindingIssue[] = [];
  for (const edge of input.edges) {
    const sites = input.resolutions
      .filter(
        (resolution) =>
          resolution.moduleId === edge.moduleId && resolution.name === edge.name,
      )
      .map((resolution) => resolution.site);

    const owner = input.owners.get(edge.name);
    if (owner !== undefined && owner !== edge.dependsOn) {
      issues.push({
        kind: 'wrong-owner',
        edge,
        detail: `'${edge.name}' is registered by '${owner}', not by '${edge.dependsOn}'`,
      });
    }
    if (sites.length === 0) {
      issues.push({
        kind: 'nothing-resolves',
        edge,
        detail: `'${edge.moduleId}' resolves no name '${edge.name}' anywhere`,
      });
      continue;
    }
    if (edge.kind !== 'contributes-to') continue;

    if (input.providedPorts.get(edge.name) !== undefined) {
      issues.push({
        kind: 'contribution-over-a-gated-port',
        edge,
        detail: `'${edge.name}' is registered with di.providePort, so resolving it asks a gate`,
      });
    } else if (policies[`${edge.dependsOn}:${edge.name}`] === undefined) {
      issues.push({
        kind: 'contribution-registry-without-policy',
        edge,
        detail: `'${edge.dependsOn}' states no enumeration policy for '${edge.name}'`,
      });
    }
    if (sites.some((site) => site !== 'boot')) {
      issues.push({
        kind: 'contribution-not-pushed-at-boot',
        edge,
        detail: `resolved at ${[...new Set(sites)].sort().join(', ')}, not only from a boot hook`,
      });
    }
  }
  return issues;
}

export function describeNonBindingIssue(issue: NonBindingIssue): string {
  const { edge } = issue;
  const head = `  - ${edge.moduleId} declares ${edge.dependsOn}:${edge.name} as \`${edge.kind}\` — ${issue.detail}.`;
  const tail: Record<NonBindingIssue['kind'], string> = {
    'wrong-owner':
      `    The entry clears the ownership rule for '${edge.moduleId}:${edge.name}' outright, so a\n` +
      `    mis-attributed owner clears a resolution the manifest never mentions. Name the\n` +
      `    module that registers it.`,
    'nothing-resolves':
      `    A declaration with no resolution under it is a claim about the tree that is no\n` +
      `    longer true, and it will go on clearing the rule for whatever takes the name next.\n` +
      `    Delete it.`,
    'contribution-registry-without-policy':
      `    A \`contributes-to\` edge rests on the host filtering an absent contributor's entry\n` +
      `    at enumeration. A host that states no such enumeration policy may act on it, and\n` +
      `    this edge has withdrawn the refusal that would have stopped it. State the policy at\n` +
      `    the registry class and list it in CONTRIBUTION_POLICY_STATED, or declare the edge in\n` +
      `    \`dependencies\`.`,
    'contribution-over-a-gated-port':
      `    A port is a transient gate, and a gate that says no throws rather than being absent.\n` +
      `    That is a pull with a failure mode, not an inert push: it needs \`degrades-without\`\n` +
      `    with the behaviour written in \`whenAbsent\`.`,
    'contribution-not-pushed-at-boot':
      `    Reading an answer out of an ungated registry is a pull. \`contributes-to\` is for a\n` +
      `    push, which happens once from a boot hook and reads nothing back; anything resolved\n` +
      `    at call or wiring time needs \`degrades-without\` and an off-state test for the edge.`,
  };
  return `${head}\n${tail[issue.kind]}`;
}

/**
 * Contribution registries whose host states an absent-contributor policy at the
 * class, keyed `<owner>:<registration name>` — D-44 §7, guard-rail 1.
 *
 * A `contributes-to` declaration rests on one argument: the descriptor a switched
 * off module pushed is filtered by the **host** at enumeration, so the edge
 * cannot break anybody in either direction. That argument holds only for a host
 * that has decided, and written down, what it does with an absent contributor's
 * entry — the requirement `test/unit/kernel/contribution-seams.test.ts` pins for
 * the converted registries. A registry without one may act on the entry, and the
 * declaring module has withdrawn the refusal that would have stopped it.
 *
 * The table covers **both** shapes an ungated contribution seam takes in this
 * tree: a container registration a contributor resolves, and a process
 * singleton a contributor imports and pushes into. The second shape is not a
 * lesser one — it is how the payment family is wired — and the ledger holds it
 * to the same requirement, because the hazard is identical: an entry that
 * outlives the module that pushed it.
 *
 * The value is what the host does, so a reader does not have to open the class
 * to learn whether an absent owner's entry still counts.
 */
export const CONTRIBUTION_POLICY_STATED: Readonly<Record<string, 'skip' | 'honour'>> = {
  // Honoured: the definition row is created from the platform axis regardless,
  // so skipping the defaults would create it with empty content instead.
  'transactional_emails:emailDefaultsPort': 'honour',
  // Honoured: referential integrity, not a surface — a switched-off module still
  // owns the rows that point at the asset.
  'assets_library:assetReferenceRegistry': 'honour',
  'cms:cmsReferenceRegistry': 'honour',
  'megamenu:megamenuReferenceRegistry': 'honour',
  // Honoured, same ground, one dictionary each (feature 077, D-87): a module an
  // operator switched off still owns the rows carrying the country, language or
  // currency code, so its descriptor still refuses the delete. Skipping would
  // let the operator delete the entry underneath it and get the dangling
  // reference back on reactivation.
  'dictionaries:countryReferenceRegistry': 'honour',
  'languages:languageReferenceRegistry': 'honour',
  'currencies:currencyReferenceRegistry': 'honour',
  // Skipped: a surface. `PromptActionToolRegistry.visibleFor` drops every tool
  // whose recorded owner is not effectively present, and `PlanExecutorService`
  // re-checks at execution.
  'prompt_actions:promptActionToolRegistry': 'skip',
  // Skipped: folding progress reads the contributor's own tables through the
  // contributor's own services, so a module that is off must not be read
  // through. Nothing is dropped with the resolver — the absent behaviour was
  // already the documented one (the request reports no progress and expires on
  // the assistant's TTL), there is no obligation to record and no money on the
  // other side. `contributors()` stays presence-blind for diagnostics.
  'prompt_actions:promptActionBulkProgressRegistry': 'skip',
  // Skipped: a surface, and the worked example of the split the class writes
  // down — `get`, `resolve` and `list` answer as if an absent owner's adapter
  // were not registered, while `entry`, `ownerOf` and `listAll` stay
  // presence-blind so the admin screen keeps showing the method and the reason
  // it is unavailable (issue #96).
  'payment_methods:paymentAdapterRegistry': 'skip',
  'delivery_methods:shippingAdapterRegistry': 'skip',
  // Honoured, and the entry says so because there is nothing to skip: neither
  // order-status registry holds a contributed entry at all. The option set is
  // `orderStatusSchema`, fixed at compile time, and the cross-module reads are
  // guards — `payments` and `shipments` ask `has` before moving an order into
  // the status a settlement names. A skip would leave a paid or shipped order
  // silently in its old status, and every code in the table is one live orders
  // are already in. The buyer-facing consequence of the owning module being off
  // is carried by that module's own catalogue seam and by `orders`' declared
  // sentence, not here (issue #129).
  'payment_methods:paymentOrderStatusRegistry': 'honour',
  'delivery_methods:shippingOrderStatusRegistry': 'honour',
  // Skipped: a surface. A configuration type is what the credentials screen
  // offers to configure and what a write is validated against, so a capability
  // an operator switched off is neither offered nor creatable. The descriptor
  // already carried its `ownerModule`, so the host had the contributor recorded
  // and was simply not consulting it. `entry`, `ownerOf`, `isRegistered` and
  // `listAll` stay presence-blind, because a stored configuration keeps its row
  // and its audit snapshot has to keep knowing which of its values is a secret
  // (issue #129).
  'credentials:configurationTypeRegistry': 'skip',
  // Skipped: a PSP handler whose module is switched off must not charge or
  // refund through that PSP's API. The refund is not dropped with it —
  // `PaymentRefundProvider` records `pending_manual` naming the module, which
  // is what a deployment that never installed the gateway already does, so the
  // obligation stays on the platform's books and a person settles it.
  'payments:gatewayRefundRegistry': 'skip',
};

/**
 * Ungated cross-module registrations whose owner states **no** policy for its
 * own absence, keyed `<owner>:<name>` — the standing debt behind the ledger's
 * `registry-without-policy` shape, and a two-way ratchet like every other table
 * in this file.
 *
 * Each entry is a live fail-open: the reading module goes on getting an answer
 * out of a module an operator switched off. None of them is fixed by a
 * declaration — the owner has to decide what an absent owner's entry, or an
 * absent owner's service, does at enumeration and write it at the class, which
 * is a decision with an operator-visible consequence and belongs to the module
 * that owns the name.
 *
 * Two things drain an entry: the owner states a policy, or the owner becomes
 * non-deactivatable, at which point the edge leaves the ledger entirely because
 * the flip it describes cannot happen (FR-021). The staleness sweep in `main`
 * deletes an entry nothing reads any more.
 */
export const REGISTRY_POLICIES_UNSTATED: Readonly<Record<string, string>> = {
  // Empty, and by two different routes that landed together. Three entries —
  // `payment_methods`/`delivery_methods` order-status references and
  // `credentials:configurationTypeRegistry` — were answered by their owners
  // stating a policy. The fourth, `email:emailMailer`, drained without anybody
  // writing one: `email` declared itself non-deactivatable (074, C3 — a
  // transport a business configures rather than switches off), so the flip the
  // entry described cannot happen and the edge left the ledger.
  //
  // Two-way, like the others: a new ungated cross-module registry whose owner
  // states nothing fails the build, and an entry here that no longer describes
  // one fails too.
};

export interface PortViolation {
  readonly kind:
    | 'undeclared-dependency'
    | 'unowned-name'
    | 'captured-name'
    | 'gated-port-at-boot'
    | 'gated-port-at-wiring';
  readonly resolution: PortResolution;
  readonly owner: string | null;
}

function walk(dir: string, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walk(full, out);
    } else if (name.endsWith('.ts') && !name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

/**
 * The owning module id of a source file, over every root a module can live in.
 *
 * Three shapes, in order. The two anchored regexes answer for the application's
 * own trees — a deployment overlay first, then the core module tree — and both
 * key on `/src/`, so they say nothing about a module that has become a
 * **package** (feature 080, T040a). The third is `lib/module-population.ts`'
 * `moduleIdOf`, the same segment reader the population floor uses, and it is
 * what makes a path like `packages/modules/blog/src/services/x.ts` attribute to
 * `blog` instead of to nobody.
 *
 * That fallback is not cosmetic. Without it a package's files are read by the
 * walk, satisfy the floor, and are then attributed to `null` — which for every
 * consumer here means *not a module*, so the check judges none of them and
 * reports clean. That is issue #215's failure one layer in, and it is why
 * `resolveModuleLayout` refuses a package root whose location the segment
 * reader cannot attribute rather than letting it through unnamed.
 */
export function moduleOf(file: string): string | null {
  const overlay = /\/src\/apps\/[^/]+\/modules\/([^/]+)\//.exec(file);
  if (overlay) return overlay[1] ?? null;
  const core = /\/src\/modules\/([^/]+)\//.exec(file);
  if (core) return core[1] ?? null;
  return moduleIdOf(file);
}

/** `ctx.di.register` → `di.register`; used to match on the tail, not the receiver name. */
function calleeTail(node: ts.CallExpression): string {
  const expression = node.expression;
  if (!ts.isPropertyAccessExpression(expression)) return '';
  const inner = expression.expression;
  const prefix = ts.isPropertyAccessExpression(inner) ? `${inner.name.text}.` : '';
  return `${prefix}${expression.name.text}`;
}

/** Every registration name a module claims: `di.register` keys plus `di.providePort`. */
export function registeredNames(source: string, file: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const tail = calleeTail(node);
      const [first] = node.arguments;
      if (tail === 'di.register' && first && ts.isObjectLiteralExpression(first)) {
        for (const property of first.properties) {
          if (property.name && ts.isIdentifier(property.name)) names.push(property.name.text);
          else if (property.name && ts.isStringLiteral(property.name)) names.push(property.name.text);
        }
      }
      if (tail === 'di.providePort' && first && ts.isStringLiteral(first)) {
        names.push(first.text);
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return names;
}

/**
 * The names a module registers as **gated ports** (`di.providePort`), which is
 * the subset a composition root must never re-register.
 *
 * The distinction is the whole of the shadowing rule below. `di.register` is
 * how a module declares a *contribution point* — a name it defaults, expecting
 * a root that has something better to override it — so a root registering one
 * of those is the design working. `di.providePort` wraps the resolver in the
 * presence gate, and a root registration replaces the gate with a plain value.
 */
export function providedPortNames(source: string, file: string): string[] {
  return providedPorts(source, file).map((port) => port.name);
}

/** One `ctx.di.providePort<T>('name', …)` call, with the contract it names. */
export interface ProvidedPort {
  /** The container name, always a string literal (a computed one is skipped). */
  readonly name: string;
  /**
   * The published contract the registration is checked against, when the call
   * carries a type argument. `null` for the 53 that do not — those compare
   * nothing (Phase-P unreached-port audit, A12).
   */
  readonly typeName: string | null;
  readonly line: number;
}

/**
 * Every gated registration a file makes, with its type argument.
 *
 * The single expression of "this call is a `providePort`" in the tree.
 * `providedPortNames` above and `check-port-shape`'s container-name signal both
 * come through here rather than each writing the predicate again: a check whose
 * decision exists in two places can go half-missing without its red proof
 * noticing, which is how `check:nul-bytes` kept printing `violations=0` with its
 * rule mutated.
 */
export function providedPorts(source: string, file: string): ProvidedPort[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const ports: ProvidedPort[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeTail(node) === 'di.providePort') {
      const [first] = node.arguments;
      if (first && ts.isStringLiteral(first)) {
        const [typeArgument] = node.typeArguments ?? [];
        ports.push({
          name: first.text,
          typeName:
            typeArgument && ts.isTypeReferenceNode(typeArgument) &&
            ts.isIdentifier(typeArgument.typeName)
              ? typeArgument.typeName.text
              : null,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        });
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return ports;
}

type FunctionLike =
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.FunctionDeclaration
  | ts.MethodDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionLike {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node)
  );
}

/** Is `node` the first argument of a `ctx.<seam>(…)` call? */
function isCallbackOf(seam: string, node: ts.Node): boolean {
  const parent = node.parent;
  return (
    parent !== undefined &&
    ts.isCallExpression(parent) &&
    calleeTail(parent) === seam &&
    parent.arguments[0] === node
  );
}

/**
 * Where in the module's lifecycle this read happens — see {@link ResolutionSite}.
 *
 * `boot` is lexical and deliberately wide: `lazyPort` defers to the method
 * call, and inside a boot hook that call is two lines down. All seven
 * `emailDefaultsPort` contributors had exactly that shape, and every one of
 * them would have failed the boot had the port stayed gated.
 *
 * `wiring` is narrow on purpose: only the `ctx.routes` callback's own body,
 * because that is what runs during `buildServer`. Anything nested one function
 * deeper — a route handler, an `onRequest` hook, a preHandler — runs per
 * request, where a gate is exactly what should be asked.
 */
function siteAt(node: ts.Node): ResolutionSite {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (isCallbackOf('onBoot', current)) return 'boot';
  }
  let enclosing: ts.Node | undefined = node.parent;
  while (enclosing && !isFunctionLike(enclosing)) enclosing = enclosing.parent;
  if (enclosing && isCallbackOf('routes', enclosing)) return 'wiring';
  return 'call';
}

/**
 * How a local name that stands for the container cradle is read back.
 *
 *  - `object` — the cradle itself: `const cradle = ctx.cradle<C>()`, or the
 *    first parameter of an `asFunction` factory, which Awilix *is* the cradle.
 *    Reads are written `cradle.name`.
 *  - `accessor` — a zero-argument function returning the cradle:
 *    `const cradle = (): C => ctx.cradle<C>()`. Reads are written
 *    `cradle().name`.
 *
 * Both defer the actual resolution to the property access — the cradle is a
 * proxy, and it resolves a name when that name is read — so the read's own
 * position decides {@link PortResolution.kind} and {@link ResolutionSite}, the
 * same way an inline `ctx.cradle<C>().name` does.
 */
type CradleAliasKind = 'object' | 'accessor';

interface CradleAlias {
  readonly kind: CradleAliasKind;
  /**
   * The node the alias is visible inside. Scoped rather than file-wide on
   * purpose: `cradle` is a common local name, and a flat table would read an
   * unrelated `cradle.x` in another function as a container resolution.
   */
  readonly scope: ts.Node;
}

/** Is this the container-cradle accessor, `ctx.cradle<C>()`? */
function isCradleCall(node: ts.Node): node is ts.CallExpression {
  return ts.isCallExpression(node) && calleeTail(node).endsWith('cradle');
}

/** The expression a zero-argument function returns, if it returns exactly one. */
function soleReturnedExpression(fn: ts.ArrowFunction | ts.FunctionExpression): ts.Node | null {
  if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return fn.body;
  if (!ts.isBlock(fn.body)) return null;
  const [statement, ...rest] = fn.body.statements;
  if (rest.length > 0 || statement === undefined || !ts.isReturnStatement(statement)) return null;
  return statement.expression ?? null;
}

/**
 * Every local name that stands for the container cradle, with the scope it is
 * visible in.
 *
 * The check used to see two shapes only — a destructured factory parameter and
 * `ctx.cradle<C>()` read inline — and a module that bound the cradle to a local
 * first resolved everything it wanted unseen (issue #90). Nine modules had the
 * object form and six the accessor form, and among them were gated ports read
 * in a `ctx.routes` body: exactly what the wiring rule below exists to refuse.
 */
function collectCradleAliases(sf: ts.SourceFile): Map<string, CradleAlias[]> {
  const aliases = new Map<string, CradleAlias[]>();
  const add = (name: string, alias: CradleAlias): void => {
    const existing = aliases.get(name);
    if (existing) existing.push(alias);
    else aliases.set(name, [alias]);
  };
  /** The block (or file) a `const` is visible in. */
  const blockOf = (node: ts.Node): ts.Node => {
    for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
      if (ts.isBlock(current) || ts.isSourceFile(current)) return current;
    }
    return sf;
  };
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      const initializer = node.initializer;
      const scope = blockOf(node);
      if (isCradleCall(initializer)) {
        add(node.name.text, { kind: 'object', scope });
      } else if (
        (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) &&
        initializer.parameters.length === 0
      ) {
        const returned = soleReturnedExpression(initializer);
        if (returned !== null && isCradleCall(returned)) {
          add(node.name.text, { kind: 'accessor', scope });
        }
      }
    }
    // A factory's first parameter *is* the cradle — that is how Awilix calls
    // it — so a named one resolves exactly as a destructured one does. The
    // destructured form was already read; this is the same seam written with a
    // name, and `delivery_methods` and `payment_methods` use it.
    if (ts.isCallExpression(node) && calleeTail(node).endsWith('asFunction')) {
      const [factory] = node.arguments;
      if (factory && (ts.isArrowFunction(factory) || ts.isFunctionExpression(factory))) {
        const [parameter] = factory.parameters;
        if (parameter && ts.isIdentifier(parameter.name)) {
          add(parameter.name.text, { kind: 'object', scope: factory });
        }
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return aliases;
}

/** Is `node` inside `scope` (or `scope` itself)? */
function isWithin(node: ts.Node, scope: ts.Node): boolean {
  for (let current: ts.Node | undefined = node; current; current = current.parent) {
    if (current === scope) return true;
  }
  return false;
}

/**
 * Every registration name a module resolves.
 *
 * Three shapes, because those are the ones the kernel offers: the cradle
 * parameter of a factory (`ctx.asFunction(({ a, b }: C) => …)`, destructured or
 * named), the deferred surface (`ctx.cradle<C>()`) read by destructuring or by
 * property access, and either of those bound to a local first — see
 * {@link collectCradleAliases}.
 *
 * **Each shape is read both ways round.** The alias and the destructuring are
 * independent axes, and the check used to see only five of their six
 * combinations: `cradle().a` yes, `const { a } = ctx.cradle<C>()` yes,
 * `const { a } = cradle()` no. That last one is what `catalog`'s
 * asset-reference boot hook is written as, so its two reads were invisible
 * until issue #127 — the eighth time this scanner's *reach*, rather than the
 * rules under it, turned out to be the defect.
 */
export function resolvedNames(source: string, file: string): PortResolution[] {
  const moduleId = moduleOf(file);
  if (moduleId === null) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: PortResolution[] = [];
  const cradleAliases = collectCradleAliases(sf);

  const record = (
    name: string,
    node: ts.Node,
    kind: PortResolution['kind'],
    site: ResolutionSite = siteAt(node),
    via: PortResolution['via'] = 'cradle',
  ): void => {
    found.push({
      moduleId,
      name,
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      kind,
      site,
      via,
    });
  };

  const recordBindingPattern = (
    pattern: ts.ObjectBindingPattern,
    kind: PortResolution['kind'],
  ): void => {
    for (const element of pattern.elements) {
      const property = element.propertyName ?? element.name;
      if (ts.isIdentifier(property)) record(property.text, element, kind);
    }
  };

  /**
   * Is this `ctx.cradle()` call evaluated when the registration is built, or
   * when somebody uses it?
   *
   * Walk out to the nearest enclosing function. If that function is the factory
   * handed to `asFunction`, the call runs at construction — a capture. If any
   * other function sits in between (a method, a route registrar, a subscriber
   * handler, an arrow passed to a service), the call runs when that function
   * does — a genuine deferral.
   */
  const readKindAt = (node: ts.Node): PortResolution['kind'] => {
    let current: ts.Node | undefined = node.parent;
    while (current) {
      if (
        ts.isArrowFunction(current) ||
        ts.isFunctionExpression(current) ||
        ts.isFunctionDeclaration(current) ||
        ts.isMethodDeclaration(current)
      ) {
        const owner = current.parent;
        const isFactoryOfAsFunction =
          owner !== undefined &&
          ts.isCallExpression(owner) &&
          calleeTail(owner).endsWith('asFunction') &&
          owner.arguments[0] === current;
        return isFactoryOfAsFunction ? 'captured' : 'deferred';
      }
      current = current.parent;
    }
    return 'deferred';
  };

  /**
   * The cradle a read is written against, if the receiver is a local alias
   * visible here — `cradle.x` for an `object` alias, `cradle().x` for an
   * `accessor` one. Innermost declaration wins, so a shadowed name is read in
   * the scope that declared it.
   */
  const aliasReceiverOf = (receiver: ts.Node): CradleAlias | null => {
    const named =
      ts.isIdentifier(receiver) && cradleAliases.has(receiver.text)
        ? { name: receiver.text, wanted: 'object' as CradleAliasKind }
        : ts.isCallExpression(receiver) &&
            receiver.arguments.length === 0 &&
            ts.isIdentifier(receiver.expression) &&
            cradleAliases.has(receiver.expression.text)
          ? { name: receiver.expression.text, wanted: 'accessor' as CradleAliasKind }
          : null;
    if (named === null) return null;
    const candidates = (cradleAliases.get(named.name) ?? []).filter(
      (alias) => alias.kind === named.wanted && isWithin(receiver, alias.scope),
    );
    return candidates.at(-1) ?? null;
  };

  const visit = (node: ts.Node): void => {
    // A read off a local cradle alias. The alias itself resolves nothing — the
    // cradle is a proxy — so the property access is the resolution, and its own
    // position decides both the kind and the site.
    if (ts.isPropertyAccessExpression(node) && aliasReceiverOf(node.expression) !== null) {
      record(node.name.text, node, readKindAt(node));
    } else if (ts.isElementAccessExpression(node) && aliasReceiverOf(node.expression) !== null) {
      // Same rule as `lazyPort`: a literal is a name this check can verify, and
      // anything else must surface rather than pass.
      const argument = node.argumentExpression;
      const name = ts.isStringLiteralLike(argument) ? argument.text : NON_LITERAL_PORT_NAME;
      record(name, node, readKindAt(node));
    }

    // The same alias, destructured instead of read a name at a time:
    // `const { a, b } = cradle()` for an accessor alias, `const { a } = cradle`
    // for an object one. The check saw each half — `cradle().a`, and
    // `const { a } = ctx.cradle<C>()` written inline — and not the two combined,
    // so `catalog`'s asset-reference boot hook resolved two names invisibly
    // (issue #127). The destructuring *is* the resolution, exactly as the
    // property access is, so its own position decides the kind and the site.
    //
    // Keyed on the alias table rather than on the shape, which is what keeps the
    // widening from swallowing the tree: `const { rows } = await list()` is the
    // commonest line in `src/` and resolves nothing. And the receiver must be
    // the alias itself — `const { x } = cradle().service` destructures a
    // *resolved value*, whose fields are not container names.
    if (
      ts.isVariableDeclaration(node) &&
      ts.isObjectBindingPattern(node.name) &&
      node.initializer !== undefined &&
      aliasReceiverOf(node.initializer) !== null
    ) {
      recordBindingPattern(node.name, readKindAt(node.initializer));
    }

    if (ts.isCallExpression(node)) {
      const tail = calleeTail(node);

      // A factory's cradle parameter.
      if (tail.endsWith('asFunction')) {
        const [factory] = node.arguments;
        if (factory && (ts.isArrowFunction(factory) || ts.isFunctionExpression(factory))) {
          const [parameter] = factory.parameters;
          if (parameter && ts.isObjectBindingPattern(parameter.name)) {
            recordBindingPattern(parameter.name, 'captured');
          }
        }
      }

      // The resolution surface — deferred *only* when the read happens inside a
      // nested function. `ctx.cradle<C>().thing` written straight into a
      // factory body looks deferred and is not: the body runs when Awilix first
      // constructs the registration, so the read is every bit as eager as a
      // destructured parameter. `addresses` had exactly that, and it survived
      // until `dictionaries` turned the name it read into a port.
      if (tail.endsWith('cradle')) {
        const kind = readKindAt(node);
        const parent = node.parent;
        if (parent && ts.isPropertyAccessExpression(parent)) {
          record(parent.name.text, parent, kind);
        } else if (
          parent &&
          ts.isVariableDeclaration(parent) &&
          ts.isObjectBindingPattern(parent.name)
        ) {
          recordBindingPattern(parent.name, kind);
        }
      }

      // `lazyPort<T>(ctx, 'name')` — the shape the conversions were told to
      // prefer, and the one this check could not see until feature 072 wave 3.
      // Every read through it went unchecked: `pim_ergonode` resolved fourteen
      // names this way, several registered by nobody, and the check reported a
      // clean bill while the media pipeline produced no assets.
      //
      // Always `deferred`: the proxy resolves the name on each method call, not
      // when it is constructed. That is the whole point of the helper, and it
      // is why capturing one is safe where capturing a port is not.
      //
      // The same reasoning decides the **site**, and it is why a `lazyPort` is
      // not read positionally like a cradle access. Building one in a
      // `ctx.routes` body resolves nothing — that is the sanctioned fix for the
      // wiring hazard, not an instance of it, so it is a `call`. Building one
      // in a boot hook is different in kind: the whole hook body is pre-request,
      // so the method call it defers to happens at boot too, usually on the next
      // line. All seven `emailDefaultsPort` contributors were exactly that.
      const calleeName = ts.isIdentifier(node.expression) ? node.expression.text : tail;
      if (calleeName === 'lazyPort') {
        const [, nameArgument] = node.arguments;
        const lazySite: ResolutionSite = siteAt(node) === 'boot' ? 'boot' : 'call';
        if (nameArgument !== undefined) {
          if (ts.isStringLiteralLike(nameArgument)) {
            record(nameArgument.text, nameArgument, 'deferred', lazySite, 'lazyPort');
          } else {
            // A name this check cannot read statically must not pass silently.
            // A generic `port(ctx, name)` helper written during T131 hid twelve
            // resolutions behind a variable; the fix is to refuse the shape,
            // not to guess at it.
            record(NON_LITERAL_PORT_NAME, nameArgument, 'deferred', lazySite, 'lazyPort');
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return found;
}

/**
 * The other way a module reaches another module's contribution seam: it
 * **imports the singleton and pushes into it**.
 *
 * The container is not the only wiring in the tree. `stripe`, `tpay`, `payu`
 * and `autopay` each `import { gatewayRefundRegistry }` and
 * `import { paymentAdapterRegistry }` out of the modules that own them and call
 * `.register(…)` on the imported value. Nothing above sees that — this check
 * measures container resolutions — and the hazard is exactly the one the
 * container shape has: an entry that keeps answering after the module that
 * pushed it is switched off, or a host that acts on it.
 *
 * Deliberately narrow, so it stays a statement about contribution seams rather
 * than about imports in general: an import is only read as a seam when the
 * importing file *pushes* into the imported value, `x.register(…)` or
 * `x.unregister(…)`. A cross-module import of a class, an error or a pure
 * function is a different rule's business (Principle I), and 63 of them exist —
 * folding them in here would drown the one shape the ledger can answer for.
 */
export interface ImportedContributionSeam {
  /** The module doing the pushing. */
  readonly moduleId: string;
  /** The module that owns the singleton. */
  readonly dependsOn: string;
  /** The imported binding, which is also the name the policy table keys on. */
  readonly name: string;
  readonly file: string;
  readonly line: number;
  readonly site: ResolutionSite;
}

export function importedContributionSeams(source: string, file: string): ImportedContributionSeam[] {
  const moduleId = moduleOf(file);
  if (moduleId === null) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);

  /** Imported binding → the module whose sources it comes from. */
  const imported = new Map<string, string>();
  for (const statement of sf.statements) {
    if (!ts.isImportDeclaration(statement) || statement.importClause?.isTypeOnly === true) continue;
    if (!ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith('.')) continue;
    // `moduleOf` reads a directory segment, so the resolved path needs one
    // more separator after the module name to match on a file at its root.
    const owner = moduleOf(`${resolvePath(dirname(file), specifier)}/`);
    if (owner === null || owner === moduleId) continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings === undefined || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) {
      if (!element.isTypeOnly) imported.set(element.name.text, owner);
    }
  }
  if (imported.size === 0) return [];

  const seams: ImportedContributionSeam[] = [];
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ts.isIdentifier(node.expression.expression) &&
      (node.expression.name.text === 'register' || node.expression.name.text === 'unregister')
    ) {
      const name = node.expression.expression.text;
      const owner = imported.get(name);
      if (owner !== undefined && !seen.has(name)) {
        seen.add(name);
        seams.push({
          moduleId,
          dependsOn: owner,
          name,
          file,
          line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
          site: siteAt(node),
        });
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return seams;
}

export interface LedgerScanInput {
  readonly resolutions: readonly PortResolution[];
  readonly seams: readonly ImportedContributionSeam[];
  /** Name → owning module, as {@link findViolations} reads it. */
  readonly owners: ReadonlyMap<string, string>;
  /** Name → owning module, for the names registered with `di.providePort`. */
  readonly providedPorts: ReadonlyMap<string, string>;
}

/**
 * The cross-module reads, in the shape the ledger classifies.
 *
 * The capture flag is the same test {@link findViolations} applies, not a
 * looser one: a name a composition root creates before any module composes is
 * not a capture, and neither is a name the module owns itself. What is left is
 * a module freezing *another* module's registration, which is the ledger's
 * first unacceptable shape.
 */
export function ledgerReads(input: LedgerScanInput): CrossModuleRead[] {
  const reads: CrossModuleRead[] = [];
  for (const resolution of input.resolutions) {
    const owner = input.owners.get(resolution.name);
    if (owner === undefined || owner === resolution.moduleId) continue;
    reads.push({
      moduleId: resolution.moduleId,
      dependsOn: owner,
      name: resolution.name,
      gated: input.providedPorts.get(resolution.name) !== undefined,
      captured:
        resolution.kind === 'captured' &&
        !CAPTURABLE_NAMES.has(resolution.name) &&
        ALLOWED_CAPTURES[`${resolution.moduleId}:${resolution.name}`] === undefined,
      site: resolution.site,
    });
  }
  for (const seam of input.seams) {
    reads.push({
      moduleId: seam.moduleId,
      dependsOn: seam.dependsOn,
      name: seam.name,
      gated: false,
      captured: false,
      site: seam.site,
    });
  }
  return reads;
}

export function describeUnassignedEdge(edge: UnassignedEdge): string {
  const head = `  - ${edge.moduleId} → ${edge.dependsOn}:${edge.name} — ${edge.detail}.`;
  const tail: Record<UnassignedEdge['shape'], string> = {
    'captured-registration':
      `    Take the value as an accessor instead of a value, so the name is read when it is\n` +
      `    used, and declare the edge — in \`dependencies\` where the owner may bind the\n` +
      `    operator, in \`nonBindingDependencies\` as \`degrades-without\` where it may not.`,
    'registry-without-policy':
      `    A read of an ungated registration is answered by the owning module whether or not\n` +
      `    an operator switched it off. Decide at the class what an absent owner's entry does,\n` +
      `    record the contributing module on every entry, and list the name in\n` +
      `    CONTRIBUTION_POLICY_STATED — or, while the decision is outstanding, in\n` +
      `    REGISTRY_POLICIES_UNSTATED with what would drain it.`,
    'gated-port-before-first-request':
      `    Boot hooks and route registration run whatever the owning module's effective state\n` +
      `    is, so the gate's "no" stops the next start instead of stopping one request. Move\n` +
      `    the resolution to the point of use.`,
  };
  return `${head}\n${tail[edge.shape]}`;
}

/** Transitive `manifest.dependencies` closure — the closure ordering already uses. */
export function closureOf(
  moduleId: string,
  dependencies: ReadonlyMap<string, readonly string[]>,
): Set<string> {
  const reachable = new Set<string>();
  const stack = [...(dependencies.get(moduleId) ?? [])];
  while (stack.length > 0) {
    const next = stack.pop();
    if (next === undefined || next === moduleId || reachable.has(next)) continue;
    reachable.add(next);
    stack.push(...(dependencies.get(next) ?? []));
  }
  return reachable;
}

export interface CheckInput {
  readonly resolutions: readonly PortResolution[];
  readonly owners: ReadonlyMap<string, string>;
  readonly dependencies: ReadonlyMap<string, readonly string[]>;
  /**
   * Name → module id, for the names registered with `di.providePort`.
   *
   * Only the capture rule reads it, and it is what narrows the "a module may
   * capture what it owns" exemption (feature 072, D-38b). The exemption is
   * right for a `di.register` name — a plain registration whose lifetime the
   * module chose — and wrong for a port: `providePort` wraps the resolver in a
   * transient gate whoever owns it, and awilix strict mode refuses a singleton
   * that captures one, **unconditionally**. `_i18n` shipped exactly that and
   * the backend stopped booting with `AwilixResolutionError: … has a shorter
   * lifetime than its ancestor: 'adminI18nReconciler$ungated$'`, with every
   * static check green.
   */
  readonly providedPorts?: ReadonlyMap<string, string> | undefined;
  /**
   * Module ids whose manifest declares `activation.nonDeactivatable` — the
   * modules the lifecycle orchestrator refuses to switch off on **either** axis.
   *
   * Their ports are gates that can never close, so resolving one at boot or
   * while wiring routes has no state in which it can throw. That is the reason
   * D-40 left `auth`'s `requireAdmin` and `_i18n`'s reconciler eager, written
   * down once instead of as twenty-nine allow-list entries — and read from the
   * manifests, so a module that stops being non-deactivatable makes every one of
   * those reads a violation on the same run.
   */
  readonly neverAbsentOwners?: ReadonlySet<string> | undefined;
  /**
   * `<resolving module>:<port>` → reason, from the manifests'
   * `acknowledgedDependencies` (see {@link acknowledgedPortEdges}). Omitted
   * means "no edge is acknowledged", which is what a unit test over hand-built
   * fixtures wants.
   */
  readonly acknowledged?: Readonly<Record<string, string>> | undefined;
}

export function findViolations(input: CheckInput): PortViolation[] {
  const violations: PortViolation[] = [];
  const providedPorts = input.providedPorts ?? new Map<string, string>();
  for (const resolution of input.resolutions) {
    // The named debt from issue #90, before any rule runs: a resolution the
    // alias hid, whose repair is a manifest decision rather than a fix. It
    // suppresses every kind on purpose — see {@link ALIAS_HIDDEN_RESOLUTIONS}.
    if (ALIAS_HIDDEN_RESOLUTIONS[`${resolution.moduleId}:${resolution.name}`] !== undefined) {
      continue;
    }
    // The capture rule runs first and independently of ownership: a module may
    // capture a name it owns **and did not provide as a port**, and nothing
    // else outside `CAPTURABLE_NAMES`.
    const ownsName = input.owners.get(resolution.name) === resolution.moduleId;
    const ownsItAsPort = providedPorts.get(resolution.name) === resolution.moduleId;
    if (
      resolution.kind === 'captured' &&
      !CAPTURABLE_NAMES.has(resolution.name) &&
      !(ownsName && !ownsItAsPort) &&
      ALLOWED_CAPTURES[`${resolution.moduleId}:${resolution.name}`] === undefined
    ) {
      violations.push({
        kind: 'captured-name',
        resolution,
        owner: input.owners.get(resolution.name) ?? null,
      });
      continue;
    }
    // D-39's ratchet: a **gated** port resolved before the platform serves its
    // first request. Both sites run whatever the owning module's effective
    // state is, so the gate has a real "no" answer there — and answering it
    // turns an operator's supported off-switch into a dead deployment. It is
    // independent of ownership and of the capture rule: `megamenu` resolved a
    // port it owned itself, from its own boot hook, with the dependency
    // declared and the read genuinely deferred.
    const portOwner = providedPorts.get(resolution.name);
    if (
      portOwner !== undefined &&
      resolution.site !== 'call' &&
      !(input.neverAbsentOwners ?? new Set<string>()).has(portOwner) &&
      !(
        resolution.site === 'wiring' &&
        WIRING_RESOLUTIONS_TO_DRAIN.has(`${resolution.moduleId}:${resolution.name}`)
      )
    ) {
      violations.push({
        kind: resolution.site === 'boot' ? 'gated-port-at-boot' : 'gated-port-at-wiring',
        resolution,
        owner: portOwner,
      });
      continue;
    }
    if (PLATFORM_OWNED_NAMES.has(resolution.name)) continue;
    const owner = input.owners.get(resolution.name) ?? null;
    if (owner === null) {
      violations.push({ kind: 'unowned-name', resolution, owner });
      continue;
    }
    if (owner === resolution.moduleId) continue;
    if (closureOf(resolution.moduleId, input.dependencies).has(owner)) continue;
    if ((input.acknowledged ?? {})[`${resolution.moduleId}:${resolution.name}`] !== undefined) {
      continue;
    }
    violations.push({ kind: 'undeclared-dependency', resolution, owner });
  }
  return violations;
}

/**
 * The two composition roots, by the label used in error output.
 *
 * Both are scanned because the failures below are *differences between them*,
 * and a check that reads only one cannot see a difference at all.
 */
export const ROOT_FILES: Readonly<Record<string, string>> = {
  production: 'src/composition.ts',
  harness: 'test/helpers/test-server.ts',
};

/**
 * `HOST_REGISTERED_PORTS` names a root may legitimately register in only one
 * composition, with the reason. Keep it short: an entry is a statement that the
 * two compositions genuinely differ on that name, not that nobody has looked.
 */
export const ROOT_DIVERGENCE_ALLOWED: Readonly<Record<string, string>> = {};

/**
 * Every registration name a composition root writes into the container.
 *
 * Every shape a root uses: `registerValues(container, { … })`, a direct
 * `container.register({ … })`, and `composedModules.contribute({ … })` — D-45's
 * contribution window as a method (issue #52). Missing the third would empty
 * this list of nearly every name a root supplies, and the shadowing, divergence
 * and unsupplied findings below are all computed from it: the check would report
 * green because it had stopped looking.
 *
 * Spread elements are ignored — a name that only exists inside a spread is not a
 * name this check can reason about.
 */
export function rootRegisteredNames(source: string, file: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const collect = (literal: ts.ObjectLiteralExpression): void => {
    for (const property of literal.properties) {
      if (!property.name) continue;
      if (ts.isIdentifier(property.name)) names.push(property.name.text);
      else if (ts.isStringLiteral(property.name)) names.push(property.name.text);
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      const callee = ts.isIdentifier(node.expression)
        ? node.expression.text
        : calleeTail(node);
      if (callee === 'registerValues') {
        const [, second] = node.arguments;
        if (second && ts.isObjectLiteralExpression(second)) collect(second);
      }
      if (
        callee === 'container.register' ||
        callee === 'register' ||
        callee === 'contribute' ||
        callee.endsWith('.contribute')
      ) {
        const [first] = node.arguments;
        if (first && ts.isObjectLiteralExpression(first)) collect(first);
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return names;
}

export interface RootRegistrationIssue {
  readonly kind:
    | 'root-shadows-module-port'
    | 'root-divergence'
    | 'root-supplies-nothing'
    // The four `PLATFORM_OWNED_NAMES` findings (issue #49, D-73). Named apart
    // from the three above even where the failure rhymes, because the fix
    // differs: a `HOST_REGISTERED_PORTS` entry names a module that *will* own
    // the name and is deleted the day it does, while a platform name has no
    // future owner and the answer is usually to take it off the list.
    | 'platform-name-unsupplied'
    | 'platform-name-divergence'
    | 'platform-name-owned-by-module'
    | 'platform-name-stale';
  readonly name: string;
  /** Roots involved: the shadowing ones, or the ones that *do* register it. */
  readonly roots: readonly string[];
  readonly owner: string | null;
}

export interface RootCheckInput {
  /** Name → module id, for the **gated ports** a converted module provides. */
  readonly moduleRegistered: ReadonlyMap<string, string>;
  /** Root label → the names that root registers. */
  readonly rootNames: ReadonlyMap<string, ReadonlySet<string>>;
  readonly hostRegistered: Readonly<Record<string, string>>;
  /** Names some module actually resolves. A table entry nothing reads is dead weight, not a bug. */
  readonly resolvedNames: ReadonlySet<string>;
  /** The hand-written platform list, swept for the four D-73 findings. */
  readonly platformNames: ReadonlySet<string>;
  /**
   * Names registered by `src/kernel/**` — the **third** supply source, and the
   * detail without which this sweep is worse than useless.
   *
   * `orm`, `em` and `emFactory` arrive from `registerOrm`
   * (`kernel/container.ts`), not from either composition root, so a derivation
   * that only knows about the two roots reds three correct entries on its first
   * run and gets deleted the same day (F47). A kernel registration counts as
   * supply for **every** composition, because the kernel is the part every
   * deployment has — which is the same fact that put these names on the
   * platform list in the first place.
   */
  readonly kernelNames: ReadonlySet<string>;
  /**
   * Name → module id, for every name a module's `backend.ts` registers **or**
   * provides — wider than `moduleRegistered`, which is ports only.
   *
   * A contribution-point default (`ctx.di.register`) is enough to make a name
   * module-owned: `priceListsPricingCacheTtlMs` was exactly that, sitting on
   * the platform list and clearing both exemptions for it.
   */
  readonly moduleOwnedNames: ReadonlyMap<string, string>;
}

/**
 * The two ways a composition root can break a port without any module being
 * wrong, both found the hard way during feature 072 wave 2.
 *
 * **Shadowing** (issue #47) — a root registers a name a converted module
 * provides as a *gated port*. `registerValues` overwrites, so a plain value
 * silently replaces the gate and the module's off-state check stops firing.
 * Nothing else notices: the types match, and the port resolves. A root
 * overriding a `di.register` **contribution point** is deliberately not flagged
 * — that is what a contribution point is for.
 *
 * **Unsupplied** (issue #49) — a `HOST_REGISTERED_PORTS` name that **no** root
 * registers, which some module resolves anyway. The table entry names who
 * *would* own it; it is not a registration, and the check used to read the entry
 * and conclude the name was accounted for. `organizationTreeService` went in
 * that way during T132 and the sales-rep reverse-list route answered 500 —
 * typecheck, lint and this check all green.
 *
 * **Divergence** (issue #48) — a `HOST_REGISTERED_PORTS` name that only one root
 * registers. The table says "some root supplies this", and the check used to
 * take that on trust. `settingsAdminService` was registered by the harness and
 * by no production composition for four modules that resolve it, so four admin
 * write paths threw in production while every test passed.
 *
 * ---
 *
 * And **four more over `PLATFORM_OWNED_NAMES`** (issue #49, D-73), in the same
 * function rather than a parallel one, because they are the same three sweeps
 * plus one and the shared half is the supply computation. Being on that list
 * grants two exemptions — the dependency-declaration skip in `findViolations`
 * and exclusion from the deactivation-consequence ledger — and until D-73
 * nothing verified either, which is a green that means "not looking" over the
 * one table in this file where the result was green by construction:
 *
 *  - **`platform-name-unsupplied`** — a module resolves it and nothing
 *    registers it: not a root, not the kernel. This is the
 *    `salesChannelResolutionPort` defect and is the reason for the ruling.
 *  - **`platform-name-divergence`** — exactly one root registers it and the
 *    kernel does not. The #48 failure over a different table: one composition
 *    works and the other throws. Declarable through `ROOT_DIVERGENCE_ALLOWED`.
 *  - **`platform-name-owned-by-module`** — a module's `backend.ts` registers or
 *    provides it, so it is not platform-owned and the exemption is laundering a
 *    cross-module edge past a dependency declaration *and* an operator's
 *    confirmation dialog.
 *  - **`platform-name-stale`** — nothing registers it anywhere **and** no
 *    module resolves it. Deliberately both halves: a name a root registers
 *    before anything reads it is a root preparing a seam, not a defect.
 *
 * Three of the four are absolute and the fourth reuses the exemption table the
 * sibling half already has. No number, no per-entry allow-list, no ratchet: the
 * list may only shrink by being *true*.
 */
export function findRootIssues(input: RootCheckInput): RootRegistrationIssue[] {
  const issues: RootRegistrationIssue[] = [];

  for (const [name, owner] of input.moduleRegistered) {
    const shadowing = [...input.rootNames]
      .filter(([, names]) => names.has(name))
      .map(([label]) => label);
    if (shadowing.length > 0) {
      issues.push({ kind: 'root-shadows-module-port', name, roots: shadowing, owner });
    }
  }

  for (const [name, owner] of Object.entries(input.hostRegistered)) {
    if (ROOT_DIVERGENCE_ALLOWED[name] !== undefined) continue;
    const supplying = [...input.rootNames]
      .filter(([, names]) => names.has(name))
      .map(([label]) => label);
    if (supplying.length === 0) {
      // Only a bug if something reads it: an entry nothing resolves is stale,
      // and the staleness sweep in `main` is where that belongs.
      if (input.resolvedNames.has(name)) {
        issues.push({ kind: 'root-supplies-nothing', name, roots: [], owner });
      }
      continue;
    }
    if (supplying.length < input.rootNames.size) {
      issues.push({ kind: 'root-divergence', name, roots: supplying, owner });
    }
  }

  for (const name of input.platformNames) {
    const supplying = [...input.rootNames]
      .filter(([, names]) => names.has(name))
      .map(([label]) => label);

    // Ownership first, and it returns rather than falls through: a
    // module-owned name is wrong on this list whatever the roots do with it,
    // and reporting it a second time as a divergence would send the reader
    // after the registrations instead of after the list entry.
    const moduleOwner = input.moduleOwnedNames.get(name);
    if (moduleOwner !== undefined) {
      issues.push({
        kind: 'platform-name-owned-by-module',
        name,
        roots: supplying,
        owner: moduleOwner,
      });
      continue;
    }

    // The kernel supplies every composition at once, so it settles both the
    // unsupplied and the divergence question in one answer.
    if (input.kernelNames.has(name)) continue;

    if (supplying.length === 0) {
      issues.push({
        kind: input.resolvedNames.has(name) ? 'platform-name-unsupplied' : 'platform-name-stale',
        name,
        roots: [],
        owner: null,
      });
      continue;
    }
    if (supplying.length < input.rootNames.size && ROOT_DIVERGENCE_ALLOWED[name] === undefined) {
      issues.push({ kind: 'platform-name-divergence', name, roots: supplying, owner: null });
    }
  }

  return issues;
}

export function describeRootIssue(issue: RootRegistrationIssue): string {
  if (issue.kind === 'root-shadows-module-port') {
    return (
      `  - '${issue.name}' is registered by ${issue.roots.join(' and ')}, and also by the ` +
      `'${issue.owner}' module itself.\n` +
      `    A root registration overwrites the module's, replacing a gated port with a plain\n` +
      `    value — the module's off-state gate stops firing and nothing else notices.\n` +
      `    Delete the root entry; the module provides it.`
    );
  }
  if (issue.kind === 'root-supplies-nothing') {
    return (
      `  - '${issue.name}' is resolved by a module and registered by no composition root, ` +
      `though\n    HOST_REGISTERED_PORTS names '${issue.owner}' as its owner.\n` +
      `    That entry is a claim about who would own the name, not a registration. Resolving\n` +
      `    it throws AwilixResolutionError at the first call. Register it in both roots, or\n` +
      `    resolve an existing name instead.`
    );
  }
  if (issue.kind === 'platform-name-unsupplied') {
    return (
      `  - '${issue.name}' is on PLATFORM_OWNED_NAMES, is resolved by a module, and is ` +
      `registered\n    by no composition root and by no file under src/kernel/.\n` +
      `    Being on that list skips the dependency-declaration check and removes the name from\n` +
      `    the deactivation-consequence ledger — it is not a registration. Resolving it throws\n` +
      `    AwilixResolutionError at the first call, in whichever composition exercises the path\n` +
      `    first; that is how the channel-scoped storefront stock read shipped broken (#49).\n` +
      `    Register it in both roots or in the kernel, or take the name off the list.`
    );
  }
  if (issue.kind === 'platform-name-stale') {
    return (
      `  - '${issue.name}' is on PLATFORM_OWNED_NAMES, and nothing registers it anywhere — no\n` +
      `    root, no kernel file — while no module resolves it either.\n` +
      `    The name is gone and its exemption outlived it, so the list now pre-clears whatever\n` +
      `    lands on that string next. Delete the entry.`
    );
  }
  if (issue.kind === 'platform-name-owned-by-module') {
    return (
      `  - '${issue.name}' is on PLATFORM_OWNED_NAMES, but the '${issue.owner}' module ` +
      `registers or\n    provides it in its own backend.ts.\n` +
      `    Then it is not a platform name, and the exemption is laundering a cross-module edge\n` +
      `    past both a dependency declaration and the operator's deactivation-consequence\n` +
      `    ledger. Take it off the list — moving the registration into a root would be fixing\n` +
      `    the wrong half.`
    );
  }
  if (issue.kind === 'platform-name-divergence') {
    return (
      `  - '${issue.name}' is on PLATFORM_OWNED_NAMES and is registered by ` +
      `${issue.roots.join(' and ')} only,\n    with no kernel registration to cover the other ` +
      `composition.\n` +
      `    A module resolving it works in that composition and throws in the other, and the\n` +
      `    list is what stopped anything from saying so. If the two compositions genuinely\n` +
      `    differ here, add the name to ROOT_DIVERGENCE_ALLOWED with the reason; otherwise\n` +
      `    register it in both roots.`
    );
  }
  return (
    `  - '${issue.name}' (owned by '${issue.owner}') is registered by ${issue.roots.join(' and ')} ` +
    `only.\n` +
    `    A module resolving it works in that composition and throws in the other. If the two\n` +
    `    compositions genuinely differ here, add the name to ROOT_DIVERGENCE_ALLOWED with the\n` +
    `    reason; otherwise register it in both roots, or convert the owning module.`
  );
}

export function describe(violation: PortViolation, srcRoot = SRC_ROOT): string {
  const { resolution, owner } = violation;
  const where = `${resolution.file.replace(`${srcRoot}/`, 'src/')}:${resolution.line}`;
  if (violation.kind === 'captured-name') {
    return (
      `  - ${resolution.moduleId} **captures** '${resolution.name}' (${where}).\n` +
      `    A factory's cradle parameter resolves once, when the registration is first\n` +
      `    constructed. That breaks two ways: a port is a transient gate, so Awilix's\n` +
      `    strict mode refuses a singleton holding one (and a captured gate would keep\n` +
      `    answering after its module is switched off); and a root-registered name may\n` +
      `    not exist yet when this module composes.\n` +
      `    It holds for a port the module provides itself: \`providePort\` makes the name a\n` +
      `    gate whoever owns it, and strict mode refuses the capture warm or cold.\n` +
      `    Read it through \`ctx.cradle<C>()\` — or \`lazyPort<T>(ctx, '${resolution.name}')\` —\n` +
      `    at the point of use instead.`
    );
  }
  if (violation.kind === 'gated-port-at-boot') {
    return (
      `  - ${resolution.moduleId} resolves the gated port '${resolution.name}' (owned by ` +
      `'${owner}') from a boot hook (${where}).\n` +
      `    Boot hooks run whatever the module's effective state is — \`runBootHooks()\` does\n` +
      `    not consult presence — so the gate throws MODULE_DISABLED during composition and\n` +
      `    index.ts turns that into process.exit(1). An operator switching '${owner}' off on\n` +
      `    /platform/modules would stop the next start, with the API down and the screen they\n` +
      `    would undo it from unreachable.\n` +
      `    If the name is a table of inert descriptors, it is a contribution seam: register it\n` +
      `    with \`ctx.di.register\` in '${owner}' and filter at enumeration, keyed on the\n` +
      `    contributing module (D-39). If it computes, decides, decrypts, sends or charges, it\n` +
      `    stays a port — move the resolution to the point of use.`
    );
  }
  if (violation.kind === 'gated-port-at-wiring') {
    return (
      `  - ${resolution.moduleId} resolves the gated port '${resolution.name}' (owned by ` +
      `'${owner}') in a ctx.routes body (${where}).\n` +
      `    Route *registration* runs inside \`buildServer\` unconditionally;\n` +
      `    \`defineModuleRoutes\` gates requests, not the wiring. Asking the gate here stops\n` +
      `    the backend from starting instead of stopping the module's routes.\n` +
      `    Pass \`lazyPort<T>(ctx, '${resolution.name}')\` into the registrar instead — inside a\n` +
      `    handler the gate is open by construction, and a closed one is the 503 it should be.`
    );
  }
  if (violation.kind === 'unowned-name' && resolution.name === NON_LITERAL_PORT_NAME) {
    return (
      `  - ${resolution.moduleId} calls lazyPort with a computed name (${where}).\n` +
      `    A name assembled at runtime is a name this check cannot verify, so it would pass\n` +
      `    whether or not anything registers it. Pass a string literal — one call per port,\n` +
      `    even where a helper would be shorter.`
    );
  }
  if (violation.kind === 'unowned-name') {
    return (
      `  - ${resolution.moduleId} resolves '${resolution.name}' (${where}), which no module ` +
      `registers.\n    Register it in the owning module's backend.ts, or — while a root ` +
      `still bridges this port — declare its owner in HOST_REGISTERED_PORTS in this script.`
    );
  }
  // The manifest's real path, **derived from the file the resolution was found
  // in** rather than assumed to be `src/modules/<id>/` (issue #210). A
  // deployment's overlay module lives under `src/apps/<deployment>/modules/<id>/`,
  // and a remedy line naming a file that does not exist is how an overlay author
  // concludes the check is broken rather than that their manifest is.
  const manifestPath = `${where.slice(0, where.lastIndexOf('/'))}/manifest.ts`;
  return (
    `  - ${resolution.moduleId} resolves '${resolution.name}' (${where}), owned by ` +
    `'${owner}', which it does not declare.\n    Add '${owner}' to \`dependencies\` in ` +
    `${manifestPath} — or, if declaring it closes a\n` +
    `    cycle, to \`acknowledgedDependencies\` there with the cycle spelled out.`
  );
}

/**
 * Every deployment's overlay module manifests, with the path each was read from
 * (issue #210).
 *
 * Env-independent: one entry per deployment on disk, not "the deployment
 * `DEPLOYMENT` names". This check is a whole-tree guard and the tree contains
 * every deployment; scoping it to a variable would make it a guard no CI run
 * makes, which is the defect issue #120 ruled on for the override manifests.
 */
export async function overlayManifestEntries(): Promise<
  ReadonlyArray<{ id: string; manifest: ModuleManifest; manifestPath: string }>
> {
  const out: Array<{ id: string; manifest: ModuleManifest; manifestPath: string }> = [];
  for (const deployment of deploymentsOnDisk()) {
    const found = await discoverOverlayModuleManifests({
      DEPLOYMENT: deployment,
    } as NodeJS.ProcessEnv);
    for (const entry of found) {
      out.push({
        id: entry.id,
        manifest: entry.manifest,
        manifestPath: `src/apps/${deployment}/modules/${entry.id}/manifest.ts`,
      });
    }
  }
  return out;
}

async function main(): Promise<void> {
  // Every root a module's source can live in, derived (feature 080, T040a).
  const layout = await requireModuleLayout('[port-deps]');
  const files = layout.moduleWalkRoots.flatMap((root) => walk(root));
  // Emptiness is only the total loss (issue #215). `src/apps` is a scan root of
  // its own, and `resolutions.length === 0` below is satisfied by a single
  // surviving `lazyPort` — so a **partial** move, which is what a package split
  // performs, leaves both guards green over a fraction of the edges. The floor
  // is one source per registered module, derived from the manifest index.
  const coverage = await refuseVacuousModulePopulation({
    prefix: '[port-deps]',
    manifestIndexPath: layout.manifestIndexPath,
    files,
    moduleIdOf: layout.moduleIdOfPath,
  });

  // The third supply source (D-73). Read before anything else so its own
  // vacuous guard fires before the platform sweep can turn an unreadable kernel
  // directory into a screenful of false `platform-name-unsupplied`.
  // The kernel's own sources, wherever the workspace says they are. Spelling the
  // path here was how this guard nearly went silent at the relocation: the five
  // platform directories moved into `@endora-commerce/platform` and left
  // re-export shims at the old paths, so `walk(join(SRC_ROOT, 'kernel'))` came
  // back with 48 files that register nothing — a non-empty walk clearing the
  // refusal below and an empty `kernelNames` reporting `orm`, `em` and
  // `emFactory` as unsupplied. That is issue #113 with a full-length file count.
  const platformRoot = layout.platformRoot;
  if (platformRoot === null) {
    console.error(
      '[port-deps] no workspace member declares `endora.type: "platform"` — the ' +
        'kernel-supplied names cannot be read and every one of them would report as ' +
        'unsupplied; refusing to report anything',
    );
    process.exit(2);
  }
  const kernelFiles = walk(join(platformRoot, 'kernel'));
  if (kernelFiles.length === 0) {
    console.error(
      `[port-deps] no kernel sources under ${join(platformRoot, 'kernel')} — the ` +
        'platform-name sweep would report every kernel-supplied name as unsupplied; ' +
        'refusing to report anything',
    );
    process.exit(2);
  }
  const kernelNames = new Set<string>();
  for (const file of kernelFiles) {
    const source = readFileSync(file, 'utf8');
    // Both shapes, because the kernel writes both: `container.register({ … })`
    // in `registerOrm` (which `rootRegisteredNames` reads) and the module-facing
    // `di.register` / `di.providePort` spellings.
    for (const name of rootRegisteredNames(source, file)) kernelNames.add(name);
    for (const name of registeredNames(source, file)) kernelNames.add(name);
  }

  // The names the installed extension packages register (feature 080, T034).
  //
  // The port→owner map was `src/modules/**` plus the host table, so a name an
  // installed package owns resolved to **no owner** — and a core module
  // resolving one was reported as `unowned-name`, a wiring bug, when the wiring
  // is right and the map was short. That is the F4 endgame's ordinary case: a
  // module leaves the tree for a package and every consumer of its port starts
  // reading as broken.
  //
  // A registration is a call inside `registerModule`, and executing a
  // stranger's composition to find out what it composes is not a thing a static
  // check may do — so the artefact is read with the analyzers this file already
  // owns. What it cannot read it refuses: a `./backend` export whose own source
  // does not declare the `registerModule` it hands out is bundled or
  // re-exported, and it stops the run at exit 2 rather than being credited with
  // zero names.
  const packages = await loadPackageDeclarations({
    containerNames: (source, file) => {
      const gated = new Set(providedPortNames(source, file));
      return [
        ...[...gated].map((name) => ({ name, gated: true })),
        ...registeredNames(source, file)
          .filter((name) => !gated.has(name))
          .map((name) => ({ name, gated: false })),
      ];
    },
  });
  refuseUnreadablePackages('[port-deps]', packages);

  const owners = new Map<string, string>(Object.entries(HOST_REGISTERED_PORTS));
  const resolutions: PortResolution[] = [];
  const seams: ImportedContributionSeam[] = [];
  /**
   * Each module's composition entry point, by the **marker** rather than by a
   * filename (feature 080, T040b).
   *
   * This used to be `file.endsWith('/backend.ts')`, with a second spelling —
   * `<dir>/backend.ts` or `<dir>/src/backend.ts` — in the `HOST_REGISTERED_PORTS`
   * staleness sweep below. A module package keeps its entry point wherever its
   * `exports` map's `./backend` subpath points, which for both packages in this
   * repository is `src/backend/index.ts`: neither spelling matches it, so a
   * packaged module's `di.providePort` calls were invisible and every consumer
   * of one of its ports read as *resolving an ungated registration*. That is
   * fail-open in the direction that matters — the six consumers of
   * `quote_requests`' two ports were reported as needing an absent-owner policy
   * for a gate that is right there. `blog` hid it only by owning no port another
   * module resolves.
   *
   * The marker is `generate-composer.ts`'s own — the file exporting
   * `registerModule` — so the composer and this check cannot disagree about
   * which file composes a module. Two such files in one module is the
   * composer's error to raise, and it does; here the first in walk order wins,
   * because a check that threw would refuse a tree the generator has already
   * refused with a better message.
   */
  const moduleEntryPoints = new Map<string, string>();
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const moduleId = moduleOf(file);
    if (moduleId === null) continue;
    if (
      !moduleEntryPoints.has(moduleId) &&
      declaresRegisterModule(source)
    ) {
      moduleEntryPoints.set(moduleId, file);
    }
    for (const name of registeredNames(source, file)) owners.set(name, moduleId);
    resolutions.push(...resolvedNames(source, file));
    seams.push(...importedContributionSeams(source, file));
  }
  // The tree wins a collision, as it does in `check-module-boundary`'s table
  // map: two registrations of one name is a `DuplicateRegistrationError` the
  // container raises for itself, and until it does, a stranger must not take a
  // core module's name away from it in the diagnosis.
  for (const claimed of packages.containerNames) {
    if (!owners.has(claimed.name)) owners.set(claimed.name, claimed.moduleId);
  }

  const { DISCOVERED_MANIFESTS } = (await import(
    pathToFileURL(layout.manifestIndexPath).href
  )) as { DISCOVERED_MANIFESTS: ReadonlyArray<{ id: string; manifest: ModuleManifest }> };

  // Every deployment's overlay manifests, merged in — issue #210.
  //
  // The walk above reads resolutions from `src/apps/` as well as `src/modules/`,
  // so an overlay module's port edges are in the population. Its
  // *declarations* were not: they were read from the generated index, and since
  // D-104 that index is bare core **by construction**. So an overlay module
  // could not satisfy this check however its manifest was written — the finding
  // stood with `dependencies: ['auth']` declared, and the remedy line named a
  // path (`src/modules/<id>/manifest.ts`) that does not exist for it.
  //
  // Before D-103 the gap was unreachable rather than absent: an overlay module
  // got `requireAdmin` handed to it through `OverlayModuleContext` and resolved
  // no port at all, so nothing ever asked the question.
  //
  // Read env-**in**dependently, one entry per deployment on disk, for the reason
  // `check-overlay-determinism.ts` gives for the override manifests: a guard
  // that only looks at the deployment named by an environment variable is a
  // guard no run makes (issue #120). A whole-tree check reads the whole tree.
  const overlayManifests = await overlayManifestEntries();
  const discovered = [...DISCOVERED_MANIFESTS, ...overlayManifests];

  const dependencies = new Map<string, readonly string[]>(
    discovered.map((entry) => [entry.id, entry.manifest.dependencies ?? []] as const),
  );
  const manifests = discovered.map((entry) => entry.manifest);

  // The withheld edges, read from the manifests that withhold them — the same
  // declarations the lifecycle's flip-time refusal reads (feature 073, A1) —
  // merged with the ones that withhold the refusal instead (D-44). The
  // ownership rule below is satisfied by either; nothing else this check does
  // reads them, and nothing else in the tree reads the second kind at all.
  const acknowledged = {
    ...acknowledgedPortEdges(manifests),
    ...nonBindingPortEdges(manifests),
  };
  const nonBindingEdges = nonBindingPortEdgesFrom(manifests);

  // A host entry whose owner now registers the port itself is dead weight, and
  // dead weight in a bridging table is how the bridge outlives the gap.
  const stale = Object.entries(HOST_REGISTERED_PORTS).filter(([name, owner]) => {
    const backend = moduleEntryPoints.get(owner);
    return (
      backend !== undefined &&
      registeredNames(readFileSync(backend, 'utf8'), backend).includes(name)
    );
  });

  // What each composition root registers, and what each converted module
  // registers for itself — the two sets whose overlap and whose difference are
  // both bugs. See `findRootIssues`. The capture rule reads the same map: a
  // name its owner provides as a port is a gate, and capturing a gate is
  // refused even for the module that owns it (D-38b).
  const moduleRegistered = new Map<string, string>();
  // Wider than the map above by the contribution-point defaults: what the
  // platform sweep asks is "does a module own this name at all", and a
  // `ctx.di.register` default is enough to answer yes (D-73).
  const moduleOwnedNames = new Map<string, string>();
  for (const [moduleId, file] of moduleEntryPoints) {
    const source = readFileSync(file, 'utf8');
    for (const name of providedPortNames(source, file)) {
      moduleRegistered.set(name, moduleId);
    }
    for (const name of registeredNames(source, file)) {
      moduleOwnedNames.set(name, moduleId);
    }
  }
  // A package's names belong in both, for the reason the tree's do: a gated
  // port of a package is a gate like any other, and a `PLATFORM_OWNED_NAMES`
  // entry a package owns is a module-owned name laundering a cross-module edge
  // past two exemptions (D-73), whichever tree the module lives in.
  for (const claimed of packages.containerNames) {
    if (claimed.gated && !moduleRegistered.has(claimed.name)) {
      moduleRegistered.set(claimed.name, claimed.moduleId);
    }
    if (!moduleOwnedNames.has(claimed.name)) moduleOwnedNames.set(claimed.name, claimed.moduleId);
  }

  // The modules the orchestrator refuses to switch off on either axis, read
  // from their manifests rather than listed here — see `CheckInput`.
  const neverAbsentOwners = new Set(
    DISCOVERED_MANIFESTS.filter(
      (entry) =>
        (entry.manifest.activation as { nonDeactivatable?: boolean } | undefined)
          ?.nonDeactivatable === true,
    ).map((entry) => entry.id),
  );

  const violations = findViolations({
    resolutions,
    owners,
    dependencies,
    providedPorts: moduleRegistered,
    neverAbsentOwners,
    acknowledged,
  });

  // What the third array has to be true of, D-44 §7. An entry here clears the
  // ownership rule outright, so it is held to the tree rather than to its
  // author's word.
  const nonBindingIssues = findNonBindingIssues({
    edges: nonBindingEdges,
    owners,
    providedPorts: moduleRegistered,
    resolutions,
  });

  // The deactivation-consequence ledger (feature 074) — the same edges,
  // answering the operator's question instead of the container's: when this
  // owner is switched off, what happens to each module that reads it? An edge
  // with no answer fails the build here, and the answers are what the
  // confirmation dialog renders. See `services/deactivation-ledger.ts`.
  const ledger: DeactivationLedger = buildDeactivationLedger({
    reads: ledgerReads({ resolutions, seams, owners, providedPorts: moduleRegistered }),
    declaredDependencies: dependencies,
    nonBinding: nonBindingEdges,
    neverAbsentOwners,
    // D-101 §5 — the acknowledged edges into locked owners are in the
    // population now. The lock binds the flip, not the shipping set: a
    // deployment may omit the module, and since D-101 only by declaring it, so
    // these rows are what that declaration is read against.
    acknowledged: acknowledgedPortEdgesFrom(manifests).map((edge) => ({
      moduleId: edge.moduleId,
      name: edge.port,
    })),
    contributionPolicies: CONTRIBUTION_POLICY_STATED,
    excludedNames: new Set([...Object.keys(HOST_REGISTERED_PORTS), ...PLATFORM_OWNED_NAMES]),
  });
  // The debt table excuses **one** shape, and only for the name it lists: a
  // policy the owner has not stated yet. A capture or an early gate resolution
  // over the same name is a different failure with a different fix, and an
  // entry here must not clear it — that width is what made the alias table the
  // widest suppression in this file.
  const unassigned = ledger.unassigned.filter(
    (edge) =>
      edge.shape !== 'registry-without-policy' ||
      REGISTRY_POLICIES_UNSTATED[`${edge.dependsOn}:${edge.name}`] === undefined,
  );
  // The same two-way sweep every other table here gets: a policy debt nothing
  // reads any more is a claim about the tree that has stopped being true.
  const readPairs = new Set(
    ledger.unassigned
      .filter((edge) => edge.shape === 'registry-without-policy')
      .map((edge) => `${edge.dependsOn}:${edge.name}`),
  );
  const policyDrained = Object.keys(REGISTRY_POLICIES_UNSTATED).filter(
    (entry) => !readPairs.has(entry),
  );

  // A drain-list entry whose site is fixed is dead weight, and dead weight in a
  // debt table is how the debt outlives the fix.
  const wiringSites = new Set(
    resolutions
      .filter((r) => r.site === 'wiring' && moduleRegistered.has(r.name))
      .map((r) => `${r.moduleId}:${r.name}`),
  );
  const drained = [...WIRING_RESOLUTIONS_TO_DRAIN].filter((entry) => !wiringSites.has(entry));
  // The same sweep for the issue #90 debt: an entry nothing resolves any more is
  // a suppression with no site under it, and this one suppresses every kind.
  const resolvedPairs = new Set(resolutions.map((r) => `${r.moduleId}:${r.name}`));
  const aliasDrained = Object.keys(ALIAS_HIDDEN_RESOLUTIONS).filter(
    (entry) => !resolvedPairs.has(entry),
  );
  const rootNames = new Map<string, ReadonlySet<string>>();
  for (const [label, relative] of Object.entries(ROOT_FILES)) {
    const full = join(layout.applicationRoot, relative);
    if (!existsSync(full)) continue;
    rootNames.set(label, new Set(rootRegisteredNames(readFileSync(full, 'utf8'), full)));
  }
  const rootIssues = findRootIssues({
    moduleRegistered,
    rootNames,
    hostRegistered: HOST_REGISTERED_PORTS,
    resolvedNames: new Set(resolutions.map((r) => r.name)),
    platformNames: PLATFORM_OWNED_NAMES,
    kernelNames,
    moduleOwnedNames,
  });

  if (process.argv.includes('--list')) {
    for (const resolution of resolutions.sort((a, b) => a.moduleId.localeCompare(b.moduleId))) {
      const owner = owners.get(resolution.name) ?? (PLATFORM_OWNED_NAMES.has(resolution.name) ? 'platform' : '?');
      console.log(`  ${resolution.moduleId} → ${resolution.name} [${owner}]`);
    }
  }

  // This check measures container resolutions, and its reach has twice been the
  // defect: a `port(ctx, name)` helper hid fourteen of them, and a module-local
  // cradle alias hid ninety-eight more, both while the run read clean (issue
  // #113). Eight hundred and fifty resolutions collapsing to none is that
  // failure, not a tree in which no module reads another's port.
  if (resolutions.length === 0) {
    console.error(
      '[port-deps] no container resolution seen anywhere in the tree — ' +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  // The ledger's own vacuous guard, and it is a different failure from the one
  // above: the classification runs off the manifest set as well as the scan, so
  // a manifest index that loaded but carried no edge — or a tree in which every
  // owner reads as non-deactivatable — would classify nothing and report green.
  if (ledger.entries.length === 0) {
    console.error(
      '[port-deps] the deactivation ledger classified no edge at all — ' +
        'refusing to report a vacuous pass',
    );
    process.exit(2);
  }

  // What was read, in the shared grammar (issue #244). The port resolutions are
  // the finer population: `resolutions.length === 0` was already a floor, but a
  // number that halves silently is the case the floor cannot see.
  const installed = packageCoverage(packages);
  const coverages: ReadCoverage[] = installed === null ? [coverage] : [coverage, installed];
  reportReadSize({
    prefix: '[port-deps]',
    files: files.length + packages.filesRead,
    sites: resolutions.length,
    coverage: coverages,
  });
  console.log(
    `[port-deps] modules scanned=${new Set(files.map(moduleOf)).size} ` +
      `resolutions=${resolutions.length} violations=${violations.length} ` +
      `root-issues=${rootIssues.length} ` +
      `packages=${packages.discovered} package-names=${packages.containerNames.length} ` +
      `platform-names=${PLATFORM_OWNED_NAMES.size} kernel-supplied=${
        [...PLATFORM_OWNED_NAMES].filter((name) => kernelNames.has(name)).length
      } ` +
      `wiring-debt=${WIRING_RESOLUTIONS_TO_DRAIN.size - drained.length} ` +
      `alias-debt=${Object.keys(ALIAS_HIDDEN_RESOLUTIONS).length - aliasDrained.length} ` +
      `non-binding=${nonBindingEdges.length} non-binding-issues=${nonBindingIssues.length} ` +
      `import-seams=${seams.length} ` +
      `ledger=${ledger.entries.length} ledger-excluded=${ledger.excluded} ` +
      `policy-debt=${Object.keys(REGISTRY_POLICIES_UNSTATED).length - policyDrained.length} ` +
      `ledger-unassigned=${unassigned.length}`,
  );

  if (drained.length > 0) {
    console.error(
      `\nWIRING_RESOLUTIONS_TO_DRAIN entries that no longer resolve a gated port in a ` +
        `ctx.routes body — delete them, so the table keeps meaning what it says:`,
    );
    for (const entry of drained) console.error(`  - ${entry}`);
  }

  if (aliasDrained.length > 0) {
    console.error(
      `\nALIAS_HIDDEN_RESOLUTIONS entries nothing resolves any more — delete them, so the ` +
        `table keeps meaning what it says:`,
    );
    for (const entry of aliasDrained) console.error(`  - ${entry}`);
  }

  if (stale.length > 0) {
    console.error(
      `\nHOST_REGISTERED_PORTS entries whose owner now registers the port itself — delete them:`,
    );
    for (const [name, owner] of stale) console.error(`  - ${name} (${owner})`);
  }

  if (rootIssues.length > 0) {
    console.error(
      `\nA composition root registers a port wrongly. Neither shape shows up as a type error ` +
        `and neither breaks the composition it is written in:`,
    );
    for (const issue of rootIssues) console.error(describeRootIssue(issue));
  }

  if (nonBindingIssues.length > 0) {
    console.error(
      `\nA \`nonBindingDependencies\` entry does not hold. The entry withdraws the refusal ` +
        `that would have stopped an operator switching the owner off underneath it, so what ` +
        `it claims about the edge has to be true:`,
    );
    for (const issue of nonBindingIssues) console.error(describeNonBindingIssue(issue));
  }

  if (violations.length > 0) {
    console.error(
      `\nA module resolves a port it does not declare. The declaration is what makes the ` +
        `dependency real to the lifecycle, to the migration order and to an operator ` +
        `switching the provider off:`,
    );
    for (const violation of violations) console.error(describe(violation));
  }

  if (policyDrained.length > 0) {
    console.error(
      `\nREGISTRY_POLICIES_UNSTATED entries nothing reads without a policy any more — delete ` +
        `them, so the table keeps meaning what it says:`,
    );
    for (const entry of policyDrained) console.error(`  - ${entry}`);
  }

  if (unassigned.length > 0) {
    console.error(
      `\nAn edge into a module an operator may switch off has no defined behaviour. Every ` +
        `such edge answers one of four ways — it fails closed at the seam, it degrades as its ` +
        `own manifest declares, it is a contribution the host filters, or it is schema-only ` +
        `and nothing stops. These answer a fifth way, which is silently wrong:`,
    );
    for (const edge of unassigned) console.error(describeUnassignedEdge(edge));
  }

  process.exit(
    violations.length === 0 &&
      stale.length === 0 &&
      rootIssues.length === 0 &&
      drained.length === 0 &&
      aliasDrained.length === 0 &&
      nonBindingIssues.length === 0 &&
      policyDrained.length === 0 &&
      unassigned.length === 0
      ? 0
      : 1,
  );
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the full scan + process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
