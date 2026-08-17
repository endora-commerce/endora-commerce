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
// Not `container.cradle.searchReindexPort`: resolved when the reindex is asked for.
catalogSearchReindex: async () => searchCradle().searchReindexPort.reindexAll(),
```

The deferral is the minimum, not the goal. If the thing the root is deferring is
a **service the owning module could build**, the answer is not a better thunk —
it is the owner registering it and the root forwarding onto that name. Every
root-built service is ungated whatever the root does with it, so it keeps
answering after its module is switched off, and the two roots build it slightly
differently sooner or later. `ROOT_MODULE_VALUE_IMPORTS` is where that is
measured; the count of services a root constructs is zero and stays zero.

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

The third registry of that family, `gatewayRefundRegistry`
(`payments/services/gateway-refund-registry.js`), converted with feature 074 and
is the worked example of the *other wiring* a contribution seam takes: `stripe`,
`tpay`, `payu` and `autopay` **import the singleton** and push their refund
handler into it, so no container resolution exists for any check to see. It
records the contributing module now and states **skip**, and the ground is worth
keeping because it is the argument every money-side policy meets: a switched-off
gateway must not charge or refund through its PSP's API, and skipping does not
drop the obligation — `PaymentRefundProvider` records `pending_manual` naming the
module that is off, which is what a deployment that never installed the gateway
already gets. The presence probe is wired at the singleton
(`payments/services/registry-singleton.ts`), not in the class, for the reason its
twin gives: a registry a test builds for itself must keep answering about the
handlers that test registered.

**Three more converted with issue #129, and they did not get one answer, because
"state a policy" is a question rather than a sweep.** `ConfigurationTypeRegistry`
(`credentials`) states **skip**, on the ground the skip column already gives: a
configuration type is what the credentials screen offers to configure and what a
write is validated against, so a capability an operator switched off is neither
offered nor creatable, and `resolve` raises `ModuleDisabledError` naming the
contributor. Its contributor was already recorded — the descriptor carries
`ownerModule` — so the host had the id and was simply not consulting it. The
split is the adapter registries': `entry`, `ownerOf`, `isRegistered` and
`listAll` stay presence-blind, and the paths that read them are the ones that
*render* a stored configuration and the ones that redact it into an audit
snapshot, which must keep knowing which of its values was a secret. Its probe is
the tri-state `effectiveState.presenceOf`, not `isPresent`: this registry is the
seam an overlay or external module pushes a type through, so `ownerModule` may
be a string no manifest declares, and collapsing "unknown id" into "absent"
would filter the extension point away.

The two order-status registries — `payment_methods:paymentOrderStatusRegistry`
and its `delivery_methods` twin — state **honour**, and the reason is that there
is nothing to skip. The ledger classifies them as contribution seams because
`payments` and `shipments` read them across a module boundary, but no module
contributes to either: the option set is `orderStatusSchema`, fixed at compile
time. The reads are guards rather than surfaces — `has` is asked before an order
is moved into the status a settlement names — so a skip would leave a paid or
shipped order silently in its old status, and every code in the table is one live
orders are already in. The policy is structural rather than promised: the class
takes no presence input, so no read of it can be made to drop a status without
changing the policy first. What an operator loses by switching those modules off
is carried where it belongs — each module closes its own catalogue at its own
seam, and `orders` declares the sentence the confirmation dialog renders.

## The deactivation-consequence ledger

Principle XVII's flip-time refusal is becoming an informed confirmation
(feature 074), so the platform may come to rest with a **present module
depending on an absent one**. Every seam between the two then needs an answer to
"what happens?", and the operator being asked to accept the flip needs the same
answer, by name, before the write. There is one artefact for both, and that is
the point of it rather than an economy:
`modules/_lifecycle/services/deactivation-ledger.ts`.

`buildDeactivationLedger` assigns every cross-module edge whose owner an
operator may switch off one of four outcomes:

| Outcome | Mechanism |
| --- | --- |
| **fails closed** | a call-time read of a gated port, or of a registry whose host *skips* an absent owner's entry — the caller gets nothing back, which is the same answer arriving at enumeration instead of at the port |
| **degrades** | the dependent's own `nonBindingDependencies` entry of kind `degrades-without`; its `whenAbsent` is the sentence an operator is shown |
| **contributes** | a boot-time push into an ungated table the host filters, or a host that deliberately *honours* an absent owner's entry |
| **schema-only** | a `dependencies` edge with no container read under it: deactivation drops no tables, so a foreign key stays valid |

An edge that gets none is reported by shape, and `check-port-dependencies.ts`
fails the build on it. There are three, each a *fail-open* rather than a
fail-closed: a **captured** cross-module registration, read once at construction
and answering for ever after; a read of an **ungated registry whose owner states
no policy**; and a **gated port resolved before the first request**. Edges into a
module the platform refuses to switch off carry no entry at all — the flip cannot
happen, so there is no state to describe.

`deactivationConsequencesFor` projects the same entries into the rows an operator
sees. The confirmation dialog and the 409 `MODULE_DEACTIVATION_UNCONFIRMED`
envelope both read that one function over that one ledger, so the two id sets
cannot drift: they are the same expression, not two lists somebody keeps in step.
Two independent computations of "what will stop working" would drift, and the CI
one would be the copy nobody reads.

Two tables carry the standing debt, both two-way like every other ledger here.
`CONTRIBUTION_POLICY_STATED` names the registries whose host has decided, with
the decision as the value, so a reader need not open the class.
`REGISTRY_POLICIES_UNSTATED` names the ones that have not, each with what would
drain it — and an entry there excuses **one** shape for **one** name, because a
capture over the same name is a different failure with a different fix.

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
  `{ source: 'none' }` (a variant carrying no rate — issue #124 removed the
  `rate: 0` that made it readable as an answer); `applyToCart` answers
  `discountTotal: 0`. The
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

One thing it allows on purpose: a `catch` may hand the error to a **delegate
that re-throws it** — a helper ending in `throw <its own parameter>`
(`toCatalogHttpError(…): never`) or one calling the narrowing on the caller's
behalf (`ReturnEmailNotifier#contained`). Eight sites in the tree are written
that way and all eight are correct.

### What the check can see (issues #133 and #113)

The rule is about the `catch`; the blind spots were about **how the port
arrives**. Both of these read clean for months:

- a `catch` around the **holder** rather than the resolution —
  `new CartPricingRecompute(em, lazyPort(ctx, 'pricingService'), cache)` reached
  later as `deps.cartPricingRecompute.recompute(…)`. Three of them sat on
  `GET /api/v1/cart` and rendered a full priced cart from stale snapshots with
  `price_lists` switched off;
- a port a **root contributes** —
  `registerValues(container, { shipmentEmailSender: () => emailCradle().transactionalEmailSenderAccessor() })`,
  resolved by the module as an ordinary cradle name with no `lazyPort` literal
  anywhere on the path. The five e-mail notifiers were invisible for this reason,
  and the count read `catches=42 violations=0` before and after their repair.

They are one defect, and they close with one mechanism: the alias table is a
**fixpoint over port-carrying values** rather than a scan for `lazyPort`
literals. A value carries the gate if it is a resolution, if it is constructed
from one, if it is handed to a factory, or if it is a closure whose body reads
one; every name such a value is bound to becomes an alias, and that feeds the
next round. The holder is one round of that loop and a root's registration key is
another. Widening it moved the tree from `catches=42 violations=0` to
`catches=94 violations=24`.

What does **not** carry is equally load-bearing, and each exclusion was paid for
in false positives: a call's **result** (`proxy.applyToCart(…)` is the gated
call, the discount it returns is data), an **object literal** (a deps bag is a
record — tainting it made `this.deps.<anything>()` a port call, 39 of them in one
run), and a **field read off a port**. Scope follows the binding: a `const` is
file-scoped because it is, a deps key or constructor parameter is module-scoped
because the receiving class reads it from another file, and a root's container
registration is visible everywhere because a container name is global. Run with
`PORT_CATCH_WHY=1` to see every alias with the site that introduced it.

`PORT_CATCHES_TO_DRAIN` holds the sites where absorbing the answer is still the
least-wrong behaviour, each with its reason, in three shapes the entries name:

- **after the fact** — the guarded call runs once the operation it belongs to has
  committed (a transient-address cleanup, a verification e-mail, a bell
  notification for a finished bulk job, webhook delivery bookkeeping). Re-throwing
  would report a failure for work that succeeded, and on a retry would redo it;
- **a degrade the owner should be answering** — the caller is right to keep
  serving without the module (Constitution XVII), so `rethrowIfModuleDisabled`
  would be the *wrong* fix: catalog availability degrades to "no indication", the
  Meilisearch listing falls back to Postgres. The answer belongs in the
  contribution's return type or a `nonBindingDependencies` entry;
- **a boot hook** — the presence answer has no caller to reach, and re-throwing
  it aborts the boot (see *The boot phase re-throws* below; `runBootHooks` does
  **not** catch, whatever this bullet said until issue #146). `product_feeds` and
  `pim_ergonode` reconcile their schedules that way, and narrowing those two was
  tried and reverted: it changed what the harness boots with. The fix there is the
  timer rule — decide presence *before* the work.

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
…all root contributions…             (composedModules.contribute, bridges, eager reads)
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

That slot is a **method**, not a convention (issue #52): `composeModules`
returns a `ComposedModules`, and a contribution is
`composedModules.contribute({ name: value })`. Both edges of the window come
with the shape rather than with the reader's memory — the early edge because
there is no object to call it on until every module has registered, the late
edge because `runBootHooks()` closes it and a later call throws
`ContributionWindowClosedError` quoting this rule. Closed by the *start* of the
boot phase, not its end: hooks run in registration order, so a contribution made
from inside one is already invisible to every hook that ran before it. Writing
`registerValues(container, …)` after `composeModules` would reopen the window
silently, so `test/contract/kernel/harness-parity.test.ts` refuses one in either
root — above the call it stays correct, and that is where a host value belongs.

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

### The boot phase re-throws

`runBootHooks` wraps each hook, attributes the failure to the module that
registered it, and **re-throws**:

<!-- verbatim-from: backend/src/kernel/compose.ts -->

```ts
try {
  await hook();
} catch (err) {
  if (alreadyNamesTheModule(err)) throw err;
  throw new ModuleCompositionError(moduleId, 'boot', err);
}
```

Three documents said the opposite for months — this page in two places,
`check-port-catches.ts`'s ledger and `AGENTS.md` — and the claim was
load-bearing: two boot-hook
sites were ledgered rather than fixed on the belief that the kernel absorbed the
throw centrally. The block above is quoted rather than described for that reason;
`check:doc-snippets` fails this page if it stops matching the source.

Re-throwing is the ruled behaviour (issue #146, D-67). A boot hook runs during
composition, before the Fastify app exists: there is no request to answer and no
degraded surface to serve, so a swallowed failure would mean the platform starts
with a composition that is not what the code says — a missing payment adapter, an
unregistered asset-reference scanner, an email default nobody pushed — and says
nothing. `index.ts` turns the throw into `process.exit(1)`, and
`test/integration/kernel/boot-failure.test.ts` pins both halves: the error names
the module and the phase, and no partially-composed server ever listens.

The hazard that argues for catching — a module the operator switched off taking
the boot down with it — is closed structurally rather than by a `catch`. A gated
port resolved from a boot hook is refused by
`check:port-dependencies` (`gated-port-at-boot`), and D-39 keeps every
contribution registry an ungated `ctx.di.register` for the same reason, so an
operator flipping a switch cannot raise `ModuleDisabledError` during composition.
What is left is a hook whose own work fails, which is a real failure; a module
that wants a narrower tolerance writes it **inside** its own hook and says why,
the way `product_feeds`' `reconcile` helper does. That helper is not redundant
with a kernel decision — it is the only thing standing between a drifted schedule
and a dead boot.

### The one thing a root still has to do in order

`EventBus.dispatch` awaits its handlers in **registration order**, so the two
kernel cache invalidators — `composeSettingsKernel` and
`composeSalesChannelsKernel`, each of which attaches one — are composed **before**
`composeModules(MODULES, …)` in both roots. A module subscribing to
`settings.value_changed` ahead of the settings cache's own invalidator runs its
handler against the pre-write value, and the two-pass era recorded the symptom
the first time `meta_ads` and `linkedin_ads` were moved ahead of it. Compose the
invalidators first and the question cannot be asked.

Every module subscription in the tree goes through `ctx.subscribe`, and that is
now enforced rather than asked for. Until issue #107 a module could subscribe
with a bare `eventBus.on` from a plugin body: the invalidator ordering above
still protected such a handler, but the module's effective state did not, because
only `subscribeForModule` consults it. Routes and workers each had a seam check
and subscriptions had none, so twenty-two of them accumulated across nine modules
while each of those modules' conversion tasks read done — and a subscriber
**writes**, which makes it the worse half of the gap: an invoice issued,
numbered and e-mailed, a quote request flipped to Completed, a push message
delivered to a customer's device, a shopping list created, all for a module the
operator believed was off.

`pnpm --filter backend run check:subscribe-seam` is the ratchet. It reads a
module's own sources for a call on an event-bus-shaped receiver, and carries
`BARE_SUBSCRIPTIONS_TO_DRAIN`, an **empty** two-way ledger: an unledgered bare
subscription fails the build, and so does a ledger entry that no longer describes
one. The kernel is deliberately out of scope — it composes before any module and
has no effective state to gate on, so its two cache invalidators subscribe
directly, which is the ordering fact the paragraph above depends on.

### An entry point with no caller decides presence

A route seam gates requests; a plugin **body** is not a request. It runs at boot
whatever the module's effective state, so a timer started there keeps firing
after an operator switches the module off — `price_lists` went on flipping
`scheduled → active` and `active → expired` every five minutes, which changes
what customers are charged. A timer callback also has nowhere to throw *to*, so
`ModuleDisabledError` cannot propagate from it: raised there it is either
swallowed by a `catch` meant for transient failures or it takes out the tick.
The callback therefore **decides** — `if (!effectiveState.isPresent('<id>'))
return;`, first and outside any `try`, so a switched-off module and a failed tick
never share one silent no-op. Where the timer *is* the loop, as in `search`'s
self-rescheduling reindex tick, the off branch re-arms and skips the work;
returning without re-arming would stop the scheduler for the life of the process.

`pnpm --filter backend run check:timer-presence` is the ratchet (issue #126), and
what it sees is narrower than the rule: a `setInterval`, a `setTimeout` whose
callback re-arms a timer or calls back into the function that armed it, and a
`process.on` lifecycle handler — in a module's own sources. A one-shot deadline
inside an operation that already has a caller is out of scope. `ctx.onBoot` is out
of the check's population too, but **not** because the kernel decides presence for
it: nothing in the kernel does (see *The boot phase re-throws* above), so a working
boot hook carries the same obligation a timer callback does and no check enforces
it yet — issue #146, and the ratchet it needs is D-68's.
The first two shapes live in `backend/scripts/lib/repeating-timers.ts` and are
read by `check-entry-scope.ts` as well (issue #128). That check classified its
interval entry points by grepping for `setInterval(`, so `search`'s reindex loop
was outside the population it counted and the FR-020 gap there stayed invisible
behind a number that never moved. Two detectors for one shape is how they drift;
the rules stay separate — one asks whether the callback decides presence, the
other whether the file opens a scope — but the recognizer is one.

`TIMERS_WITHOUT_PRESENCE` is two-way like the ledgers above but, unlike them, is
not expected to empty: an entry says why a timer is right to keep running while
its module is off — the lifecycle lock's lease heartbeat belongs to the command
that holds the lock, and `_lifecycle` is non-deactivatable.

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
`_lifecycle/manifest-index.generated.ts`, the one generated manifest registry;
you never edit a registry. The same generator emits the composer,
`db/entities-registry.generated.ts` and `db/migrations-registry.generated.ts`
from the same tree walk — one command, so two artefacts refreshed by two
commands cannot drift again. Run
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
| `check-port-dependencies.ts` | a resolved name nobody owns; an owner not in the resolver's manifest dependencies; a singleton capturing a gated port — **including one the module provides itself**; a **gated port resolved from a `ctx.onBoot` hook or a `ctx.routes` body**; a root shadowing a module's port; a computed port name; **and an edge into a switchable module with no defined behaviour when that module is off** (the deactivation-consequence ledger above) |
| `check-port-catches.ts` | a `catch` around a gated-port call that does not let `ModuleDisabledError` past — unconditional re-throw, `rethrowIfModuleDisabled`, naming the error, or a delegate that re-throws it. Follows the port through a holder and through a root contribution (issues #133/#113). Carries `PORT_CATCHES_TO_DRAIN`, a two-way ratchet |
| `check-container-imports.ts` | a module importing `awilix` directly instead of going through `ModuleContext` |
| `check-entry-scope.ts` | a non-HTTP entry point — CLI script, BullMQ worker, repeating-timer sweep — that establishes no scope (T037). The timer class is the *shape*, not the constructor: it reads `lib/repeating-timers.ts`, shared with `check-timer-presence.ts`, so a `setTimeout` the callback re-arms counts (issue #128) |
| `check-channel-resolution.ts` | a raw `x-sales-channel` header read outside the resolver; a storefront surface re-resolving the request channel; a settings read whose channel argument can be a string that is not a channel uuid (D-42); a channel id invented by a default parameter or a `randomUUID()` fallback (D-48). Runs `--enforce` in CI |
| `test/contract/kernel/harness-parity.test.ts` | drift between the two composition roots, as an explicit ledger — including `ROOT_MODULE_VALUE_IMPORTS` (T143c): every **value** import a root takes out of `src/modules/**`, keyed by owner, with what has to happen for it to drain, and "no root constructs a module-owned service" against a named allow-list |

That table is the kernel's own checks. The **whole** inventory — including
`check-command-coverage.ts`, `check-subscribe-seam.ts`, `check-doc-snippets.ts`,
`check-error-translations.ts`, `check-entity-tenant-classification.ts`,
`overlay:check`, the two toolchain-free shell checks and the pdfmake footprint
gate — is enumerated in `backend/test/unit/scripts/check-inventory.test.ts`,
which fails when a `check-*` script exists without an entry, and when an entry
names a script that does not. Read the next section before adding one.

The check reads three resolution shapes, and the third took a second pass to get
right (issue #90): a factory's cradle parameter (destructured or named), an
inline `ctx.cradle<C>()`, and **either of those bound to a local first** —
`const cradle = ctx.cradle<C>()` and `const cradle = (): C => ctx.cradle<C>()`.
Fifteen modules used one of the two alias forms and every read through them was
invisible, including gated ports destructured in a `ctx.routes` body. Where the
alias is read decides the verdict, exactly as an inline read does: `cradle().x`
inside an `asFunction` factory is a **capture**, because the factory body runs
when Awilix constructs the registration.

The port check carries four allow-lists, all meant to drain rather than grow:
`HOST_REGISTERED_PORTS` (a root registering on behalf of a module), then
`WIRING_RESOLUTIONS_TO_DRAIN` — the gated ports still destructured
in a `ctx.routes` body when D-39 taught the check to see the shape, **now
empty** — `ALIAS_HIDDEN_RESOLUTIONS`, the reads the alias hid whose repair is
a manifest decision with an operator-visible consequence rather than a one-liner,
**also empty** since feature 074 gave `commerceModule`'s constructor accessors,
and `REGISTRY_POLICIES_UNSTATED`, the ledger's policy debt. A **new** one fails
the build.

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
script, an operator could switch the owner of an acknowledged port off underneath
a live resolution and nothing refused the flip. The example that found it was
`catalog` resolving `price_lists:pricingService`; feature 074 has since made
`price_lists` core, so that particular flip is closed by the owner's own
declaration — but the mechanism is not about which modules happen to be core,
and the edge is still declared where both readers can see it.

### Writing a check that can go red

Six checks were found weaker than their own description in one week. One walked
`*.entity.ts` and inspected relation decorators while its header spoke of
imports; one could not see a module-local cradle alias, and widening it turned
0 violations into 21 across 17 modules; one scanner matched **4 of 492**
enforcement sites because a `\.` in its regex was not optional; EventBus
subscriptions had no ratchet at all until twenty-two had accumulated — a figure
this page stated correctly 190 lines earlier and wrongly here for a week, which
is how a wrong count survives: a document disagreeing with itself reads as
two authors, not as an error. None of
those was carelessness, and none of them announced itself: **a green result
cannot be told apart from a check that looked at nothing**, and nothing in the
repository forced the distinction. Six rules come out of it.

**Take the input as a parameter.** A check whose analysis reads the disk can
only be run against the tree, and against a clean tree it agrees with a function
that returns `[]`. `checkSubscribeSeam({ sources })`, `checkDocument(doc, read)`
and `compareArtifact(path, expected, read)` all take what they read, so their
tests drive them over sources the repository does not contain — which is the
only way to see the rule fire on the shape it was written for. Keep the CLI a
thin `main` that supplies the real reader.

**The fixture enters at the top of the analysis.** "It goes red on a synthetic
fixture" is not enough on its own, and the counter-example was the guard itself:
the inventory's entry for `check-entry-scope` handed `violationsOf` a
**pre-classified record**, so it proved the last function in the chain while the
classifier — which was the broken part — never ran. That classifier grepped for
`setInterval(`, could not see a self-rescheduling `setTimeout`, and a live
FR-020 gap sat behind it for as long as the proof read green (issues #128,
#130). **A fixture that enters below the defect cannot catch it.** So the proof
starts from what the check reads in a real run — source text, a file map, an
injected reader, a fixture tree on disk — and every stage the check owns,
population filter and classifier included, runs on the way to the assertion.
Each entry in the inventory declares `enters: 'top'` for exactly this, and
anything else goes in `PROOFS_ENTERING_BELOW` with what it would take to raise
it.

**Prove the set of shapes, not the one that existed when it was written.** A
proof can enter at the top and still test one spelling of five, and then four
fifths of the check can go blind behind the fifth's red. `check-subscribe-seam`
names three signals and its fixture — `eventBus.on('inventory.adjusted.v1', …)`
— satisfied two of them at once, so neither could fail alone; `check-timer-presence`
names three constructs and proved `setInterval`; `check-channel-resolution`
names four signals and proved one. Where a check's header enumerates a set, the
inventory carries one proof per member, each fixture narrowed so it can only
trip the signal it is named after, and each asserting the finding's **kind**
rather than a bare count.

**Make the scan scope a property of the rule, not of a filename.** Two checks
enumerated `*.entity.ts`. Nothing in the repository enforces that suffix, so an
entity declared in an `entities/index.ts` was not *unclassified* as far as they
were concerned — it was unread, and unread and clean print the same line. Walk
the tree, pre-filter on the thing the rule is about (`@Entity(`, a relation
decorator), and let the parse decide.

**Give "nothing was read" its own exit code.** Exit 2, distinct from clean (0)
and from violations found (1), whenever the file list, the routing table or the
resolution count comes back empty in a tree that has hundreds. This is not
defensive coding: `pnpm --filter backend run i18n:hardcoded` resolved its
default root against the working directory, found no file from `backend/`, and
printed "0 finding(s) across 0 file(s)" with exit 0 for as long as it existed.
`check-pdfmake-footprint.sh` exited 0 when pdfmake was not installed, so the one
state in which it measured nothing was also the one in which it reported the
budget met.

**A ledger is two-way or it is an allow-list.** An unledgered violation fails,
*and* an entry that no longer describes a violation fails. The second half is
the one that rots: `PORT_CATCHES_TO_DRAIN`, `BARE_SUBSCRIPTIONS_TO_DRAIN`,
`UNTRANSLATED_ERROR_CODES` and `HARDCODED_STRINGS_BASELINE` all sweep for stale
entries, and each entry carries a reason written as a statement about the thing
it names — see "Writing an ordering rationale that does not rot" above for why
"still hand-wired" is not one. **The escape hatch inside a check is a ledger
too**: `command-coverage-ignore` had 185 entries and no sweep until issue #116,
so an ignore written for a write that had since moved kept exempting a method
that no longer needed exempting, and the next write added there inherited the
exemption. When the standing debt is too large for a reason per entry — 274
hard-coded strings across 47 admin screens — the entry becomes the **file** and
the value becomes the count, which ratchets in both directions without asking
anyone to write the same sentence 274 times.

**A check in no CI job is worse than no check**, because its existence implies
coverage. Two ran nowhere until issue #116, and one of them was cited in
`AGENTS.md` as *the* gate on Principle VIII for user-facing strings — a claim the
repository did not back. The reason a check is unwired is almost never "the
property stopped mattering": it is standing debt (turn it into a ratchet) or an
environment assumption that was never re-read (the pdfmake gate was said to need
an installed `node_modules` the `quality` job would have to add, which that job
has installed in `before_script` all along). The inventory's `job` field is where
that decision is written down, and `none` has to be argued in the entry.

The enforcement point is `backend/test/unit/scripts/check-inventory.test.ts`. It
enumerates every `check-*` script, and for each one **runs the check's own
analysis, from its top, over a synthetic violation of every shape it claims to
refuse, and asserts a finding of that kind comes back**. That is deliberately
more than "a companion test file exists": a file at a path proves nothing, which
is the failure this whole section is about. The companion test named in each
entry is where the shape's detail goes — the assertion on the message, the
ledger, the exit code — while the inventory is what keeps a shape from
disappearing when that file is edited. The inventory also pins which CI job runs
each check and compares it against `.gitlab-ci.yml`, so a check that quietly
leaves the job has to say so.

### A benchmark asserts that it measured something before it asserts how long it took

The section above is about a rule that cannot see. This one is the same defect in
a **measurement**, and it is easier to miss, because the number a benchmark
prints is never *wrong* — it is simply not about the thing anyone reads it for.
`test/perf/catalog-list.bench.ts` seeded a synthetic corpus that belonged to no
sales channel, so `filterByChannel` dropped every row (Principle XII fails
closed) and the page it timed contained zero summaries. It reported a p95 of
7 ms and was green from the day channel scoping landed; with the corpus bound
to the channel the same read measures 13–18 ms, all of the difference being the
per-summary work that had never run (issue #140). **A budget met by measuring
nothing and a budget met by being fast look identical in CI.**

So the question to ask a benchmark is the one asked of a check: *if the thing
being measured silently did nothing, would this notice?* Four rules come out of
it.

**Count the work, in the same loop that times it, and assert the count first.**
Not a smoke test in a neighbouring file — the timed run itself carries the
evidence: summaries per page, projected attributes, cart lines served, up-sell
candidates returned, products emitted, carts swept, registry entries resolved.
Assert that count **before** the latency assertion, so a run that measured
nothing fails saying so rather than failing a budget by an unexplained margin —
or worse, passing one.

**Print what was measured next to the duration.** Every `[perf/*]` line carries
its own denominator, because the reader of a benchmark log is usually comparing
two runs weeks apart, and a p95 that halved because the fixture stopped
producing rows is indistinguishable from a p95 that halved because the code got
faster.

**Consume the result.** A microbenchmark that discards the return value is
measuring a call V8 is free to eliminate. `enabled-check.bench.ts` counted the
answers instead, and the honest number came out higher than the one it had been
reporting — which is the correction, not a regression.

**A scenario's precondition is an assertion, not a comment.** "Cold path" was
a `redis.del` on a two-layer cache: the per-process LRU in front of Redis kept
answering, so the cold scenario timed the warm one and both printed 0.1 ms.
The loop now drops both layers and asserts the cache reports a miss before it
starts. Where a fixture is what makes the measurement real — channel membership,
`product_links` rows for an up-sell strip — seed it, then assert the endpoint
returned it.

Where the guard then puts a budget in the red, **report it; do not raise the
budget**. Telling "we are slower than we said" apart from "we were never
measuring this" is the entire value of the guard, and a number moved to make a
build green destroys both.

One caveat the same incident exposed: these benchmarks are gated on `PERF_RUN`
and **no CI job sets it**, so nothing in the pipeline has ever executed one.
`test/perf/catalog/visible-attributes.bench.ts` had been throwing rather than
timing since channel scoping landed, and `pnpm --filter backend run test:perf`
is the only thing that would have said so. Run it locally when touching a hot
path; a scheduled job is the standing debt.
