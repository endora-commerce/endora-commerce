---
title: The customisation ladder
description: The ordered list of seams for changing what the platform does — what each costs, what it loses, and who may use it.
---

# The customisation ladder

You need the platform to behave differently. There are six ways to do it, they
are ordered, and each one costs more than the one below it. **Start at the
bottom.**

An author who does not know this list reaches for the most powerful seam
available. That is not a hypothesis about people — it is what happened here, and
it is why `ForeignDecorationError` exists.

Three things make this list bite rather than merely read well:

1. **Every divergence you write carries its rung** in your deployment's own
   generated report (`backend/src/apps/<deployment>/divergence.generated.md`), so
   arriving repeatedly at a high rung is measurable rather than anecdotal. The
   paths on this page are this repository's; in an instance written by
   `npx create-endora-commerce` the same files sit under `apps/<deployment>/` at
   the instance's root, and `pnpm run generate` renders the report.
2. **Every refusal names the rung below that works**, so if you reach too high
   the platform tells you where to reach instead, at the moment you reach.
3. **A rung you cannot use says so.** Rung 3 is not available to a deployment
   wanting to substitute an implementation, and this page says that rather than
   listing it as an option you will discover is closed.

## Two questions, not one

"How much does this cost?" and "may I do this?" are different questions, and
conflating them is what made the previous version of this list wrong.

|  | a core module | your deployment's overlay module | an installed package |
| --- | --- | --- | --- |
| act on its **own** surface | yes | yes | yes |
| act on **another module's** surface, by that module's invitation | yes | yes | yes |
| act on another module's surface **uninvited** | no | **yes**, except an installed package's registrations and the four guard seams | no |

The middle row is rungs 1–3: a seam the owner published, at which you are a
guest. The bottom row is rung 4, and a deployment is the only party that has it —
because a deployment owns its instance outright: it edits its own tree, it builds
the image, and it answers to nobody but itself.

**The column is decided by where the platform found the module, never by what
the module says.** Every composed module has an origin, stamped by the loader
that discovered it: `core` (a module of the platform, including a first-party
module package installed in an instance), `deployment` (an overlay module under
`apps/<deployment>/modules/`) or `package` (every other installed package). No
manifest field sets it, and owning a table does not change it. A deployment may
grant an installed package one named contribution point in its committed
`divergence.ts`, where a point offers that; the grant is a permission at that
point only, and the package's origin stays `package` everywhere else.

Every "who may" answer on this page is enforced by a guard that exists
(`ForeignDecorationError`, `PackageDecorationNotOfferedError`,
`DuplicateRegistrationError`, `ForeignRegistrationError`,
`CommandMiddlewareOriginError`), not by this table.

---

## Rung 0 — configuration

**Mechanism.** A Setting the module declares, on `/settings`. Runtime custom
fields, for "add a field". The order status graph. Operator activation on
`/platform/modules`.

**Costs.** Nothing. It survives every upgrade, because it is data.

**Loses.** Nothing.

**Who.** Everyone, including an operator with no developer.

**When it is the answer.** Whenever the requirement is *"this value should be
different here"* or *"add a field"*. Most requests that arrive as "change the
code" end here, and an author who has not checked rung 0 first has not started.

---

## Rung 1 — subscribe to what the owner already emits

**Mechanism.** `ctx.subscribe('<event>', handler)`, registered from your module's
`backend.ts` — never from a plugin body.

**Costs.** Nothing at the seam. The subscription is gated on your own module's
effective state, so switching your module off stops it.

**Loses.** Nothing. You observe; you do not change what the owner did.

**Who.** Everyone.

**When it is the answer.** Additive work triggered by something that already
happened: notify, mirror, enrich a downstream, write your own row.

:::warning There is no catalogue of what you can subscribe to
The platform emits events from 46 sites and no module manifest declares one, so
"what can I subscribe to?" is answerable today only by reading the platform's
sources — which a client installing packages cannot do. Publishing an `events`
block on the module manifest, in the shape `permissions` and `actions` already
have, is the repair; it is a module feature across the whole estate and it is not
built. **This rung is real and undiscoverable**, and that is stated here rather
than left for you to find out.
:::

:::note Not on this rung: taking part in the write itself
A subscriber runs after the commit and cannot change or refuse what was written.
To act **inside** an owner's write — add your own row in the same transaction,
or refuse it — use a command hook, which is rung 2 (2b below).
:::

---

## Rung 2 — run before or after what the owner already serves

Three mechanisms, one rung: around an endpoint (2a), inside a write the owner
declared hookable (2b), or around every Command whose action matches a filter
(2c). Each may refuse; none replaces what the owner does.

### 2a — an API interceptor

**Mechanism.** `ctx.interceptors([{ id, target, phase, order, handler }])`. The
target is the stable endpoint identity `"<METHOD> <route pattern>"` — the pattern
exactly as the owner registers it (`/api/v1/orders/:id`, never a concrete id).

**Costs.** A coupling to an endpoint identity, which is public API and is
versioned. `order` has a documented tie-break; registration is refused after the
server is ready; execution is gated on your module's enabled state; the registry
can print the whole execution plan.

**Loses.** Nothing structural. A `pre` interceptor may veto by throwing a
registered error; a `post` one must not write, because the endpoint's own write
may already be committed.

**Who.** Everyone, across owners. **This is the strongest seam a stranger has**,
and it is the one to reach for before asking the owner for anything.

**When it is the answer.** Adjust what goes into or comes out of an endpoint that
already exists; add a field to a response; refuse a request on a rule of your own.

:::caution An interceptor against an endpoint nothing serves never runs
The registry accepts the target silently. Nothing tells you at run time. Your
deployment's divergence check reconciles every target against the route table and
fails the build with `unmatched-interceptor-target`, which is the only thing that
will.
:::

### 2b — a command hook

**Mechanism.** `ctx.commandHooks([{ id, on, phase: 'beforeCommit', handler }])`,
where `on` is a ref the owner publishes in `@endora-commerce/contracts` for a
Command it declared hookable (`ORGANIZATION_HOOKABLE_ACTIONS.register`). The hook
runs inside the owner's transaction, after its write and before its audit entry.
The details are on [Command Bus](./command-bus.md#command-hooks-beforecommit).

**Costs.** A coupling to the hookable action and its data shape, which are public
API the owner versions, and a dependency edge in your manifest on the owner. A
hook holds the owner's transaction open while it runs, so it makes no remote call.

**Loses.** Nothing structural. The owner's write, its single audit entry and the
bus itself stay the owner's: a hook can add its own rows (through its own tables
or a Command run with `ctx.run`) and refuse the whole write, and nothing else.

**Who.** Everyone, across owners — core modules, your deployment's overlay modules
and installed packages alike — but only on actions the owner declared. A hook on
an undeclared action, two unordered hook modules on one action, or a hook module
that does not depend on the owner refuses the composition at boot. Your
deployment orders two unrelated hook modules in its `divergence.ts`
(`commandHookOrder`).

**When it is the answer.** A rule of your own that must hold for every write of a
record, whichever endpoint or port it came through; data of your own that must
commit with the core row or not at all.

### 2c — command middleware {#2c--command-middleware}

**Mechanism.** `ctx.commandMiddleware([{ id, phase, … }])`, declared in your
manifest's `commandMiddleware` with the same id, the phase and an action filter —
`'*'`, a full action (`quote_request.create`) or a prefix ending in `.`
(`organization.`). Two phases, and nothing else:

- **`admit`** runs before the Command does anything, before the transaction
  opens, for the root Command and every matching child. It gets metadata only —
  the action, the object, the actor, the organisation, the request id and the
  lineage — and may only pass or throw `CommandRefusedError` with a code your
  manifest declares. A refused Command writes nothing and records no audit entry.
- **`observe`** runs after the run has committed or rolled back, detached from
  the caller, and gets the outcome: committed or not, the refusal or error code,
  the duration, and every Command the run attempted. It is read-only, and a
  throw in it is logged and swallowed.

**Costs.** A coupling to action names, which are the owners' and change with
them. Every `admit` runs on the write path of every Command it matches, so it has
a time budget (100 ms by default, 500 ms at most) and fails closed when it is
exceeded; `observe` has its own (1000 ms, 5000 ms at most) and a cap on how many
are in flight.

**Loses.** Nothing structural. There is no phase that changes a Command's input,
sees its data or its result, or runs around it — what an owner writes stays the
owner's.

**Who.** `admit`: a core module or your deployment's overlay module; an installed
package is refused at composition (`CommandMiddlewareOriginError`), and no grant
lifts that. `observe`: everyone, an installed package seeing the request id but
not the IP address or user agent. Two `admit` modules with overlapping filters
and no dependency path are ordered in your `divergence.ts`
(`commandMiddlewareOrder`), or composition refuses. Both phases are skipped while
their module is off.

**When it is the answer.** Measuring writes, an extra audit sink, a rate limit, a
maintenance freeze, a legal hold — cross-cutting behaviour on Commands, the things
a deployment used to get by wrapping `commandBus`.
[Moving a bus wrap to command middleware](./overlay-pattern.md#moving-a-bus-wrap-to-command-middleware)
is the worked migration.

:::note Operator commands run no middleware and no hooks
A Command Bus an operator command builds for itself, outside the application —
today the schema-extension lifecycle commands — runs no command middleware and no
command hooks, on either phase. Its Commands are still audited. Do not rely on an
`admit` rule to stop a maintenance command run by someone with shell and database
access.
:::

---

## Rung 3 — a strategy port the owner published

**Mechanism.** The owner publishes a named port with `ctx.di.providePort` and,
where the point is substitution, publishes the interface on its package's
type-only `./ports` subpath. You resolve it with `lazyPort<T>(ctx, '<literal>')`
and declare the edge in your manifest.

**Costs.** A dependency edge in your manifest — which is what makes the edge real
to the lifecycle, to the migration order, and to an operator switching the owner
off.

**Loses.** Nothing. The owner keeps the seam and keeps fixing it behind you.

**Who — and read this before you plan around it.**

> **A deployment cannot supply a strategy on this rung.**

`ctx.di.providePort` claims the name, and the claim is refused when another
module already owns it, with **no overlay exemption**. Nor is there a
published-but-unimplemented port waiting for one. So this rung is available in
exactly one direction: a **consumer** may resolve any published port, and that is
what your report records as `port-consumed`. A **deployment wanting to substitute
an implementation** has no mechanism here and must use rung 4.

**What that means for you.** *Ask the owner for a port.* A repeated arrival at
rung 4 for the same problem is product feedback that the seam belongs in core as
a rung-3 port — which is exactly what the rung stamps on your report make
measurable.

**Between your own modules, the rung is open.** One of your overlay modules may
publish a port with `ctx.di.providePort`, its types in that module's `ports.ts`,
and another of your overlay modules may resolve it with `lazyPort` — importing
nothing of the owner but `ports.ts`, with `import type`, and naming the owner in
its manifest `dependencies`. What a deployment cannot do is substitute a port a
core module or a package owns.

:::note Policy points are not built yet
A *policy point* — a decision an owner declares, which other modules take part in
as participants — is specified for a later release and does not exist in this
one. When it lands, it sits on this rung: a core module and your overlay modules
may be participants, and an installed package only with a grant your
`divergence.ts` gives it for that one point. Until then, nothing on this page
refers to it.
:::

:::note If you are the module author publishing one
A published port's shape is a contract type, never your own class; the container
name in its doc block is contract and a check holds you to it; and an **optional
method on a published port is refused**, because the resolution proxy answers
every property with a function and feature detection through it is impossible by
construction.

A **write** port is the port of its aggregate — extend the aggregate's
`<aggregate>CommandPort` rather than publishing one shaped by a single request
(see [the kernel guide](./kernel.md)) — and every published port method is on
the [contract surface](./contract-surface.md): it is deprecated for a release
before it is removed or changed.
:::

---

## Rung 4 — change what the container hands out

Two mechanisms, one rung, and the second is the wider of the two.

### 4a — decoration {#4a--decoration}

**Mechanism.** `ctx.di.decorate<T>('<name>', (inner) => …)` from your deployment's
own overlay module. **Wrap and delegate; do not replace.**

**Costs.** A contract-version coupling to a shape nothing checks for you.
`ctx.di.decorate<T>` asserts `T` at the call site and compares it to nothing, so
the wrapped shape is declared structurally and interface drift is a runtime
surprise rather than a build failure. The cheap way to get a gate back is for the
owner to publish the interface on its `./ports` subpath and for your overlay to
name it there.

**Loses.** Nothing *automatically*, if you delegate — a core fix to the wrapped
method still reaches you. **Everything, if you replace**: replacement severs the
delegation permanently.

**Who.** A **deployment's overlay module only**. It may wrap what core and the
deployment's own modules register, and any name a composition root supplies
(`redis`, `orm`, `requireAdmin`, …) — **every root-supplied name stays
decoratable but four**. A core module wrapping another module's registration is
refused, and so is anyone wrapping a registration an installed package owns.

**The four guard seams.** `commandBus`, `auditLogService`, `eventBus` and
`emFactory` (`GUARD_SEAM_REGISTRATIONS` in `@endora-commerce/contracts`) are the
names through which tenant isolation and write auditing are enforced, so no
module decorates them:

| Release | An overlay decorating a guard seam |
| --- | --- |
| up to 0.112.x | composes |
| 0.113.0 | **deprecated** — composes, logs `kernel.decoration.deprecated` once per module and name, and is a `deprecated-decoration` warning in your divergence report |
| 0.114.0 | **refused** at composition |

What to use instead: command middleware (rung 2c) or a command hook (2b) for
`commandBus`; an `observe` middleware or a read of `audit_log_entries` for
`auditLogService`; `ctx.subscribe` or an `afterCommit` hook for `eventBus`; and
for `emFactory` nothing — tenant scoping is not overridable, so ask the owning
module for a port.

**Two of your overlay modules wrapping one name** is refused unless your
deployment declares the order, innermost first:

```ts
// backend/src/apps/<deployment>/divergence.ts
export const divergence: DeploymentDivergenceDeclaration = {
  omittedModules: [],
  decorationOrder: {
    // acme_overlay wraps core; beta_overlay wraps acme_overlay
    pricingService: ['acme_overlay', 'beta_overlay'],
  },
  reasons: { /* … */ },
};
```

It is **checked, never applied**: the composer keeps emitting in its own order
and the declaration asserts that order was the intended one, so a declaration
that stops matching refuses at composition rather than silently reordering
anything. One module decorating one name twice is not ambiguous — it wrote both
wraps, in the order it wrote them.

### 4b — a root plugin

**Mechanism.** `ctx.rootPlugin(reason, plugin)` — a Fastify plugin mounted at the
root of the server, taking a reason string at the call.

**Costs and loses.** More than 4a, which is why it shares the rung rather than
sitting below it: a root plugin can add hooks that see **every request of every
module**, which is strictly wider than wrapping one registration, and it is
coupled to Fastify's plugin API rather than to one service's shape.

**Who.** Every module can call it. Your deployment's use of it appears in your
divergence report; a *core* module's use of it is currently judged by nothing,
which is a known gap rather than a permission.

---

## Rung 5 — fork

**Mechanism.** Copy the module package and maintain it.

**Costs.** Everything.

**Loses.** All updates to that module, permanently, including security fixes.
There is no delegation and no channel back.

**Who.** Anyone, and it needs no permission from us — which is exactly why it is
written down. An author who forks without knowing rungs 0–4 existed has paid the
highest price on this list for something rung 2 would have done.

---

## The data ladder: where new data lives {#the-data-ladder-where-new-data-lives}

The rungs above change **behaviour**. New **data** has a ladder of its own, and
it is ordered the same way: start at the bottom.

| Rung | Mechanism | Who | Survives upgrades because |
| --- | --- | --- | --- |
| D0 | **Runtime custom fields** — an operator defines a field on a host entity in the admin | an operator, at run time | it is data: a definition row and a value in the host's own value bag |
| D1 | **A side table** your module owns, keyed by the core row's id and read through your module's port | any module you own, an installed package, a deployment overlay | the table is yours; core never touches it |
| D2 | **Declared extension columns** — additive `x_<moduleId>_*` columns on an extensible core table, declared with `defineColumnExtension` | an installed module package or a deployment overlay that depends on the host | the platform generates the DDL, records it in a ledger, verifies it at every migrate and boot, and core CI holds every open extensible table to keeping them |
| D3 | **A variant the owning module provides** — a type, a status, a configurable shape the owner already models | the owner decides; you configure it | it is the owner's own schema |

**D2 is narrow on purpose.** The extensible tables are exactly the custom-field
host tables — derived from the custom-field binding registry, never a second
list — and in this release only `organizations` is open (the other eight follow
in a later release). The declaring module owns its `x_<moduleId>_*` columns and
only its code writes them, through the platform's accessor, inside a Command or a
command hook; the host keeps the table, its constraints and every undeclared
column. Uninstalling the module keeps the columns (the ledger marks them
orphaned) until an operator drops them with an audited command. The worked
example and every rule are on [Declared extension columns](./schema-extensions.md).

**Never a rung: overriding core schema.** A core column, constraint, index or
entity class is never changed from outside its module, and a package migration
that writes another module's table is refused at `migrate` — by the platform, not
by review. A per-deployment overlay module owns its own entities and migrations —
a side table (D1) or declared columns (D2) — and its migrations face that same
guard, with no exemption for being the deployment's own (see
[Overlay pattern](./overlay-pattern.md#an-overlay-module-owns-its-schema)).

The reason is **not** migration ordering — that argument was measured false and
is retired. The reason is that a shared core schema is the only thing that makes
upgrades feasible: D1 and D2 are the two ways to add schema that a core upgrade
is obliged, and checked, not to break.

---

## Reserved, and deliberately unnumbered: contribution overrides

*Enabling and reordering a module's contributions* — an admin zone's
contributors, a navigation entry, a palette action — would be a rung of its own,
below rung 2, because it changes nothing's behaviour and only what is offered.
**It does not exist**: a zone contribution carries a weight and no `enabled`
flag, and a deployment cannot touch any of them. A zone with four contributors is
ordered entirely by weights their own authors chose.

It is reserved and unnumbered here rather than listed, because numbering a rung
that does not exist is exactly the defect rung 3's correction above is about.

---

## What you changed, and where to read it

Every divergence your deployment writes lands in two generated files in your own
repository, regenerated from your tree and byte-compared in CI:

| File | Reader |
| --- | --- |
| `backend/src/apps/<deployment>/divergence.generated.md` | you, a reviewer, an upgrader, our support |
| `backend/src/apps/<deployment>/divergence.generated.ts` | a program, and the determinism gate |

Beside them sits the one file you write by hand,
`backend/src/apps/<deployment>/divergence.ts`, which carries the things no walk
can produce: the modules you do not ship, the wrapping order where two of your
overlay modules decorate one name, the order of two command-hook modules or two
`admit` middleware modules no dependency ranks, and **one sentence per divergence
saying why**.

The two are reconciled both ways. A divergence with no sentence fails the build,
and so does a sentence describing a divergence that is gone — which is how a
deployment silently reacquires a hazard it once declared.

A reason worth reading eighteen months later names **what core does** and **what
your deployment does instead**. A reason that names only the second is half a
sentence, and "we do not need it" is not a reason at all.

See also: [Overlay Pattern](./overlay-pattern.md).
