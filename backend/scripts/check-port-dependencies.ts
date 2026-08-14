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
 * Two properties are enforced:
 *
 *   1. Every name a module resolves is owned by *something* — a module, the
 *      kernel, or the platform. A name nobody registers is a wiring bug that
 *      currently surfaces as an `AwilixResolutionError` at boot, in whichever
 *      environment happens to compose that module first.
 *   2. When the owner is another module, that module is in the resolver's
 *      **transitive** `manifest.dependencies` closure — the same closure the
 *      migration ordering and the lifecycle dependency check use.
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
 * Usage: `tsx scripts/check-port-dependencies.ts [--list]`
 * Exit 0 = every resolved port is declared; exit 1 = at least one is not.
 */
/* eslint-disable no-console -- CLI check: stdout/stderr is the interface. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const SRC_ROOT = join(fileURLToPath(new URL('.', import.meta.url)), '..', 'src');

/**
 * Names the platform registers, owned by no module: the kernel's own
 * registrations and the process-level infrastructure a composition root
 * creates. Resolving one needs no dependency declaration — the kernel is the
 * part every deployment has, and there is no manifest it could be declared in.
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
  // Three properties of a composition rather than of the pricing module: does
  // this process run a wall-clock status sweeper, how long may a resolved price
  // be cached, and how does this deployment name a non-admin caller on an audit
  // record (T127).
  'priceListsEnableStatusSweeper',
  'priceListsPricingCacheTtlMs',
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
  // `organizations`' other two root-supplied inputs (T138). The settings
  // channel is an env knob; the verification-token probe is a harness fact, and
  // a route that hands back the last token must not exist in production.
  // Neither is something the module could default.
  'organizationsExposeTestProbe',
  'organizationsSettingsChannelId',
]);

/**
 * Ports a **composition root** still registers on behalf of a module that has
 * not been converted yet. Each entry is a temporary stand-in for a
 * `ctx.di.providePort` call in the owning module's `backend.ts`, and it is
 * deleted by that module's conversion — the check fails if an entry survives
 * its owner's conversion, so the list drains rather than accumulating.
 */
export const HOST_REGISTERED_PORTS: Readonly<Record<string, string>> = {
  // `requireAdmin` and `requireAdminAny` are gone from here: `auth` provides
  // them itself since T078, and the staleness check below fails the build if an
  // entry outlives its owner's conversion.
  //
  // Registered as `undefined` today: blog ships no storefront ports and both
  // composition roots pass nothing. The name is blog's own.
  blogStorefrontDeps: 'blog',
  // `_i18n` reads it to serve the per-admin language preference; `admin_users`
  // owns the audited instance and is still hand-wired.
  // The lazy accessor `_i18n` walks to reconcile every module's bundles. The
  // registry does not exist until `_lifecycle` is constructed, which in a root
  // happens after the late pass, so a root supplies the accessor.
  lifecycleManifestRegistry: '_lifecycle',
  // The audited settings write path. `settingsReadPort` is platform-owned
  // because the kernel holds the store (D-32), but the *admin* service is still
  // the `settings` module's, and that module is hand-wired.
  // `auth`'s customer-side guard, still declared inline in each root while the
  // harness runs a separate `requireTestCustomer()` — the divergence T011/T012
  // fixed for `requireAdmin` and never did for this one. Owner is `auth`; the
  // entry goes when the two implementations are unified.
  requireCustomer: 'auth',
  // How a composition names the acting admin on an audit record. Root-shaped
  // by nature — production reads `request.actor`, the harness `request.testActor`
  // — so it is a composition input rather than any module's property.
  adminAuditActorResolver: 'auth',
  // The sales-channel code⇄id lookup. Owned by `sales_channels`, which is still
  // hand-wired (T110); the entry goes when that module converts.
  salesChannelCodeIdPort: 'sales_channels',
  // How a composition resolves the calling customer. Root-shaped for the same
  // reason `requireCustomer` is; owned by `auth` in principle.
  customerContextResolver: 'auth',
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
  // The guard that refuses a cart mutation for an organization that may not
  // transact. Owned by `organizations`, still hand-wired.
  // `inventory`'s root-built adapter (T129) — the Organization's warehouse
  // assignment that scopes a storefront stock read. Its transactional-email
  // twin drained in T120, when `transactional_emails` converted and offered one
  // `templateEmailPort` to every module that sends unscoped template mail.
  // The seven `catalog` services `pim_ergonode` reads drained in T142, along
  // with `catalogAttributeReadPort` and `catalogQueryPort` — that module
  // provides all nine now.
  // The asset service the Ergonode media pipeline stores through.
  assetsLibraryService: 'assets_library',
  // How this composition assembles a feed row: opening a storage backend,
  // resolving availability bands, expanding a category through the catalog
  // port, and turning asset ids into stable public URLs (T137). Each crosses a
  // boundary `product_feeds` must not reach through directly.
  productFeedsBridge: 'product_feeds',
  // `shopping_lists`' two cross-module reaches (T133): the RFQ service a list
  // converts into, the org restriction the preference routes re-check against,
  // the lazy order service one-click buy places through, and the sink that
  // hands its own service back to `carts`. All four owners are still hand-wired.
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
  // The operator presence axis the command palette filters on. A root's to
  // supply — which modules a deployment ships is not a module's business.
  moduleActivationProbe: '_lifecycle',
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
 *     composes; the early pass runs long before most of a root's
 *     `registerValues` calls. Capturing resolves against a name that is not
 *     there, and the failure is a boot crash rather than a type error.
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
 * Port edges a module may resolve **without** declaring the owner, because
 * declaring it would close a manifest cycle. One entry per edge, with the
 * cycle spelled out.
 *
 * This is the port-layer twin of `test/unit/db/acknowledged-fk-edges.ts`, which
 * records the five foreign keys `organizations` deliberately does not declare
 * for the same reason. Keep it as short as that one: an entry is a statement
 * that the edge is real and mutual, not that nobody has looked.
 */
export const ACKNOWLEDGED_PORT_EDGES: Readonly<Record<string, string>> = {
  // The same mutual pair, four names over. `customer_accounts` declares
  // `organizations` — every account belongs to one, and feature 051 made that
  // the tenancy direction — while this module's public registration, login,
  // password-reset and TOTP routes are served by those four services. The
  // manifest already records the mirror of this as an acknowledged FK edge
  // (`email_verification_tokens.customer_account_id`).
  'organizations:customerAuthService': 'see `organizations:addressService`',
  'organizations:passwordResetService': 'see `organizations:addressService`',
  'organizations:customerRoleService': 'see `organizations:addressService`',
  'organizations:totpEnrolmentService': 'see `organizations:addressService`',
  'catalog:pricingService':
    'Mutual by nature, and the mirror of `organizations:addressService`. ' +
    '`price_lists` declares `catalog` — a price list is a list of prices for ' +
    'products, and it must install after them — while the external catalog ' +
    'namespace prices its responses through the pricing engine. Declaring the ' +
    'second direction closes the cycle, and `migration-order` fails the build ' +
    'on it, which is how this was found.',
  'organizations:addressService':
    'Mutual by nature. `addresses` declares `organizations` because every stored ' +
    'address is organization-scoped, and it must install after the tenancy root. ' +
    '`organizations` resolves `AddressService` because its customer routes expose ' +
    'address CRUD. Declaring the second direction closes the cycle and makes the ' +
    'tenancy root uninstallable first, which Rule 3 forbids — the same trade the ' +
    "manifest's five acknowledged FK edges record. It goes when the address routes " +
    'move to the module that owns the table.',
};

export interface PortViolation {
  readonly kind: 'undeclared-dependency' | 'unowned-name' | 'captured-name';
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

/** The owning module id of a source file, core or overlay. */
export function moduleOf(file: string): string | null {
  const overlay = /\/src\/apps\/[^/]+\/modules\/([^/]+)\//.exec(file);
  if (overlay) return overlay[1] ?? null;
  const core = /\/src\/modules\/([^/]+)\//.exec(file);
  if (core) return core[1] ?? null;
  return null;
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
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const names: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && calleeTail(node) === 'di.providePort') {
      const [first] = node.arguments;
      if (first && ts.isStringLiteral(first)) names.push(first.text);
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return names;
}

/**
 * Every registration name a module resolves.
 *
 * Two shapes, because those are the two the kernel offers: the destructured
 * cradle parameter of a factory (`ctx.asFunction(({ a, b }: C) => …)`) and the
 * deferred surface (`ctx.cradle<C>()`), read either by destructuring or by
 * property access.
 */
export function resolvedNames(source: string, file: string): PortResolution[] {
  const moduleId = moduleOf(file);
  if (moduleId === null) return [];
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const found: PortResolution[] = [];

  const record = (name: string, node: ts.Node, kind: PortResolution['kind']): void => {
    found.push({
      moduleId,
      name,
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      kind,
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

  const visit = (node: ts.Node): void => {
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
      const calleeName = ts.isIdentifier(node.expression) ? node.expression.text : tail;
      if (calleeName === 'lazyPort') {
        const [, nameArgument] = node.arguments;
        if (nameArgument !== undefined) {
          if (ts.isStringLiteralLike(nameArgument)) {
            record(nameArgument.text, nameArgument, 'deferred');
          } else {
            // A name this check cannot read statically must not pass silently.
            // A generic `port(ctx, name)` helper written during T131 hid twelve
            // resolutions behind a variable; the fix is to refuse the shape,
            // not to guess at it.
            record(NON_LITERAL_PORT_NAME, nameArgument, 'deferred');
          }
        }
      }
    }
    node.forEachChild(visit);
  };
  sf.forEachChild(visit);
  return found;
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
}

export function findViolations(input: CheckInput): PortViolation[] {
  const violations: PortViolation[] = [];
  const providedPorts = input.providedPorts ?? new Map<string, string>();
  for (const resolution of input.resolutions) {
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
    if (PLATFORM_OWNED_NAMES.has(resolution.name)) continue;
    const owner = input.owners.get(resolution.name) ?? null;
    if (owner === null) {
      violations.push({ kind: 'unowned-name', resolution, owner });
      continue;
    }
    if (owner === resolution.moduleId) continue;
    if (closureOf(resolution.moduleId, input.dependencies).has(owner)) continue;
    if (ACKNOWLEDGED_PORT_EDGES[`${resolution.moduleId}:${resolution.name}`] !== undefined) {
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
 * Both shapes a root uses: `registerValues(container, { … })` and a direct
 * `container.register({ … })`. Spread elements are ignored — a name that only
 * exists inside a spread is not a name this check can reason about.
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
      if (callee === 'container.register' || callee === 'register') {
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
  readonly kind: 'root-shadows-module-port' | 'root-divergence' | 'root-supplies-nothing';
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
      `registers.\n    Register it in the owning module's backend.ts, or — while that module ` +
      `is still hand-wired — declare its owner in HOST_REGISTERED_PORTS in this script.`
    );
  }
  return (
    `  - ${resolution.moduleId} resolves '${resolution.name}' (${where}), owned by ` +
    `'${owner}', which it does not declare.\n    Add '${owner}' to \`dependencies\` in ` +
    `src/modules/${resolution.moduleId}/manifest.ts.`
  );
}

async function main(): Promise<void> {
  const files = [...walk(join(SRC_ROOT, 'modules')), ...walk(join(SRC_ROOT, 'apps'))];

  const owners = new Map<string, string>(Object.entries(HOST_REGISTERED_PORTS));
  const resolutions: PortResolution[] = [];
  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const moduleId = moduleOf(file);
    if (moduleId === null) continue;
    for (const name of registeredNames(source, file)) owners.set(name, moduleId);
    resolutions.push(...resolvedNames(source, file));
  }

  const { DISCOVERED_MANIFESTS } = (await import(
    pathToFileURL(join(SRC_ROOT, 'modules/_lifecycle/manifest-index.generated.ts')).href
  )) as { DISCOVERED_MANIFESTS: ReadonlyArray<{ id: string; manifest: { dependencies?: readonly string[] } }> };
  const dependencies = new Map<string, readonly string[]>(
    DISCOVERED_MANIFESTS.map((entry) => [entry.id, entry.manifest.dependencies ?? []] as const),
  );

  // A host entry whose owner now registers the port itself is dead weight, and
  // dead weight in a bridging table is how the bridge outlives the gap.
  const stale = Object.entries(HOST_REGISTERED_PORTS).filter(([name, owner]) => {
    const backend = join(SRC_ROOT, 'modules', owner, 'backend.ts');
    return existsSync(backend) && registeredNames(readFileSync(backend, 'utf8'), backend).includes(name);
  });

  // What each composition root registers, and what each converted module
  // registers for itself — the two sets whose overlap and whose difference are
  // both bugs. See `findRootIssues`. The capture rule reads the same map: a
  // name its owner provides as a port is a gate, and capturing a gate is
  // refused even for the module that owns it (D-38b).
  const moduleRegistered = new Map<string, string>();
  for (const file of files) {
    if (!file.endsWith('/backend.ts')) continue;
    const moduleId = moduleOf(file);
    if (moduleId === null) continue;
    for (const name of providedPortNames(readFileSync(file, 'utf8'), file)) {
      moduleRegistered.set(name, moduleId);
    }
  }

  const violations = findViolations({
    resolutions,
    owners,
    dependencies,
    providedPorts: moduleRegistered,
  });
  const rootNames = new Map<string, ReadonlySet<string>>();
  for (const [label, relative] of Object.entries(ROOT_FILES)) {
    const full = join(SRC_ROOT, '..', relative);
    if (!existsSync(full)) continue;
    rootNames.set(label, new Set(rootRegisteredNames(readFileSync(full, 'utf8'), full)));
  }
  const rootIssues = findRootIssues({
    moduleRegistered,
    rootNames,
    hostRegistered: HOST_REGISTERED_PORTS,
    resolvedNames: new Set(resolutions.map((r) => r.name)),
  });

  if (process.argv.includes('--list')) {
    for (const resolution of resolutions.sort((a, b) => a.moduleId.localeCompare(b.moduleId))) {
      const owner = owners.get(resolution.name) ?? (PLATFORM_OWNED_NAMES.has(resolution.name) ? 'platform' : '?');
      console.log(`  ${resolution.moduleId} → ${resolution.name} [${owner}]`);
    }
  }

  console.log(
    `[port-deps] modules scanned=${new Set(files.map(moduleOf)).size} ` +
      `resolutions=${resolutions.length} violations=${violations.length} ` +
      `root-issues=${rootIssues.length}`,
  );

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

  if (violations.length > 0) {
    console.error(
      `\nA module resolves a port it does not declare. The declaration is what makes the ` +
        `dependency real to the lifecycle, to the migration order and to an operator ` +
        `switching the provider off:`,
    );
    for (const violation of violations) console.error(describe(violation));
  }

  process.exit(violations.length === 0 && stale.length === 0 && rootIssues.length === 0 ? 0 : 1);
}

// Run as CLI only — importing this module (e.g. from a unit test) must not
// trigger the full scan + process.exit.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
