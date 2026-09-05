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
   arriving repeatedly at a high rung is measurable rather than anecdotal.
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
| act on another module's surface **uninvited** | no | **yes, totally** | no |

The middle row is rungs 1–3: a seam the owner published, at which you are a
guest. The bottom row is rung 4, and a deployment is the only party that has it —
because a deployment owns its instance outright: it edits its own tree, it builds
the image, and it answers to nobody but itself.

Every "who may" answer on this page is enforced by a guard that exists
(`ForeignDecorationError`, `PackageDecorationNotOfferedError`,
`DuplicateRegistrationError`, `ForeignRegistrationError`), not by this table.

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

:::note Not on this rung: the Command Bus
`CommandBus.run(command)` takes a command object and executes it in a
transaction. There is no handler registry and nothing to hook. It is the uniform
write path, not an extension point.
:::

---

## Rung 2 — run before or after what the owner already serves

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

:::note If you are the module author publishing one
A published port's shape is a contract type, never your own class; the container
name in its doc block is contract and a check holds you to it; and an **optional
method on a published port is refused**, because the resolution proxy answers
every property with a function and feature detection through it is impossible by
construction.
:::

---

## Rung 4 — change what the container hands out

Two mechanisms, one rung, and the second is the wider of the two.

### 4a — decoration

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

**Who.** A **deployment's overlay module only**, and totally: it may wrap
anything the container holds, including the names no module owns (`commandBus`,
`auditLogService`, `eventBus`, `emFactory`). A core module wrapping another
module's registration is refused. An installed package is refused — not
ledgered, because what is at stake is the integrity of the audit path.

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

## Never a rung: schema

**Core entities and migrations are never overridden.** Your own tables belong to
a module you own; an extra field on a core entity goes through runtime custom
fields. A per-deployment overlay module ships no entity class and no migration at
all, and the generator refuses both.

The reason is **not** migration ordering — that argument was measured false and
is retired. The reason is that a shared core schema is the only thing that makes
upgrades feasible, and that an overlay lives in the same repository and the same
build as core, so the remedy costs nothing but a directory: own the table from a
module of yours and read it from the overlay through that module's port.

An **installed extension package** is the opposite case and may ship both: a
third-party author has no core module, so the same rule would be a prohibition on
extension packages rather than a constraint to design around.

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
`backend/src/apps/<deployment>/divergence.ts`, which carries the three things no
walk can produce: the modules you do not ship, the wrapping order where two of
your overlay modules decorate one name, and **one sentence per divergence saying
why**.

The two are reconciled both ways. A divergence with no sentence fails the build,
and so does a sentence describing a divergence that is gone — which is how a
deployment silently reacquires a hazard it once declared.

A reason worth reading eighteen months later names **what core does** and **what
your deployment does instead**. A reason that names only the second is half a
sentence, and "we do not need it" is not a reason at all.

See also: [Overlay Pattern](./overlay-pattern.md).
