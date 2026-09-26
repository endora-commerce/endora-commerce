import type { AssetsLibraryCradle } from '@endora-commerce/mod-assets-library/backend';
import type { CartShoppingListBridge } from '@endora-commerce/mod-carts/backend';
import type { FastifyRequest } from 'fastify';
// Feature 080 (T052) — the contract types for the seven ports that replaced
// this root's five entity-class reads. Types only: what a root resolves is a
// container name, and the shape it resolves it against is published in
// `@endora-commerce/contracts` rather than imported from the provider.
//
// `specs/110-instance-repository/` T118 — and four more joined them for the
// same reason one layer out. This root's remaining container reads spelled
// their shape by importing the registering module's cradle interface, which is
// a reach D-52/D-53 refuses once this code is inside
// `@endora-commerce/platform`. Where the owner already registers the name as a
// `providePort` over a published shape, that shape is what the read names.
import type {
  AdminI18nTranslatePort,
  AdminPasswordVerificationPort,
  AdminRolePort,
  AdminUserReadPort,
  CartMergeOutcome,
  CustomerAccountReadPort,
  CustomerPasswordVerificationPort,
  CustomerRollupScopePort,
  EmailMailerPort,
  OrganizationTaxProfilePort,
  TaxServicePort,
} from '@endora-commerce/contracts';
import type { ModulePlugin } from '@endora-commerce/platform/composition';
import { initOrm, closeOrm } from './db/index.js';
import { type TenantContext } from './tenancy/tenant-context.js';
import { resolveTenantContext, systemTenantContext } from '@endora-commerce/platform/composition';
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
// The published half — `resolvePublicApiBaseUrl` is on the barrel because
// several modules read it (§1.3 row 6's "+4"), and `ModuleContext` because 67
// do: `ComposeAppHandle.contextFor` hands one out, so a CLI command's body
// resolves with `lazyPort(ctx, …)` exactly as `backend.ts` does (T042b,
// D-157.12 item 2).
//
// **`configuredPublicApiBaseUrl` and `absolutizePublicUrl` are both gone from
// this file** (D-223). One question — what origin does an asset URL start on —
// had five answers in this tree, three of them here and no two of them the
// same: `absolutizePublicUrl` reading `BACKEND_PUBLIC_URL` first at the `pwa`
// and transactional-email sites, `configuredPublicApiBaseUrl` plus a
// hand-written join reading `PUBLIC_API_BASE_URL` first at the product-feed
// one, and nothing at all at `megamenu`'s. `assets_library` resolves the origin
// itself now and every URL it produces is absolute, so a root that rebases one
// is a root that can disagree with the module and with the other root — which
// both of them did.
// T118b — and **no** reach into that package for `request.actor` any more. This
// import used to be `import type { Actor } from '@endora-commerce/mod-auth/backend'`,
// whose real job was not the type: it dragged `auth`'s `declare module 'fastify'`
// block into this file's program, because an ambient augmentation reaches a
// program only if the file declaring it is *in* it. The block is the platform's
// now (`@endora-commerce/platform/http`, arriving through the `./composition`
// import below) and the shape is `@endora-commerce/contracts`'; a root that reads
// `request.actor` names neither `auth` nor any other module for it.
import { effectiveState } from './kernel/lifecycle/effective-state.js';
// Feature 072 (T138) — `organizations` owns its services, its routes and its
// two event subscriptions. T143a — the sales-rep assignment scope too: what is
// left here is the actor half of the orders/RFQ visibility question, which only
// a composition can answer.
//
// T118 — the two type imports that stood here are gone. `organizationTreeService`
// is read against the one method this root calls (below, beside `salesRepScope`,
// which has always been written that way), and `organizationTaxProfilePort`'s
// shape is `@endora-commerce/contracts`' now, which is where a `providePort`
// name's type argument belongs whoever resolves it.
// Feature 072 (T079) — `email` is composed through the kernel. The driver
// decision that used to sit in this file is one registration in its
// `backend.ts`; what stays here is the mailer the senders below resolve. The
// URL helper that also stayed was `absolutizePublicUrl`, and feature 080's
// T040b moved it to the platform: it had no consumer inside `email` at all, so
// it was a deployment-origin helper filed under the module that first needed it
// — and a root value import of a module's source is a spelling that ends the
// day that module becomes a package (D-160.6.1). D-223 has now removed its last
// consumer here as well, so it is off the `./composition` barrel too: the
// declaration stays in the platform and returns to the barrel the day an
// application needs it, which is the treatment `AdminActorPromotion` had.
// Feature 046 — Returns & Complaints (Refunds, RMA).
// Feature 047 — Invoices. No type import: T118c retired `invoicesBridge` and
// this root contributes nothing for the module.
// Feature 046 — Progressive Web App. No type import: T118c retired `pwaBridge`
// and this deployment contributes nothing for the module.
// Feature 047 — Transactional Emails.
// Feature 048 — Newsletter. No type import: `specs/117-instance-bring-up/`
// Phase 6 retired `newsletterBridge` and this deployment contributes nothing
// for the module beyond the branding accessor, which is the module's own
// contribution point.
// Feature 049 — Google Analytics.
// Feature 063 — LinkedIn Ads.
// Feature 064 — Meta Ads.
// Feature 066 — Google Tag Manager.
// T118 — the error envelope's assembly, by the **declared** subpath rather than
// by a relative path into the platform. `./composition` is host-internal (a
// module naming it is `check:platform-surface`'s `host-internal-subpath`), which
// is exactly what this file is, and it is the spelling that leaves no new shim
// behind: `RELATIVE_HOST_REACHES` is the ledger T119 drains, and a repair that
// added to it would be moving in the wrong direction.
//
// T118 — and this is where the assembly itself now comes from. `composeApp` is
// aliased on the way in because this file exports one of its own: the platform
// composes any deployment, and the export below is *this* deployment's, which
// is the platform's plus the module list, the artefacts and the contributions
// only this repository has (R1.4).
import {
  composeApp as composePlatformApp,
  type ComposeAppHandle,
  type ComposeAppOptions,
  type ComposedAppContext,
} from '@endora-commerce/platform/composition';
import { lifecycleModuleFromStaticEntries } from '@endora-commerce/platform/lifecycle';
import { loadDivergenceDeclaration } from './overlay/divergence-loader.js';
import { resolvedManifestEntries } from './lifecycle/registered-manifests.js';
// Feature 057 — per-deployment overlay resolution (build/composition-time).
import { loadOverlayModuleEntries } from './overlay/overlay-runtime.js';
// Feature 080 — installed extension packages, discovered at runtime (D-155).
import { loadPackageModuleEntries } from './packages/package-runtime.js';
import { configuredMigrations } from './db/configured-migrations.js';
// D-54 — the error envelope takes this map by injection: `src/http` is a
// kernel-obeying platform peer and may not name a module (D-52). A root may.
//
// Feature 090 — and the map is *derived* rather than imported whole:
// `buildErrorTranslationTargets` is nothing but the modules' own `errorCodes`
// declarations. Which modules a deployment resolved is a composition-root
// input, which is why the call is here and not inside `_i18n`. Phase 4 deleted
// the prefix chain and the transitional composition that laid the declarations
// over it; a code no registered manifest declares now routes nowhere and the
// envelope answers the raising code's own English (§4.1).
//
// Feature 117 (FR-030) — and that sentence is now where the *function* lives
// too. The derivation is the platform's, at `kernel/i18n/error-translation.ts`,
// beside `request-language.ts`, which produces the envelope's other injected
// member. It was `_i18n`'s and had no consumer inside `_i18n`; what stays that
// module's is `translate`, resolved out of the container below. The routing is
// derived from manifests, the translation is a service.
/**
 * The reference deployment's composition root.
 *
 * Wires every business module against:
 *   - the real auth plugin (cookie / Bearer token → `request.actor`)
 *   - a permission-checked `requireAdmin` that consults `PermissionService`
 *   - resolvers that read from `request.actor` instead of the test-only
 *     `request.testActor` shim used by `test/helpers/test-server.ts`
 *
 * The dev script (`pnpm --filter backend run dev`) and the prod entry
 * (`backend/src/index.ts`) both call `composeApp({ deploymentRoot })` and then
 * `buildServer({ … modules: composition.modules })`.
 *
 * **`ComposeAppOptions` and `ComposeAppHandle` are the platform's** since
 * `specs/110-instance-repository/` T118, and are re-exported here so the entry
 * points, the CLI and the boot tests keep one import. Their doc blocks moved
 * with them: a shape every deployment shares is documented where every
 * deployment reads it.
 */
export type { ComposeAppHandle, ComposeAppOptions };

/**
 * The two seams this deployment fills in during the contribution window.
 *
 * Both need the composed container, and the container does not exist until
 * every module has registered — so the values are written inside the window and
 * read after it closes: `scopedPlugins` when the platform assembles the plugin
 * chain, `buildTenantContext` on the first request. It is the shape
 * `test/helpers/test-server.ts` spells as `let container!: KernelContainer`,
 * one indirection wider because the contributions live in a function of their
 * own rather than in the callback.
 */
interface DeploymentSeams {
  /** Route plugins mounted **after** the request-scope hook. */
  readonly scopedPlugins: ModulePlugin[];
  /**
   * The actor → `TenantContext` mapping (Principle XI).
   *
   * The hook that installs it is the platform's and is installed on every
   * composition; only the mapping is here, because it reads `request.actor` —
   * `auth`'s `declare module 'fastify'` block, which T118b relocates.
   */
  buildTenantContext?: (request: FastifyRequest) => Promise<TenantContext>;
}

/**
 * The container reads this root makes, declared as **what it calls** rather
 * than as the registering module's cradle interface
 * (`specs/110-instance-repository/` T118).
 *
 * A composition root resolves a **container name**, and a name is a string. The
 * type it asserts the resolution against was, for nine of these, the module's
 * own `XCradle` — which made a type reach into the module that registers the
 * name, and D-52/D-53 refuses one from inside `@endora-commerce/platform`,
 * where T118 moves this code. Nothing was gained by it either: the assertion is
 * unchecked in both spellings (`container.cradle as unknown as XCradle` is the
 * same `as` either way), so the cradle bought the *member's* signature and
 * nothing about whether the name resolves.
 *
 * Two spellings, and which one applies is decided by the owner's registration,
 * never by preference:
 *
 *   - the owner registers the name as a `providePort` over a **published**
 *     shape ⇒ the read names that shape, and it is the one the provider is
 *     already checked against. `taxService`, `adminI18nService`, `emailMailer`
 *     and `organizationTaxProfilePort` are those, and the last of them moved to
 *     `@endora-commerce/contracts` in this commit because a port's type argument
 *     is a contract type and never the provider's file (composition checklist
 *     item 3);
 *   - nothing is published for it ⇒ the read declares the one method it calls,
 *     which is what `salesRepScope` and `emailCradle` below have always done.
 *
 * These are **narrow on purpose**. Widening one to the module's whole service
 * would restate a declaration this root is not the author of, and the next
 * reader would take the restatement for a contract. What a member is *supposed*
 * to be is the owner's to say; what this root needs is what it calls.
 */
interface ContainerReads {
  /** Owner: `admin_users`. Turning actor ids into names for the audit log. */
  readonly adminUserService: {
    listByIds(
      ids: string[],
    ): Promise<Array<{ id: string; firstName: string; lastName: string; email: string }>>;
  };
  /** Owner: `_i18n`. The envelope's translation step (D-127). */
  readonly adminI18nService: AdminI18nTranslatePort;
  /** Owner: `carts`. Anonymous-cart adoption at login. */
  readonly cartService: {
    mergeAnonymousIntoCustomer(
      anonymousToken: string,
      customer: { customerAccountId: string; organizationId: string | null },
    ): Promise<CartMergeOutcome>;
  };
  /**
   * Owner: `catalog`. The category→product expansion `product_feeds` reads
   * through this root because a feed run must not reach `catalog`'s tables.
   */
  readonly catalogQueryPort: {
    expandCategoryProductIds(categoryIds: string[]): Promise<Map<string, Set<string>>>;
  };
  /** Owner: `comparisons`. Anonymous-comparison adoption at login (R-2 / FR-005). */
  readonly comparisonService: {
    adoptAnonymousComparison(customerAccountId: string, anonymousToken: string): Promise<unknown>;
  };
  /** Owner: `customer_accounts`. The Rule Builder's customer-group picker source. */
  readonly customerGroupService: {
    list(): Promise<Array<{ id: string; code: string; name: string }>>;
  };
  /** Owner: `email`. The one mailer six senders share (D-59). */
  readonly emailMailer: EmailMailerPort;
  /** Owner: `organizations`. The VAT facts a quote's tax rate depends on (T143c). */
  readonly organizationTaxProfilePort: OrganizationTaxProfilePort;
  /**
   * Owner: `organizations`. The subtree walk a roll-up-enabled customer's
   * tenant context widens over (feature 056, US2).
   */
  readonly organizationTreeService: { subtreeIds(organizationId: string): Promise<string[]> };
  /** Owner: `sales_channels`. The Rule Builder's channel picker source. */
  readonly salesChannelsService: {
    list(options: Record<string, unknown>): Promise<{
      items: Array<{ id: string; code: string; name: unknown }>;
    }>;
  };
  /** Owner: `taxes`. The rate a quote is priced at. */
  readonly taxService: TaxServicePort;
}

/**
 * The `shopping_lists` service, as the two `carts` bridge members call it.
 *
 * Named rather than inlined because it is the type of a `let` the sink below
 * fills in, and a sink's parameter and its variable have to agree.
 */
interface ShoppingListBridgeService {
  addItem(
    ctx: { customerAccountId: string; organizationId: string },
    listId: string,
    input: { productId: string; variantId?: string; quantity: number },
  ): Promise<unknown>;
  convertToCart(
    ctx: { customerAccountId: string; organizationId: string },
    listId: string,
    itemIds: string[] | undefined,
  ): Promise<{ added: number; skipped: Array<{ productId: string }> }>;
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

/**
 * The key this repository's development and test processes sign with.
 *
 * Public by construction — it is in a public repository, which is exactly why
 * {@link resolveSessionCookieSecret} may not reach it under
 * `NODE_ENV=production`. `index.ts` has carried this literal since the
 * beginning; what changes is that it is stated once, and readable from the
 * environment, rather than restated in two entry points and visible to neither
 * the platform nor anything else that composes.
 *
 * It lives in this file rather than in one of its own because a self-contained
 * file in `backend/src` naming no path of this tree is what
 * `test/unit/kernel/host-residue-partition.test.ts` derives as
 * **platform-shaped** — code a client must never edit, sitting in the tree
 * SC-007 says holds no such thing. A development default for *this*
 * repository's signing key is the opposite of platform-shaped: it is what the
 * docblock below calls "what only this deployment knows", and an instance's own
 * entry point deliberately has no fallback at all.
 */
export const DEVELOPMENT_SESSION_COOKIE_SECRET = 'dev-secret-change-me';

/**
 * Resolve `SESSION_COOKIE_SECRET`, publishing this deployment's development
 * default **into `process.env`**, so that every later reader of that variable
 * sees what was resolved.
 *
 * There are two readers and only one of them is an entry point. `index.ts` and
 * `worker.ts` hand the value to `buildServer` to sign cookies with; the
 * platform's `composeApp` reads the same variable as the last link of
 * `NEWSLETTER_TOKEN_SECRET ?? SESSION_COOKIE_SECRET ?? ''`, which is what
 * newsletter confirmation and unsubscribe links are signed with. The second
 * reader is why publishing it matters: a default computed into a `const` is
 * invisible to it, `NewsletterTokenHelper` refuses an empty string, and a tree
 * with no `backend/.env` therefore composed no modules at all — while naming a
 * module nobody had touched.
 *
 * **A scaffolded instance already works this way.** `NEWSLETTER_TOKEN_SECRET`
 * is declared `secret` and `generable`, so `endora new instance` generates it
 * into the instance's `.env` and the instance's processes read it from the
 * environment like any other input. The reference deployment was the odd one
 * out.
 *
 * Returns the empty string when a production deployment has not been given a
 * key: under `NODE_ENV=production` nothing is invented and nothing is written.
 * The callers refuse to start on it, which is the behaviour they have always
 * had; this function does not exit a process it does not own.
 */
export function resolveSessionCookieSecret(): string {
  const supplied = process.env['SESSION_COOKIE_SECRET'];
  // An empty value is the same state as no value at all, which is the rule
  // `@endora-commerce/cli`'s `inputs/env-file.ts` states for the instance side.
  if (supplied !== undefined && supplied !== '') return supplied;
  if (process.env['NODE_ENV'] === 'production') return '';
  process.env['SESSION_COOKIE_SECRET'] = DEVELOPMENT_SESSION_COOKIE_SECRET;
  return DEVELOPMENT_SESSION_COOKIE_SECRET;
}

/**
 * The reference deployment's composition root.
 *
 * `specs/110-instance-repository/` T118 moved the **assembly** into
 * `@endora-commerce/platform` (R1.4): the ORM, the container, the host values,
 * the presence load, the two sub-kernels, the one `composeModules` pass, the
 * request-scope hook, the settings reconcile, the boot phase and the error
 * envelope are one function there, and every deployment runs the same one.
 *
 * What is left here is what only *this* deployment knows, and it is four things:
 * the compiled-in module list, the artefacts that list was generated from, this
 * repository's ORM configuration, and the 41 contributions whose value
 * expressions name a module — which the platform may not hold (D-52/D-53) and
 * which therefore arrive through the contribution callback.
 *
 * **An instance holds none of this** (R2.4). It calls `composeApp` with a
 * deployment root and no callback, so no file in a client's tree contributes a
 * value over a name a module defaults. This file is not an instance; it is the
 * reference deployment, which is a different thing.
 */
export async function composeApp(options: ComposeAppOptions): Promise<ComposeAppHandle> {
  const { deploymentRoot } = options;

  // This deployment's environment, before anything reads it. `SESSION_COOKIE_SECRET`
  // is the last link of the platform's `NEWSLETTER_TOKEN_SECRET ?? SESSION_COOKIE_SECRET
  // ?? ''`, and `NewsletterTokenHelper` refuses the empty string — so a tree with no
  // `backend/.env` composed nothing at all and blamed a module nobody had touched.
  // Resolved **here** rather than in `index.ts` because `index.ts` is not the only
  // caller: `cli.ts` composes for every `module:*` and `admin:create` invocation, and
  // `test/integration/kernel/production-boot.test.ts` composes to prove this root
  // boots. A default that only one of the three applies is a default two of them
  // cannot see. The return value is the callers' business; what this line is for is
  // the environment it publishes. The function is above, with its reasoning.
  resolveSessionCookieSecret();

  // Feature 057 — resolve the per-deployment overlay once. For a bare-core
  // build (no DEPLOYMENT / no overlay dir) all of these are empty and the
  // wiring below is byte-for-byte unchanged.
  //
  // D-104 — one implementation of "the deployment-resolved manifest set", and
  // one of "the deployment's composed modules". Both are runtime discoveries
  // over the deployment root, because both answers depend on which deployment
  // this process runs as rather than on the tree a generator was run against.
  const resolvedRegistry = await resolvedManifestEntries();
  const overlayModuleEntries = await loadOverlayModuleEntries(process.env, deploymentRoot);
  // Feature 107 — read once and used twice, by the presence load below for
  // D-101's declared omissions and by `composeModules` for the decoration
  // order. Two loads would be two `import()`s of one file answering one
  // question, which is the shape this repository refuses everywhere else.
  const divergenceDeclaration = await loadDivergenceDeclaration(process.env, deploymentRoot);
  // Feature 080 (T031, D-119/D-155) — the same shape, one axis out: every
  // Endora module package installed in this instance's `node_modules`. The
  // committed registries stay bare core for D-104's reason, so this is the only
  // thing that knows a package is here.
  const packageModuleEntries = await loadPackageModuleEntries();

  // The two seams the contribution callback fills in, because both need the
  // composed container and the container does not exist until every module has
  // registered. They are a mutable object for the reason the harness's are
  // `let` (`test/helpers/test-server.ts`): the value is read after the window
  // closes — `scopedPlugins` when the platform assembles the plugin chain,
  // `buildTenantContext` on the first request — and never during it.
  const seams: DeploymentSeams = { scopedPlugins: [] };

  return composePlatformApp({
    deploymentRoot,
    composition: {
      // Feature 072 — the **generated** module list. Nothing about these
      // modules is named here any more: the list is a walk of the tree, so
      // adding a module is adding a folder and removing one is deleting it.
      //
      // D-103/D-104 — the deployment's overlay modules are appended to this one
      // list, not composed by a second path, and T031 puts the instance's
      // installed packages after them for the same reason. Order is not a
      // privilege: registration resolves nothing (the `registering` guard), and
      // a package gets no decoration exemption.
      modules: [...MODULES, ...overlayModuleEntries, ...packageModuleEntries],
      manifests: resolvedRegistry,
      // T116 — this build's ORM configuration, which runs through
      // `./mikro-orm.config.js` to the two committed registries. They are facts
      // about this repository's tree (D-160.3) and the platform may not name
      // them, so it is handed the opener and the closer instead.
      orm: { open: initOrm, close: closeOrm },
    },
    // Feature 107 (FR-040/FR-041) — the wrapping order this deployment declares
    // for a registration more than one of its overlay modules decorates, from
    // `backend/src/apps/<deployment>/divergence.ts`. Checked, never applied.
    decorationOrder: divergenceDeclaration.decorationOrder,
    // D-101 — and the omissions from the same declaration, which the presence
    // load reads. The platform may not locate the file (D115-3), so the value
    // is supplied rather than read.
    declaredOmissions: divergenceDeclaration.omittedModules.map((entry) => entry.moduleId),
    // `customerOrganizationIdResolver` was the one entry here and is
    // `composeApp`'s since `specs/117-instance-bring-up/` Phase 6. The comment
    // that stood in its place said it stayed *"because it reads
    // `request.actor`, which is `auth`'s `declare module 'fastify'` block —
    // T118b's subject"*, and T118b is the merge request that moved that
    // augmentation into the platform and took the nine other actor-shaped
    // names with it. The blocker expired in the commit that was supposed to
    // clear it, and the cost was borne by every composition that is not this
    // file: four modules read the name and nothing defaulted it.
    // Feature 050 — establish the ambient TenantContext for every request from
    // the already-authenticated actor (never from request inputs). The mapping
    // is this deployment's until T118b relocates the `request.actor`
    // augmentation; the *hook* is the platform's and always installed.
    buildTenantContext: async (request: FastifyRequest): Promise<TenantContext> => {
      if (seams.buildTenantContext === undefined) {
        throw new Error(
          'the reference deployment did not install its tenant-context mapping — a request ' +
            'reached the scope hook before the contribution window ran, which cannot happen ' +
            'through composeApp and means this root was assembled by hand (Principle XI).',
        );
      }
      return seams.buildTenantContext(request);
    },
    scopedPlugins: seams.scopedPlugins,
    contribute: (ctx) => contributeReferenceDeployment(ctx, seams),
  });
}

/**
 * The 41 contributions whose value expression names a module, plus the locals
 * they are built from.
 *
 * A separate function rather than an inline callback, so the block below keeps
 * the indentation — and therefore the diff — it had while it was
 * `composeApp`'s own body. Everything it needs comes off the composed context;
 * it constructs nothing the platform already built.
 *
 * `specs/075-cross-module-decoupling-sweep/` Phase C is what drains it: each
 * entry retires as a `lazyPort` in the owning module's own registration, with
 * the edge in that module's manifest `dependencies` (T118c).
 */
async function contributeReferenceDeployment(
  ctx: ComposedAppContext,
  seams: DeploymentSeams,
): Promise<void> {
  const {
    container,
    em,
    redis,
    auditLogService,
    orm,
    redisSubscriber,
    resolvedModules: resolvedRegistry,
    composed: composedModules,
  } = ctx;
  const { scopedPlugins } = seams;

  // `searchCradle` stood here to forward `search`'s full-reindex port into
  // `catalogSearchReindex`. `specs/117-instance-bring-up/` Phase 6 retired the
  // contribution: `catalog` resolves `searchReindexPort` itself and declares
  // the edge, which is what "the module that owns the indexer answers for it"
  // was always going to mean.

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

  // `orderReadPort` had an accessor here until `specs/110-instance-repository/`
  // T118c, and `pwaBridge`'s `resolveOrderTarget` was its **only** reader in
  // either root. `pwa` resolves the port itself now and declares `orders` in its
  // manifest, so the read is gone from both compositions rather than moved. That
  // is the `mfa` target's `adminActorPromotion` shape again: a root accessor
  // whose last consumer was the bridge it existed for.

  // Feature 080 (T040b) — the two ports that replaced this root's value
  // imports of a module's own sources. Same reason as the block above and the
  // same lazy read: a packaged module publishes `./backend`, not a file path,
  // so a root that names one stops compiling the day its owner moves — and a
  // root that names the *source* of a module the platform composes from `dist`
  // evaluates it twice, which fails silently rather than loudly (D-160.6.1).
  const customerRollupScopePort = (): CustomerRollupScopePort =>
    (container.cradle as never as { customerRollupScopePort: CustomerRollupScopePort })
      .customerRollupScopePort;

  // Feature 117 (FR-030) put actor promotion on the container as
  // `promoteAdminActor`, read here rather than imported, because a value import
  // of a module could not travel to `@endora-commerce/platform` with the rest of
  // the contribution wiring. **T118c removed this root's only call**: it sat
  // inside `mfaActorBridge.resolveAdminActor`, ahead of a read every one of that
  // member's call sites had already had `requireAdmin` perform — `auth`'s guard
  // promotes and then refuses a non-admin, and the promotion is idempotent. The
  // port stays registered by `auth`; nothing in either composition root resolves
  // it today.

  // `assetReadPort` had an accessor here until T118c, and `invoicesBridge`'s
  // `loadAssetImage` was its **only** reader in this root. `invoices` resolves
  // the port itself now and declares `assets_library` in its manifest, so the
  // read is gone from this composition rather than moved — the same shape as
  // `pwa`'s `orderReadPort` accessor and `mfa`'s `adminActorPromotion`.

  /**
   * The remaining container reads, against {@link ContainerReads} (T118).
   *
   * A function rather than a captured object, for the reason every accessor
   * above is one: a gated name resolves per call, so a switched-off owner
   * answers at the call site instead of through a handle this root is holding.
   * Reading the whole cradle here would resolve nothing — awilix resolves on
   * property access — but returning it as a value would still invite a capture.
   */
  const reads = (): ContainerReads => container.cradle as never;

  // `inventoryCradle` stood here to forward `inventory`'s availability port
  // into `catalogExternalAvailability`, retired in the same phase and for the
  // same reason: `catalog` resolves the port and keeps the D-61 presence probe
  // that closure carried.


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

  // `customerResolver` and `adminContextResolver` stood here — two local copies
  // of the platform's own `customerContextResolver` and `adminContextResolver`,
  // which `composeApp` contributes (T118b) and which this file's own comments
  // already described as mirrored. **`invoicesBridge` was their only caller in
  // this root** (`specs/110-instance-repository/` T118c), so they are deleted
  // rather than moved: what the bridge's two actor members did was spell a
  // second time, in a second place, an answer this composition already
  // publishes under another name — the divergence `mfa` found in two of its six
  // members and `pwa` in one of its eight, here in its third and last shape.
  //
  // Both refusals and D-178's reasoning travel with them: the platform's
  // versions carry the 401 and the 500 verbatim, with the invariant note in
  // full. Nothing in this root asks either question directly any more.

  // `resolveCustomerAccountId` stood here for customer routes that work with or
  // without an Organization, and it was byte-for-byte the platform's own
  // `customerAccountIdResolver` under a second name. Its last reader was
  // `newsletterBridge`, retired by `specs/117-instance-bring-up/` Phase 6, and
  // the module resolves the platform's name instead — one closure, one place.

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
  const organizationTreeService = (): ContainerReads['organizationTreeService'] =>
    reads().organizationTreeService;

  // Feature 072 (T101) — `credit_limits` owns its service and routes now, and
  // since T143c the return-settlement top-up as well, so this root reads
  // nothing of the module.

  // Feature 055 — Custom Fields Layer, converted in feature 072 (T087), and
  // feature 061's attribute read model, which `catalog` provides as
  // `catalogAttributeReadPort` since T142. This root read neither by T143a.

  // Feature 072 (T122) — `import_export` owns its service and routes now.
  // Feature 072 (T105) — `languages` owns its services and routes now.

  // Feature 005 — the boot-time default-channel reconciliation stood here and
  // is `composeApp`'s since 2026-09-13. It was the last boot step a *request*
  // depended on that only a root supplying a contribution callback performed,
  // and an instance supplies none (R2.4): the resolver middleware the platform
  // mounts falls back to `getSystemDefault()`, which throws an
  // `HttpError(500, INTERNAL)` the envelope answers without logging, so every
  // scaffolded instance served `500 INTERNAL` on every `/api/v1/*` path but
  // `/api/v1/_health` and wrote nothing about any of them. The reconciler runs
  // before `composeModules` there — earlier than this call did, and for the
  // reason the comment here always gave.

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
  // Feature 014 — CMS module (Pages, Blocks, Templates, Hooks, Page
  // Builder). Phase 2 ships module instantiation + seeded-Hook
  // reconciliation; admin/storefront routes land in subsequent phases.
  // Feature 072 (T093) — `cms` owns its services, its four late-bound
  // resolvers, its seeded-Hook reconciliation and its routes now. T143a — and
  // the reference registry too: `megamenu` cross-registers into it from its own
  // boot hook, so this root reads nothing of the module and only contributes
  // the asset resolver further below.

  // Feature 072 (T127) — `price_lists` owns its services and routes now. Two
  // names used to stay a composition's; both have left. Whether a wall-clock
  // status sweeper runs went with T118, and `priceListsAdminAuditContext` — how
  // a non-admin caller is named on an audit record — with T118b. The pricing
  // decoration (D-28) is contributed here, when the deployment ships one.
  //
  // T143a — `priceListsPricingCacheTtlMs` is gone: this file was importing the
  // module's own `DEFAULT_PRICING_CACHE_TTL_MS` to hand it back to the module.
  // The module defaults it now, and production wanting the shipped TTL says so
  // by contributing nothing.
  // Feature 072 (T119) — `taxes` owns its service and routes now. T118 — the
  // cradle handle this root held is gone: `taxService` is read through
  // `reads()` at its one call site, which is a `providePort` name and so
  // resolves against its published `TaxServicePort` rather than against the
  // module's own interface.
  // Feature 012 / US8 — promotions reads catalog through the catalog query port
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
        const { items } = await reads().salesChannelsService.list({});
        return items.map((c) => ({ id: c.id, code: c.code, name: anyLabel(c.name) }));
      },
      customerGroups: async () => {
        const groups = await reads().customerGroupService.list();
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
  // `product_feeds`), from that module's own boot hook. T118b — and
  // `adminContextResolver` with it, so this root contributes nothing for
  // `credentials` at all. The local closure of that name survives because two
  // *other* contributions below still call it.
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
  // now.
  //
  // **T118c retired `mfaActorBridge` in both roots.** Wave 1 grouped six
  // closures into it on the reasoning that they were the shape *this
  // composition* gives an actor — and re-deriving them found the premise held
  // for none. Two were duplicate spellings of names the platform already
  // contributes (`customerActorResolver`, `adminContextResolver`); the other
  // four were `admin_users`' and `customer_accounts`' published ports and
  // nothing else, both modules already in `mfa`'s manifest `dependencies`. The
  // sharpest of the six is `verifyAccountPassword`, which this root supplied
  // and the harness did not, so the password branch of the 2FA-disable
  // re-authentication existed in production and not under test — a divergence
  // two closures agreeing by hand cannot report.
  composedModules.contribute({
    mfaSocialAccountResolvers: mfaSocialResolvers,
  });
  // The login port is `customer_accounts`' and `admin_users`' own resolution
  // (D-96), and since T118c the actor shape is not this root's either: what is
  // left here is the federated-sign-in account resolvers, which reach
  // `customer_accounts`' social-login port and `admin_users`' read port.

  // SEO module — needs the SettingsService port for the per-channel
  // `sales_channels.storefront_url` setting that the sitemap generator
  // stamps into URLs. Plugin is pushed onto `modules` further below.
  // Feature 072 (T117) — `seo` owns its services and routes now.
  let shoppingListService: ShoppingListBridgeService | null = null;

  // `platformMailer` — the `email` module's registration, read here so this
  // root could hand it to `newsletter`. `specs/117-instance-bring-up/` Phase 6
  // retired the last such hand-over: every consumer resolves `emailMailer`
  // itself, which is what it has been a registration for since T079.

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
  // already-authenticated actor (never from request inputs). It runs after auth
  // so `request.actor` is set, and applies globally.
  //
  // Feature 072 (T027) — the hook that installs it also opens the request's
  // resolution scope, and `registerRequestScopeHook` owns that shape, shared
  // with the test kit so the two cannot drift.
  //
  // T118 — the *hook* is the platform's and is installed on every composition
  // whatever this line does. What is handed over is the **mapping**: it reads
  // `request.actor`, which exists only because `auth` writes a
  // `declare module 'fastify'` block, and a platform file that named that
  // package would be the D-52/D-53 reach `composeApp` moved out of. T118b
  // relocates the augmentation and this closure goes with it.
  seams.buildTenantContext = async (request: FastifyRequest): Promise<TenantContext> => {
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

  // Feature 062 — read-only inventory accessors backing the external catalog
  // namespace's availability indication (channel-candidate warehouses +
  // cumulative on-hand → display band). Standalone instances: reads only,
  // no event emission, no audit.


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

  // `cmsAssetResolver` is **not** here any more (T118c). Feature 072's T093 left
  // it as a contribution on the reasoning that which modules a deployment ships
  // is this root's business — true of the decision, not of the wiring, and it
  // never accounted for the fact that only *this* root contributed it, so every
  // CMS storefront response under the harness resolved its asset embeds to `{}`.
  // `cms` registers the name itself now over `assets_library`' published
  // `assetsLibraryPort`, with the edge in its own manifest
  // (`specs/075-cross-module-decoupling-sweep/` Phase C).

  // Feature 046 — PWA module. **Nothing is contributed for it any more**
  // (`specs/110-instance-repository/` T118c). `pwaBridge` was one name carrying
  // eight members — an `assets_library` upload facade and URL resolver, three
  // sales-channel closures, two actor resolvers and the FR-024 order-status
  // copy — and re-deriving them member by member found that none was a
  // composition's answer to give. Six became published ports the module resolves
  // itself (`assetsLibraryPort`, the kernel's `salesChannelResolutionPort`,
  // `orderReadPort`) or names the platform already contributes
  // (`adminAuditActorResolver`, `request.actor`), and one — `resolveChannelIdByCode`
  // — was called by nothing at either end. `pwaRunWorkers` is not this file's
  // and never was: the platform contributes it in `compose-app.ts`, because
  // whether a process runs queue consumers is a property of the composition
  // rather than of this deployment.

  // Feature 015 — Megamenu module. **Nothing is contributed for it any more**
  // (`specs/110-instance-repository/` T118c). `megamenuValidatorDeps` and
  // `megamenuStorefrontDeps` were eight closures written here and again in the
  // harness — `select 1 from categories | cms_pages | cms_blocks | assets`, plus
  // the storefront URL shapes — on the reasoning that moving them into the module
  // would give it direct reads of three other modules' storage. It would have;
  // what the module reads now is `catalogCategoryReadPort`, `cmsPageReadPort`,
  // `cmsBlockReadPort`, `assetReadPort` and `assetsLibraryPort`, four of them
  // from `specs/075-cross-module-decoupling-sweep/` Phase C and the block one
  // published by `cms` in the same merge request. The edges are in that module's
  // manifest, where an operator can see them; here they were nobody's.
  //
  // The two roots disagreed, and nothing could see it: this one dropped a
  // deactivated or soft-deleted category from the menu where the harness kept it,
  // and this one built `/c/<slug>` where the harness built `/catalog/<slug>`,
  // which the storefront serves from nowhere.

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
    // Which channel a global-scope settings read resolves against, the two
    // settings names and the sales-channel code⇄id bridge all moved with the
    // assembly (T118): every one of them is a sub-kernel's object, and a
    // deployment that had to contribute one would be writing the platform's own
    // wiring.
    // `requireCustomer` is NOT here any more: `auth` provides it as a port
    // (issue #43), for the same reason `requireAdmin` is not — re-registering
    // the name would replace a gated registration with a plain closure.
    // And `customerContextResolver`, `customerAccountIdResolver` and
    // `adminAuditActorResolver` moved with T118b, along with six more that read
    // `request.actor` and nothing else. They stayed behind through T118 only
    // because the `declare module 'fastify'` block that puts `actor` on the
    // request was `auth`'s; it is `@endora-commerce/platform/http`'s now, so a
    // platform file may read what they read.
    // Feature 072 (T101) — inherited credit limits, owned by `organizations`,
    // which provides `organizationInheritancePort`. This entry is the root's
    // bridge to it and goes when the consumer resolves the port directly.
    // Feature 072 (T111) — the composed attribute read model, owned by
    // `catalog`. A root bridge, not a module that is unconverted.
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
      const users = await reads().adminUserService.listByIds(ids);
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
    // D-223 — `assets_library` builds this URL on the deployment's public API
    // origin, so the absolutiser that used to wrap it is gone. It mattered most
    // here: an e-mail is read on a device that has never heard of this API
    // host, so a host-relative logo URL renders as a broken image in every
    // client. The harness stubbed this to `async () => null`, so the path had
    // no test at all; it composes the same closure now.
    transactionalEmailAssetUrl: async (assetId: string): Promise<string | null> => {
      try {
        return (await assetsLibrary.handle.service.resolveUrl(assetId)).url;
      } catch {
        return null;
      }
    },
  });

  // Feature 072 (T142) — `catalog` owns its services and routes now, and the
  // seven `pim_ergonode` reads through are its ports rather than a second
  // instance built here. What stays a composition's is the three adapters that
  // reach modules `catalog` must not read through directly. The other two left:
  // whether this process runs the bulk-operation consumer (Principle X) with
  // T118, and `catalogAdminAuditContext` with T118b.
  // `catalogExternalAvailability`, `catalogSearchReindex` and
  // `catalogImagePlaceholderUrl` were contributed here and are `catalog`'s own
  // since `specs/117-instance-bring-up/` Phase 6. Each reached something the
  // module may not read directly and each reached it through a seam the module
  // already holds — two gated ports whose owners its manifest declares
  // `degrades-without`, and two platform registrations — so none of the three
  // was this deployment's judgement to make. Nothing defaulted them, and
  // `catalog` is in the module set every instance installs, so all three were
  // 500s waiting on a storefront listing, a product image and an attribute
  // edit.

  // `ordersAdminScopeResolver` was contributed here and is `orders`' own since
  // `specs/117-instance-bring-up/` Phase 6. T118b was right that it is not an
  // actor read — it decides on `admin_roles.code === 'sales_representative'`,
  // which is a module's business rule — and drew the wrong conclusion from it:
  // the home that follows from "a module's table and a module's business rule"
  // is that module, not this root. Nothing defaulted the name, so every
  // composition that is not this file and not the test harness met it as a 500
  // on the admin orders list. The module reads the role through
  // `adminUserReadPort` and `adminRolePort` and declares both edges, which is
  // also how the `knex.raw` join over two other modules' tables leaves this
  // file.
  //
  // `resolveAdminOrdersScope` survives above for `buildTenantContext`'s admin
  // arm, which is this root's own and stays.

  composedModules.contribute({
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
  });

  // Feature 072 (T129) — the two adapters `inventory` reaches outside itself
  // through: the transactional-email sender that `transactional_emails`
  // announces late, and the Organization's warehouse assignment. Both are a
  // root's to build. `inventoryAdminAuditContext` was a third and is the
  // platform's since T118b — it read `request.actor` and nothing else.
  composedModules.contribute({
    // Feature 072 (T138) — the admin-editable sender `organizations` sends its
    // verification, invitation and new-registration emails through. A getter
    // because `transactional_emails` announces the sender well after this
    // point; same shape and owner as `inventoryTemplateEmail`.
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
  // `rfqCustomerContextResolver` and `rfqAdminContextResolver` were contributed
  // here and are `quote_requests`' own since `specs/117-instance-bring-up/`
  // Phase 6. Both bodies read `request.actor` and three ports that manifest
  // already declares — `customerAccountReadPort`, `adminUserReadPort` and
  // `adminRolePort` — so neither carried a judgement this deployment makes, and
  // nothing defaulted them: a composition that is not this file and not the
  // test harness could resolve neither.
  // `rfqTaxRateResolver` was contributed here and is `quote_requests`' own
  // since `specs/117-instance-bring-up/` Phase 6, beside the two actor
  // resolvers above. Two ports — `organizationTaxProfilePort` and
  // `taxService` — both already that manifest's binding `dependencies`, and no
  // `catch` there either, for the reason this contribution carried one nowhere:
  // `taxRateFor` answers "nothing applies" as a *value*, so returning 0 for an
  // error would quote a zero-VAT price on an operator's behalf.

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
        | Awaited<ReturnType<ContainerReads['cartService']['mergeAnonymousIntoCustomer']>>
        | undefined;
      if (loginCtx.anonymousCartToken) {
        cartMerge = await reads().cartService.mergeAnonymousIntoCustomer(
          loginCtx.anonymousCartToken,
          {
            customerAccountId: loginCtx.customerAccountId,
            organizationId: loginCtx.organizationId,
          },
        );
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
        await reads().comparisonService.adoptAnonymousComparison(
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
  // three settings reads now. Who is *asking* (`customerActorResolver`) is the
  // platform's since T118b.
  // `customerModerationActorResolver` was contributed here and is `customers`'
  // own since `specs/117-instance-bring-up/` Phase 6. Nothing defaulted it, so
  // every composition that is not this file and not the test harness met it as
  // a 500 on the admin customers screen. The module reads the moderating
  // admin's role through `adminUserReadPort` and `adminRolePort` and declares
  // both edges, which is also how the second copy of the `knex.raw` join over
  // `admin_users` and `admin_roles` leaves this file — the harness had been
  // written over the ports since T140, so the SQL was the outlier.

  // Feature 047 — Invoices. Owns issuance, numbering, PDF rendering, admin +
  // customer routes. Constructed before returns so the corrective-invoice
  // provider can draw correction numbers from the shared number generator.
  // Feature 072 (T113) — `invoices` owns its services and routes now, and
  // **`invoicesBridge` is gone** (`specs/110-instance-repository/` T118c). Six
  // members, none of which was this composition's answer to give: the acting
  // admin and the calling customer were `adminContextResolver` and
  // `customerContextResolver` under a second pair of names, the sender is
  // `transactional_emails`' own accessor, and the recipient address, the
  // channel's language and the logo bytes are `customer_accounts`',
  // the platform's and `assets_library`' — the last of them behind a new
  // `assetReadPort.openAssetBytes`, which is where the `legacy`-has-no-`open`
  // probe, the locator fallback and the stream drain went.

  // Feature 059 — KSeF (Krajowy System e-Faktur). Consumes the invoices
  // domain events, submits FA(3) documents through a durable queue, and feeds
  // the KSeF number/QR back through the invoices port + PDF-renderer seam.
  // Feature 072 (T104) — `ksef` owns its services and routes now.
  // `ksefSellerNipResolver` was contributed here and is `ksef`'s own since
  // `specs/117-instance-bring-up/` Phase 6. `invoices.seller.tax_id` is a
  // setting `ksef` may read — it declares `invoices` — and stripping a `PL`
  // prefix off a NIP is a KSeF format rule, not composition policy.

  // The PDF QR is no longer this root's to wire. `ksef` registers its own
  // invoice PDF block — verification read included — into `invoices`'
  // `invoicePdfBlockRegistry` from its composition
  // (`specs/134-paid-module-extraction/` T126), so an instance composed
  // through the platform alone prints it too.

  // Feature 067 — Product Feed. Projects a sales channel's catalogue into
  // provider-shaped feed files published at a tokenised URL.
  //
  // **This root contributes nothing to it** (`specs/110-instance-repository/`
  // T118c). `productFeedsBridge` was one contributed name carrying four
  // members, and every one of them is now a published port the module resolves
  // for itself: `objectStoragePort` for the artefact bytes,
  // `inventoryAvailabilityPort` for the bands, `catalogCategoryReadPort`'s
  // `expandCategoryProductIds` for the criteria compiler's subtree walk, and
  // `assetReadPort`'s `resolvePublicUrls` for FR-043's stable-URL rule. Three of
  // the four needed a publication and the fourth needed a type argument; the
  // interface is deleted rather than relocated, so there is nothing left here
  // for a client's own tree to fork.
  //
  // What is still contributed for this module is what a deployment owns and a
  // module cannot read: whether this process runs the BullMQ consumers
  // (Principle X), the public base URL a feed link is built on, the token
  // encryption key, and the test-only taxonomy and delivery seams.
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
  // was the last one left here and is gone too (T118c): `assets_library`
  // provides `assetsLibraryPort`, `pim_ergonode` has resolved that port since
  // feature 075's cut, and the `assetsLibraryService` name this root went on
  // contributing was read by **nobody** — a second, ungated hold on the same
  // service, kept alive by the entry rather than by a caller.
  // FR-005 — the boot-time schedule reconcile moved into the module's own
  // `ctx.onBoot` in T131, where it reads the same `runWorkers` decision this
  // root contributes.

  // Feature 046 — Returns & Complaints (Refunds, RMA). Reads order facts only
  // through the OrderReturnContextPort (Principle I); settings drive the
  // free-return window and RMA prefix/suffix.
  // Feature 072 (T109) — `returns` owns its services and routes now. T143c made
  // the four settlement adapters their owners' ports, and this root went on
  // forwarding to them through a `returnsBridge` object.
  //
  // **T118c retired the bridge, and this root contributes nothing for `returns`
  // at all.** All eight members had an owner that was not a composition: the
  // four settlement ports are `orders`', `payments`', `invoices`' and
  // `credit_limits`', and the module resolves each with `lazyPort` and declares
  // the edge — which is the half forwarding from here silently removed, since a
  // root's resolution is nobody's declared dependency and an operator switching
  // `payments`, `invoices` or `credit_limits` off was told nothing about what
  // stops. The recipient's address is `customer_accounts`' published record; the
  // channel's language is a read of the platform's own entity, and both moved
  // into the module as `services/notification-context.ts`. The two actor
  // resolvers were this root's `resolveCustomerAccountId` and
  // `adminContextResolver` under a second pair of names — the platform
  // contributes both for every module that takes one (T118b), so the module
  // reads those instead.

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

  // Feature 048 — Newsletter. Own-infrastructure bulk email: subscriber
  // signup (per-channel opt-in), campaigns, automations, and a configurable
  // sending provider. Channel/mailer/settings coupling is injected here so the
  // module stays isolated (Principle I).
  // Feature 072 (T114) — `newsletter` owns its services and routes now.
  // These stay here because they are pinned per composition rather than
  // derived: the token secret and base URLs decide what an unsubscribe link
  // looks like, and the harness needs that predictable.
  // `newsletterBridge` was contributed here and is gone since
  // `specs/117-instance-bring-up/` Phase 6: nine members, every one of them a
  // port, a platform contribution, a platform helper or an environment input,
  // and none of them this deployment's judgement. `newsletter` reads all nine
  // itself. `NEWSLETTER_TOKEN_SECRET` stays a **platform** input — `composeApp`
  // registers the resolved value as `newsletterTokenSecret` — so the read stays
  // in the tree `check:env-inputs` judges (T6-B1 route (b)), and the third
  // fallback this file carried, a literal `'newsletter-dev-secret'`, is not
  // reproduced anywhere: it was a shipped signing key that nothing declared.
  composedModules.contribute({
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
    shoppingListServiceSink: (svc: ShoppingListBridgeService) => {
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
  // lazy registry accessor, which `composeApp` supplies since
  // `specs/110-instance-repository/` T141 — the forward reference this root kept
  // for it went with the contribution.
  // Feature 072 (T089) — `_i18n` owns its service, its reconciler and its
  // routes now. The root only reads the two the platform consumes.


  // Feature 020 — Admin Command Palette actions registry. Feature 072 (T099) —
  // `admin_actions` owns its service, its reconcile and its routes now, and
  // T118 moved `modulePresenceProbe` with the assembly: the reading is
  // `effectiveState`'s and the generation is the registry cache's, so neither
  // half names a module and a deployment that had to contribute it would be
  // writing the platform's own wiring.

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
  // Feature 072 (T125) — `_lifecycle` registers its own routes now, through
  // `ctx.ungatedRoutes`. One name stays a composition's and it genuinely
  // differs: this deployment boots an orchestrator, and the harness does not,
  // because it never populates `module_registrations`.
  //
  // T118 — `lifecycleActivationPropagation` left with the assembly. How a
  // committed flip propagates is the Command Bus, the registry cache and the
  // storefront revalidator, none of which is a module, so every deployment gets
  // the same answer rather than each writing it out.
  composedModules.contribute({
    lifecycleOrchestrator: lifecycle.handle.orchestrator,
  });
  // `lifecycleManifestRegistry` — the accessor `_i18n` walks to reconcile every
  // module's translation bundles — was contributed here and is `composeApp`'s
  // since `specs/110-instance-repository/` T141. The value is the same
  // expression: this root passed `resolvedRegistry` to
  // `lifecycleModuleFromStaticEntries`, which is `buildStaticRegistry` of it,
  // and the platform builds it from the resolved set it already holds. What
  // moved is who authors it, and it had to move: a name contributed on both
  // sides of the package boundary is a silent overwrite (the assertion in
  // `test/unit/kernel/compose-app-contributions.test.ts`), and an instance
  // contributes nothing at all — R2.4 — so the name resolved to nothing there
  // and the boot died inside `_i18n`'s reconcile. The harness's own
  // contribution stands: it composes by hand and never calls `composeApp`.

  // The boot half only: reconciling first-boot registrations, warming the
  // registry cache and resuming workers. Its routes are the module's own now.
  scopedPlugins.push(lifecycle.plugin);

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

}
