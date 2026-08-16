---
title: The Kernel — boundary, scopes and composition order
---

# The Kernel

Every module composes through an Awilix container. The **kernel**
(`backend/src/kernel/`) owns the container, the seams a module registers
through, and the handful of services that back nearly every module. This page
covers the three things you have to know before writing or changing a module:
**what the kernel may and may not contain**, **how per-request state is
reached**, and **when your registrations and hooks actually run**.

The last of those is not decoration. Composition order caught three module
conversions during feature 072, each time the same way, and each time it looked
like a missing registration rather than an ordering mistake.

## The boundary

**The kernel owns shapes and platform infrastructure. It never owns domain
behaviour.**

| In the kernel | Why |
| --- | --- |
| `container.ts`, `compose.ts`, `module-context.ts`, `scope.ts` | The composition machinery itself |
| `ports/` — `require-admin`, `organizations`, `settings`, `sales-channel` | The **types**; the owning module registers the implementation |
| `audit/` | Principle XIII: every audited write goes through one writer |
| `settings/`, `sales-channels/` | A settings read and a channel resolution back behaviour in nearly every module, so neither may be gated on any one of them (D-32) |
| `lifecycle/` | The presence machinery: the registry cache, the activation resolver, the effective-state combiner and the gating wrappers every module's routes, workers and subscribers pass through (D-37) |
| `lazy-port.ts` | How a module reads another module's port without freezing it |

The rule that follows is **the kernel must not import from `src/modules/` or
`src/apps/`** — module→kernel is always allowed, kernel→module never is.
`src/apps/` is on the forbidden side too: an overlay module is an ordinary
lifecycle participant and a decoration is per-deployment code, so a kernel that
reaches into either is a kernel that differs per deployment.

### The kernel's peers obey the same rule (D-52)

`src/http`, `src/events` and `src/tenancy` are **kernel-obeying platform peers**,
and none of them may import `src/modules/` or `src/apps/` either. The
measurement behind that is D-52 … D-57
(`specs/072-module-kernel-di/kernel-peer-boundary.md`, issues #91/#92).

| Peer | What it is | Why it obeys |
| --- | --- | --- |
| `src/events/` | One 81-line file: an `AsyncLocalStorage`-backed in-process bus, generic over its event map, importing only `node:async_hooks` | No domain noun anywhere in it |
| `src/tenancy/` | The Principle XI guard: column names as strings, `where` fragments over an opaque field, a pure actor→`TenantContext` function | Five kernel entities take `@GlobalEntity()` from it — the kernel's persistence layer does not exist without it |
| `src/http/` | Fastify bootstrap, the error envelope, OpenAPI registration, cursor encoding, the interceptor registry | Four kernel files take `HttpError` from it **as a value** |

They are not optional to the kernel; it does not compile without them. A
dependency the kernel cannot compile without, which is itself permitted to import
a module, is a kernel that imports modules with one extra hop — in package terms
the cycle `kernel → http → mod-i18n → kernel`, and F4's stated precondition is
that packages are not cyclic.

`src/db`, `src/overlay` and `src/commands` are **not** covered: `src/db` names
every module by construction (F2 of the packaging roadmap replaces it with a
generator), `src/overlay` is per-deployment resolution, and `src/commands` sits
*above* the kernel — it already satisfies the rule, and D-57 leaves its package
home to F4. Whether a peer becomes a directory *inside* the kernel package is
F4's layout decision, deliberately not taken here (D-56).

**That rule is enforced.** `backend/scripts/check-kernel-boundary.ts` carries
three rules over the one principle. **Rule A** refuses an ORM relation from the
kernel into a module. **Rule B** (D-37, widened by D-53) refuses an import
specifier naming a module from any file under a **platform root** — `src/kernel`,
`src/http`, `src/events`, `src/tenancy`. **Rule C** (D-53) refuses one anywhere in
the kernel's transitive import closure, however many hops away.

B and C are deliberately not redundant, and each covers the other's blind spot: B
is a list, and issue #92 existed precisely because a peer was never put on a list;
C has no list to forget, but is blind to the six peer files the kernel does not
currently reach. B's message names a line, C's names a chain.

Both see every shape a specifier takes — `import`, `import type`,
`export … from`, dynamic `import()`, `require()`, and the inline
`import('…').Type` annotation the repo's own ESLint config encourages. A
type-only import is a violation like any other: it erases from the bundle but not
from a `package.json`, and ESLint's `prefer: 'type-imports'` would otherwise
launder violations past the rule automatically.

Before D-37, four imports ran from `src/kernel/` into `src/modules/`:
`module-context.ts` took the three gating wrappers, `ports/provide.ts` took
`ModuleDisabledError` and `effectiveState`, and `ports/organizations.ts`
type-imported the `Organization` entity class. D-37 A1 relocated the presence
machinery — `plugin-helpers.ts`, `registry-cache.ts`, `effective-state.ts`,
`activation-resolver.ts` and `module-registration.entity.ts` — into
`src/kernel/lifecycle/`, which dissolved the first three. D-55 dissolved the
fourth, and D-54 dissolved the one peer import (`src/http/error-envelope.ts`
reaching `_i18n` for the error-translation map, now injected).

`KERNEL_MODULE_IMPORTS_TO_DRAIN` is therefore **empty**, and stays as a two-way
ratchet: an unledgered import fails the build **and** a ledger entry that no
longer describes an import fails it too. An entry is a debt with an owner, never
a standing exemption.

One limit of the rule remains, deliberate and stated in the script's header: a
colocated `*.test.ts` under a platform root is not scanned, because a test may
import a fixture and is not the artefact packaging cares about.

Prose was tried first, and it did not hold. `kernel/index.ts`, `tenancy/index.ts`
and `http/interceptors/registry.ts` all state this rule in a header comment; all
three were true, all three were unenforced, and the one file that broke it broke
it anyway. That is the argument for the check.

`ports/organizations.ts` shows the split at its clearest. The kernel declares
`OrganizationReadPort` — `loadEffectiveOrganization`, `assertCanTransact`,
`loadCartApprovalPolicy` — because almost every module needs to read an
Organization (Principle XI). It does **not** implement it. `organizations`
registers `OrganizationContextService` against that name, so the shape is
platform-wide and the behaviour stays in the module that owns the table.

Since D-55 the port types its return values with a kernel-owned structural
`OrganizationSnapshot` — `{ id, status }`, with `OrganizationStatus` taken from
`@b2b/contracts` — rather than the module's `Organization` entity class. That is
the whole surface the port's callers consume: `promotions` reads `status`, and
`carts` and `orders` discard the return value entirely because what they want is
the throw. TypeScript is structural, so `OrganizationContextService` satisfies
the port returning its entity, with **no mapping layer and no implementation
change**.

**The entity stays in `organizations`, permanently.** Relocating it as
`SalesChannel` was relocated does not transfer: `sales_channels` ships zero
migrations and its table was already `core`, while `organizations` ships eight
migrations that all write the `organizations` table, six of which also create
module-owned tables. The honest execution is splitting six migrations, renaming
eight applied classes and a coordinated database rebuild — to serve a port that
consumes two properties of a 24-property entity. `src/tenancy` is the precedent
that makes the snapshot right rather than merely cheap: it enforces Principle XI
knowing the Organization as a UUID in a column and never as a class.

## Registering: the three seams

A module's `backend.ts` exports `registerModule(ctx)`. There are three ways to
put something in the container, and choosing the wrong one is the most common
review comment.

### `ctx.di.providePort(name, registration)` — a port you own

Use it for a service other modules resolve. `providePort` wraps the registration
in a **transient gate** that checks the module's effective state, so a caller
gets a 503 `MODULE_DISABLED` envelope rather than a half-executed operation when
the module is switched off (Constitution XVII).

```ts
ctx.di.providePort(
  'organizationRestrictionPort',
  ctx.asFunction(({ emFactory, auditLogService }: Cradle) =>
    new OrganizationRestrictionService(emFactory, auditLogService)).singleton(),
);
```

### `ctx.di.register({...})` — your own services, and contribution points

Use it for services only your module resolves, and for **contribution points**:
a name you default sensibly and a composition root may overwrite.

```ts
// Default: a composition with no outbound mail sends nothing, which is coherent.
cartAbandonmentNotifier: ctx.asFunction(() => undefined).singleton(),
```

A contribution point is a **root↔module** seam and only that. A module may not
write a name another module owns — `ctx.di.register` claims every key it writes
and the kernel throws `DuplicateRegistrationError` on the second writer. The
reason is not mechanical: a root sits outside the manifest dependency graph and
has no `dependencies` array that could record the edge, so a root contribution
is the one write that cannot be expressed as a port. A module↔module edge always
can be, and therefore must be.

### `lazyPort<T>(ctx, 'name')` — reading someone else's port

**Never read another module's port into a singleton.** `providePort` returns a
transient gate; Awilix's strict mode refuses to let a longer-lived registration
capture it, and it is right to — a captured gate would keep answering after its
module was switched off.

```ts
// Resolves on every forwarded method call, so the gate stays live.
pricingService: lazyPort<PricingService>(ctx, 'pricingService'),
```

**"Not into a singleton" means "not while wiring", full stop** — and the two
places that look exempt are not. A **composition root** has no `ctx`, so it
cannot call `lazyPort`, but reading a gated port at the top level of
`composeApp()` is the same freeze with a worse blast radius: the read happens
after `loadModulePresence()`, so a module the operator has switched off throws
`ModuleDisabledError` out of composition and `index.ts` turns that into
`process.exit(1)`. The operator's next start dies and the panel they would undo
it from is unreachable. A root defers the same way `lifecycleManifestRegistry`
does — a thunk resolved where the value is used:

```ts
// Not `creditLimitsCradle.creditLimitService`: resolved when a return is settled.
creditTopup: new CreditTopupProvider(() => creditLimitsCradle.creditLimitService),
```

A **`ctx.routes` body** is the other one. `defineModuleRoutes` gates *requests*;
the registration itself runs whatever the module's effective state is, inside
`buildServer`. So destructuring your own gated port there asks the gate while
the app is being wired, and switching the module off stops the backend from
starting instead of stopping its routes. Take it with `lazyPort` — inside a
handler the gate is open by construction, so nothing else changes.

Both were live in the tree until feature 072's D-40 follow-up; the property is
pinned by `backend/test/integration/kernel/deactivated-boot.test.ts`.

Two more rules that are easy to miss:

- **The name must be a string literal.** `backend/scripts/check-port-dependencies.ts`
  reads these statically; a variable or a `port(ctx, name)` helper hides the
  resolution from it. During feature 072 exactly that helper hid fourteen
  resolutions, several of which no root registered, and the check reported clean
  while the media pipeline silently produced nothing.
- **Declare the dependency.** If your module resolves a port owned by `X`, `X`
  belongs in your `manifest.dependencies`. That declaration is what makes the
  edge real to the lifecycle, to the migration order and to an operator
  switching `X` off. The port check fails the build without it.

## Two shapes for a module↔module edge

| Shape | Who resolves | Gated? | When | Use when |
| --- | --- | --- | --- | --- |
| **Pull** — consumer resolves the provider's port | consumer | yes — `ctx.di.providePort` | per call | the consumer needs an **answer** |
| **Push at boot** — contributor resolves the host's registry in `ctx.onBoot` and calls a mutator | contributor | **no** — `ctx.di.register` | once | the contributor must add a **descriptor** to a set the host enumerates |

Most edges are pulls. The push shape is for registries — transactional-email
defaults, reference registries, adapter tables — where a module contributes
something the host later walks.

**A contribution registry is never a gated port** (feature 072, D-39). The rule:

> A registration whose whole contract is *"add an inert descriptor to a table
> the host walks later"* is `ctx.di.register` and is **never** gated. A
> registration that computes, decides, decrypts, sends, charges or writes on the
> owning module's behalf is a `providePort` and fails closed.

The reason is mechanical, not stylistic. Boot hooks run regardless of effective
state (see rule 4 below), and a gated port throws `ModuleDisabledError` on
resolution — so gating a registry means every contributor's boot hook throws the
moment an operator switches the **host** off, and the platform does not start.
`transactional_emails` has seven contributors; `cms` has one. The operator broke
the next start by using a switch they were entitled to use, and the crash named a
module they never touched. (`transactional_emails` has since declared itself
non-deactivatable — issue #88 — so that particular switch is gone; the rule is
unchanged, `cms` still exercises it, and the registry stays ungated because the
argument is about the shape of a contribution seam, not about who may switch a
host off.) `check-port-dependencies.ts` refuses the shape now, at
both sites where it can bite: a gated port resolved in a `ctx.onBoot` hook and one
destructured in a `ctx.routes` body.

Nothing leaks by leaving the registry ungated, because the two halves are
separable: `credentials` hands out its `configurationTypeRegistry` freely and
keeps `credentialsService` — which decrypts — a port; `transactional_emails`
hands out `emailDefaultsPort` and keeps `templateEmailPort`, which sends.

**The host answers the presence question instead, at enumeration.** That is the
right place for it: whether a descriptor should be live depends on the
**contributor**, and a gate on the host's registration cannot express that at
all. So every registry records the contributing module id on each entry and
states, **per registry**, whether an entry is honoured while its owner is absent.
Default: not honoured. Honouring it requires a written reason at the class.

Two answers are legitimate, and which one is right depends on what the entry is:

- **Skip** — for *surface-like* contributions: an interceptor, a palette action,
  a storefront element, a settings group. A switched-off module must contribute
  nothing a user can see, so `ctx.interceptors` stamps `module: id` and dispatch
  skips entries whose owner is not enabled.
- **Honour** — for *integrity-like* ones: the reference registries that refuse a
  delete. A switched-off `blog` still owns posts that embed an asset, and
  skipping its scanner would let an operator delete an asset that comes back
  broken when `blog` is switched on again — data lost by an action Constitution
  XVII calls reversible. `EmailDefaultsRegistry` honours for a different reason,
  written at the class: its rows are seeded from the **platform** axis, so
  skipping would not remove a row, it would create one with an empty template.

All four registries D-39 converted honour, each with its reason in place; the
policies are pinned by `backend/test/unit/kernel/contribution-seams.test.ts`
(`emailDefaultsPort`, `assetReferenceRegistry`, `cmsReferenceRegistry`,
`megamenuReferenceRegistry`).

**Two more registries state the opposite policy, and they are the worked *skip*
example** (issue #96, 2026-08-15). `PaymentAdapterRegistry` and
`ShippingAdapterRegistry` stamp the contributing module on every entry and split
their surface by who is asking: `get`, `resolve` and `list` filter on the
owner's effective state — a buyer never sees a payment method that cannot take
their money, and `resolve` raises the ordinary `ModuleDisabledError` — while
`entry`, `ownerOf`, `isRegistered` and `listAll` deliberately do not, because the
admin screen keeps showing the row *and* the reason it is unavailable. Switching
a module off is not uninstalling it. The presence probe is injected at the
process singleton (`payment_methods/services/registry-singleton.ts`) rather than
baked into the class, so a registry a test builds for itself keeps answering
about the adapters that test registered.

One registry of the same family is still unconverted: `gatewayRefundRegistry`
(`payments/services/gateway-refund-registry.js`) is imported directly by
`stripe`, `tpay` and `autopay`, records no contributing module id, and states no
policy for an absent owner.

**Do not wrap a port call in a bare `catch`.** `lazyPort` resolves inside the
forwarded call, so `ModuleDisabledError` surfaces at the call site, and a
`try { … } catch { return null }` silently converts fail-closed into fail-open.
Where a degrade genuinely belongs, put it **inside the owner's implementation**
and express it in the port's return type — `allowedIdsFor(): Promise<string[] | null>`
returning `null` for "no restriction" is the pattern.

**That rule is enforced too**, by `backend/scripts/check-port-catches.ts`
(issue #84). It is worth knowing what the sweep that armed it found, because the
three kinds it separates are the three answers to a review comment about a
`catch`. Of 51 `try` blocks reaching a gated port, 27 already re-threw and 24 did
not, and the 24 were:

- **defensive** — a `catch` over a port whose return type *already* says
  "nothing applies". `resolveLinePrice` answers `null`; `taxRateFor` answers
  `{ rate: 0, source: 'none' }`; `applyToCart` answers `discountTotal: 0`. The
  `catch` bought nothing except the ability to hide a 503, and one of them wrote
  the hidden answer into a cache with a TTL, so `price_lists` coming back did not
  end it. **Delete it.**
- **a degrade that belongs to the owner** — see the paragraph above.
- **a narrow tolerance that is correct** — a per-item import failure recorded as
  an issue, a compensating cleanup on a rollback path, a typeahead hit that
  degrades to its plain summary. Those keep the `catch` and add
  `rethrowIfModuleDisabled(error)` as its first line. The reason is that a
  presence answer is about the **whole operation**, never the one item:
  `pim_ergonode` used to report every attribute, variant, image and relation in
  the source as individually broken and finish the run "successfully", when the
  one true sentence was that `catalog` was switched off.

A kept `catch` says why in a comment, and "defensive" is not a why.

Two details the check makes explicit. A **conditional** re-throw
(`catch (e) { if (rare) throw e; }`) is a violation: `ModuleDisabledError`
extends `HttpError`, so a `statusCode === 409` test lets it through by accident
rather than by decision. And a **timer callback** cannot re-throw at all —
`ksef`'s reconcile sweep asks `effectiveState.isPresent` before it starts
instead, which is what freed its `catch` to log the genuine sweep failures that
used to vanish beside the presence answer.

`PORT_CATCHES_TO_DRAIN` holds the three sites where absorbing the answer is
still the least-wrong behaviour, each with its reason. All three share one shape:
the guarded call runs **after** the operation it belongs to has committed — a
transient-address cleanup, a verification e-mail — so re-throwing would report a
failure for work that succeeded. Retiring them means giving those calls somewhere
to report to, which is a feature rather than a fix.

## The request scope

Per-request state lives in the kernel's scope (`scope.ts`), reached through
`ctx.cradle<C>()` inside a request. It is **declared, not ambient**: a service
is handed what it needs rather than asking a runtime for it.

That is a deliberate reversal. The tree used to expose `getEm()` over MikroORM's
`RequestContext`, an AsyncLocalStorage-backed lookup: a service reached the
request's EntityManager by asking the runtime, so what it could touch was
invisible in its signature and untestable without a live request scope. Every
module takes an explicit `emFactory` now, and `getEm()` was deleted in feature
072 (T144) so the property holds by construction.

`enterSystemScope(reason, fn, { entryPoint })` is the seam for work with no
request behind it — boot reconciles, CLI entry points, workers. It exists so
that tenant-scoped queries have an explicit, auditable escape hatch instead of
an implicit one.

## Composition order — read this before writing a boot hook

Composition runs in **one pass** over the generated module list, and every boot
hook runs once, after every registration and every root contribution:

```
load module presence                 (PostgreSQL, awaited, fatal)
composeModules(MODULES)              (one call; registration resolves nothing)
…all root contributions…             (registerValues, bridges, eager reads)
runBootHooks()                       (once, after every contribution)
the Fastify app is built             (plugin bodies run)
registryCache.watch()                (Redis, non-fatal)
```

It used to run two passes, split by an `EARLY_PASS_MODULE_IDS` list, so that a
root's hand-wired module code could sit *between* them. There is no hand-wired
module code left in either root, and **D-45** measured what the split still
bought: 13 of its 26 members were forced by nothing, and the route-ordering
reason its header gave was false (a root `onRequest` hook added by a
`fastify-plugin` plugin registered *after* an encapsulated child still runs for
that child's routes). A single pass satisfies every ordering constraint for
every module at once, which no partition of the module set can, so
`composition-passes.ts` was deleted.

Four consequences, in the order they bite:

**0. Module presence is loaded before the first module registers.**
`loadModulePresence()` runs as a composition step in `composeApp()`, because
every gate downstream of it — a port resolution in a boot hook, a
`defineModuleWorker` pause decision, a `subscribeForModule` handler — asks the
same in-memory cache, and most of them ask before any HTTP route exists. Until
feature 072's D-38 the load lived in `_lifecycle`'s plugin body, i.e. inside
`buildServer`, after everything in the diagram above: the cache answered
"not installed" for every module and the backend did not start.

Two halves, deliberately different in kind. The **load** reads PostgreSQL, is
awaited and is fatal — `initOrm()` already makes a reachable database a boot
precondition, so this adds no failure mode. The **watch** subscribes to the
Redis notification channel, is armed after composition and can never fail a
boot: losing it means *stale*, and PostgreSQL — the authority — is still there.

A presence read before the load throws `ModulePresenceNotLoadedError`. It is
neither of the two answers: `false` is what took the platform down, and `true`
would run a switched-off module's work.

**1. A boot hook may resolve anything.** Every module has registered by the time
the first hook runs, so `ctx.onBoot` reaches any registration and any root
contribution. Registration order is meaningless by construction: `composeModules`
sets `registering = true` for the whole call (`kernel/compose.ts`) and
`ctx.cradle()` refuses to resolve while it is set, so a module cannot observe
which modules registered before it. If your `registerModule` needs a value at
registration time, it does not — take it lazily (`lazyPort`, a getter, or the
cradle at the point of use).

**2. Boot hooks run before every plugin body.** Plugin bodies run when the
Fastify app is built, after `runBootHooks()`. So a push-at-boot contribution
always lands before a host reconciles in its plugin body — by construction, not
by luck.

**3. A root's contribution has exactly one legal slot**: after
`composeModules(MODULES, …)` and before `runBootHooks()`. Earlier and the
module's own default overwrites it — `registerValues` is a bare
`container.register`, with no ownership ledger, so the last writer wins; later
and a boot hook may already have read that default. The window only matters for
values read *at construction*; anything read per request or per call is
insensitive to it — but do not rely on that without saying so. A **host value**
no module defaults (`redis`, `eventBus`, `commandBus`, `auditLogService`, the
`*RunWorkers` flags) has no such window and is registered where the value comes
into existence.

**4. Boot hooks run regardless of effective state.** `runBootHooks()` does not
consult module presence, so a switched-off module's hook still runs. Two
consequences, and the second one used to be stated too narrowly here.

Never resolve a **gated port** from a boot hook: the gate has a real "no" answer
at that point and answering it kills the boot. If the name is a contribution
registry, it should not have been a port at all — see D-39 above.

If your hook pushes a descriptor into another module's registry, the **host**
decides whether that entry is live, at enumeration time, keyed on the
contributing module id it records. "The host must filter" is one of two right
answers, not the rule: *skip* suits surface-like contributions — the way
`ctx.interceptors` stamps `module: id` and dispatch skips entries whose owner is
not enabled — and *honour* suits integrity-like ones, where skipping would let an
absent module's data be silently orphaned. State which one, per registry, with
the reason.

### The one thing a root still has to do in order

`EventBus.dispatch` awaits its handlers in **registration order**, so the two
kernel cache invalidators — `composeSettingsKernel` and
`composeSalesChannelsKernel`, each of which attaches one — are composed **before**
`composeModules(MODULES, …)` in both roots. A module subscribing to
`settings.value_changed` ahead of the settings cache's own invalidator runs its
handler against the pre-write value, and the two-pass era recorded the symptom
the first time `meta_ads` and `linkedin_ads` were moved ahead of it. Compose the
invalidators first and the question cannot be asked.

**Eight modules subscribe to that event, and only five do it through the seam.**
`blog`, `google_analytics`, `google_tag_manager`, `linkedin_ads` and `meta_ads`
use `ctx.subscribe`. `inventory`, `search` and `product_feeds` attach a bare
`eventBus.on` from a plugin body instead — which means the invalidator ordering
above still protects them, but the module's effective state does not: a bare
`eventBus.on` is not wrapped by `subscribeForModule`, so the handler goes on
running with the module switched off. Across the tree that is **20 live
subscriptions in 7 modules** (`search`, `product_feeds`, `inventory`, `pwa`,
`quote_requests`, `invoices`, `pim_ergonode`) against 12 through `ctx.subscribe`.
There is no static check for this seam, unlike routes and workers — use
`ctx.subscribe`.

### Writing an ordering rationale that does not rot

Collapsing the two passes invalidated nothing in the code and fifteen comments in
it — plus two rationales that had already been corrected once. That is not a
tidiness problem: three times in this feature an implementer read one of them,
believed it, and spent a session on a defect that did not exist. Two rules come
out of it, and they apply to any explanation of *when* something happens.

**Name the mechanism, not the coordinates.** A rationale that reads "the accessor
is not assigned until `composition.ts:3240`, and the hooks run at `:2122`" is
wrong the moment either number moves, and nothing tells you: no test covers a
comment, and the reader has no reason to doubt a number. The same rationale
written as "the orchestrator is built after the modules compose, so the accessor
answers `undefined` during registration" survives every edit that does not change
the mechanism — and if it does change the mechanism, the sentence is visibly
about the thing that changed. Where a reference genuinely helps, make it a
**symbol** or a **file plus symbol** (`compose.ts`'s `registering` guard,
`presence-load.ts`'s `installGatingGraph`), never a line number.

**Do not write a counterfactual in the past tense.** "A reconcile here would have
found no registry and reported success" reads as an incident report; the next
reader takes it as evidence that the platform once broke this way, and goes
looking for the outage. If the hazard is hypothetical, say so in the first
sentence — `test/unit/_i18n/reconcile-timing.test.ts` opens with "everything
below is about a move that was never made" for exactly this reason, after the
paragraph beneath it had already misled someone once. If the hazard is real and
past, name the decision or the commit that closed it in the same breath, the way
`api_keys/backend.ts` does with its retired `EARLY_PASS_MODULE_IDS` entry.

The same applies to the ledgers in `check-port-dependencies.ts`: the staleness
sweep fires when the owner **registers the name**, which is not the same fact as
the owner being converted, so a reason written as "still hand-wired" rots without
failing a build. Write each entry's reason as a statement about the name.

## Install-time work: the one seam is `manifest.ts`

`ctx.onBoot` is the only lifecycle hook a `ModuleContext` carries. There is no
`ctx.onInstall` and no `ctx.onUninstall`: they existed through feature 072, the
composition sink collected them, and nothing ever ran them — deleted by D-46.
The reason is structural rather than tidiness. The kernel composes a **running
process**; the lifecycle orchestrator manages a **deployment's inventory**, and
only the first of the two has a container. `module:install` builds a static
registry from `REGISTERED_MANIFESTS`, opens the ORM and Redis, and never calls
`composeApp` — so a hook handed to the container could not fire even in
principle, short of composing all 65 modules in order to install one.

A module that needs install-time work exports it from its `manifest.ts`:

```ts
// backend/src/modules/custom_fields/manifest.ts
export const uninstallHook: ModuleUninstallHook = async (ctx) => {
  if (!ctx.hard) return;                 // soft uninstall drops nothing
  const em = ctx.em as EntityManager;
  await em.getConnection().execute('truncate table "custom_field_definitions" cascade');
};
```

`backend/scripts/generate-composer.ts` detects the export and emits it into
`_lifecycle/registered-manifests.ts`; you never edit a registry. Run
`pnpm --filter backend run composer:generate` and commit the result.

Six properties, all of them load-bearing and none of them obvious from the hook
signature. They are pinned by
`backend/test/unit/_lifecycle/orchestrator.test.ts`.

**1. The hook is idempotent by contract, not by convention.** It is not "once
per deployment". A failed install parks the registry row at `uninstalled`, so
the next `module:install` runs the hook again; so does a soft-uninstall →
install cycle. Write it so a second run is a no-op.

**2. A failing install hook aborts the install.** The orchestrator reverts every
migration *that run* applied, in reverse, sets the row to `uninstalled` with
`lastInstallError`, audits `module.install_failed`, and raises
`LifecycleError('install-failed')` — CLI exit 70. Do not swallow errors in a
hook to "be safe": failing loudly *is* the safe behaviour, and it is the only
one that leaves the instance in its pre-install state.

**3. A failing uninstall hook aborts the uninstall and removes nothing.** The
hook runs before the settings sweep, before the migration revert and before the
registry row is touched, so a throw leaves the module exactly as it was.

**4. `ctx.hard` discriminates soft from destructive.** A soft uninstall means
"this deployment no longer carries the module"; it is reversible and must drop
no rows. A hard uninstall means the schema goes too. Destructive cleanup lives
behind `if (!ctx.hard) return;`.

**5. Neither hook fires on activation or deactivation, and none may be added
there.** That is the operator axis of Constitution XVII — `module:enable`,
`module:disable` and the `/platform/modules` activation Setting all leave both
hooks untouched. Off is reversible and drops nothing; uninstall is not and does.

**6. The hook context is `{ em, redis, log, module }` — plus `hard` on
uninstall — and cannot carry services.** A hook that needs a collaborator
constructs it from `em`. Nothing resolves from the container here, because there
is no container in the process running it.

## The checks

| Script | What it refuses |
| --- | --- |
| `check-kernel-boundary.ts` | an ORM relation from the kernel into a module, or from a module into another module; **and** any import specifier under `src/kernel/**` resolving into `src/modules/` or `src/apps/` — every shape, `import type` included. Carries `KERNEL_MODULE_IMPORTS_TO_DRAIN`, a two-way ratchet holding the one edge D-37 A1 escalated rather than fixed |
| `check-port-dependencies.ts` | a resolved name nobody owns; an owner not in the resolver's manifest dependencies; a singleton capturing a gated port — **including one the module provides itself**; a **gated port resolved from a `ctx.onBoot` hook or a `ctx.routes` body**; a root shadowing a module's port; a computed port name |
| `check-port-catches.ts` | a `catch` around a gated-port call that does not let `ModuleDisabledError` past — unconditional re-throw, `rethrowIfModuleDisabled`, or naming the error. Carries `PORT_CATCHES_TO_DRAIN`, a two-way ratchet |
| `check-container-imports.ts` | a module importing `awilix` directly instead of going through `ModuleContext` |
| `check-entry-scope.ts` | a non-HTTP entry point — CLI script, BullMQ worker, `setInterval` sweep — that establishes no scope (T037) |
| `check-channel-resolution.ts` | a raw `x-sales-channel` header read outside the resolver; a storefront surface re-resolving the request channel; a settings read whose channel argument can be a string that is not a channel uuid (D-42); a channel id invented by a default parameter or a `randomUUID()` fallback (D-48). Runs `--enforce` in CI |
| `test/contract/kernel/harness-parity.test.ts` | drift between the two composition roots, as an explicit ledger |

The check reads three resolution shapes, and the third took a second pass to get
right (issue #90): a factory's cradle parameter (destructured or named), an
inline `ctx.cradle<C>()`, and **either of those bound to a local first** —
`const cradle = ctx.cradle<C>()` and `const cradle = (): C => ctx.cradle<C>()`.
Fifteen modules used one of the two alias forms and every read through them was
invisible, including gated ports destructured in a `ctx.routes` body. Where the
alias is read decides the verdict, exactly as an inline read does: `cradle().x`
inside an `asFunction` factory is a **capture**, because the factory body runs
when Awilix constructs the registration.

The port check carries three allow-lists, all meant to drain rather than grow:
`HOST_REGISTERED_PORTS` (a root registering on behalf of a module), then
`WIRING_RESOLUTIONS_TO_DRAIN` — the gated ports still destructured
in a `ctx.routes` body when D-39 taught the check to see the shape, **now
empty** — and `ALIAS_HIDDEN_RESOLUTIONS`, the reads the alias hid whose repair is
a manifest decision with an operator-visible consequence rather than a one-liner.
A **new** one fails the build.

Read the first list's size with its own history in mind. It was written as
conversion residue and drained that way — every entry whose owner converted was
deleted, and the check fails when one outlives its owner. All 65 core modules have
converted, and **28 entries remain**, so what is left is not residue: it is the
composition inputs no module can default. Three shapes account for nearly all of
them — *who is asking* (`customerContextResolver`, `cartActorResolver`,
`adminAuditActorResolver` and the rest of the actor family, where production reads
`request.actor` and the harness `request.testActor`), *does this composition run
that consumer* (`pwaRunWorkers`, `searchRunWorkers`, `webhooksRunWorkers`), and
*bridges a root assembles across boundaries a module must not reach through*
(`pwaBridge`, `invoicesBridge`, `returnsBridge`, `productFeedsBridge`,
`megamenu*Deps`). Several of the per-entry comments still say "still hand-wired"
about a module that converted; the staleness check only fires when the owner
registers the port itself, so a comment can rot without failing the build.

Ports
owned by a `nonDeactivatable` module are not on that list and never will be: the
exemption is computed from the manifests, because a gate the orchestrator refuses
to close on either axis has no state in which it can throw. The other exemption
is no longer the script's: an edge that cannot be
declared because declaring it would close a manifest cycle is declared in the
resolving module's manifest, as `acknowledgedDependencies` — `organizations`
resolving `addressService` is the worked example, since `addresses` declares
`organizations` and the tenancy root must install first. It sits in the manifest
rather than here because the lifecycle's flip-time dependency refusal reads the
same declaration (feature 073, Amendment A1): while the edges lived only in this
script, an operator could switch `price_lists` off underneath `catalog`'s
`pricingService` resolution and nothing refused the flip.
