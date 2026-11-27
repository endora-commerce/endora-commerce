---
title: Overlay pattern (per-deployment customization)
---

# Overlay Pattern

The platform is a **multi-deployment** product — one codebase, many client
installations. Per-deployment customization goes through a **per-deployment
overlay layer** resolved deterministically at build/composition time, never by
editing core files or forking. The
core stays deployment-agnostic and the bare-core build keeps working unchanged.

## How it works

- **Overlay location** — a deployment's own modules live under
  `backend/src/apps/<deployment>/modules/<id>/…`. The active deployment is chosen
  by the `DEPLOYMENT` environment variable at build time; unset (or a deployment
  with no overlay directory) means a bare-core build.
- **An overlay module is a full module, and owns every file it ships.** It may
  own tables and migrations, publish a port to the deployment's other modules,
  and ship an admin screen with its command-palette actions — under the same
  guards as a module package. Nothing in it shadows, replaces or extends a file of
  another module; it is an ordinary module that happens to belong to one client.
  (This was not always so; see *There used to be file shadowing* below.)
- **Flat, and not a package** — a module is a direct child of `modules/`, and it
  has no `package.json`, `tsconfig*.json` or bundler configuration of its own. Two
  concerns are two sibling modules and a declared dependency; see *Overlay module
  layout* below.
- **One id, one owner** — an overlay module id already claimed by core, by a
  workspace module package, by an installed package or by another overlay module
  fails composition, naming every claimant's file.
- **Deterministic resolution** — the resolver (`backend/src/overlay/`) lists the
  module directories under the overlay root with a stable sort. Identical inputs
  produce an identical resolution and an identical **divergence report**, so a
  rebuild never drifts.
- **Divergence report** — every build emits a committed, deterministic record of
  every way the deployment differs from core, in two renderings from one
  derivation: `divergence.generated.ts` for a program and
  `divergence.generated.md` for a human (`divergence.core.generated.*` for bare
  core; per-deployment under `apps/<name>/`). Each entry names what was changed,
  which of the deployment's modules changed it, which module owns what was
  changed, the rung of the [customisation ladder](./customisation-ladder.md) it
  sits on, and the sentence the deployment wrote when it did it. Its predecessor
  recorded one fact — which overlay modules a deployment adds — which survives as
  the report's `overlayModules` field.
- **The deployment's own declaration** — `apps/<name>/divergence.ts`, hand-written
  and reviewed, carrying the three things no walk can produce: the modules this
  deployment does not ship, the wrapping order where two of its overlay modules
  decorate one name, and one sentence per derived divergence. It is reconciled
  against the report **both ways**: a divergence with no sentence fails the
  build, and so does a sentence describing a divergence that is gone.

## In an instance

Everything on this page is written from inside the platform repository, where the reference
deployment's overlay tree is `backend/src/apps/`. In an **instance** — the tree
`npx create-endora-commerce` writes — the same pattern has shorter paths and three commands of its
own:

- **Location** — `apps/<deployment>/modules/<id>/`, at the instance's root, beside
  `apps/<deployment>/divergence.ts`.
- **The active deployment** — `DEPLOYMENT=<deployment>` in the instance's `.env`, written by the
  installer. Unset, the instance starts as the bare platform and none of its overlay modules is
  composed.
- **Scaffolding** — `pnpm exec endora new module <id> --name … --description …` writes an overlay
  module there: `manifest.ts`, `backend.ts` and both `i18n/` bundles. `--entities` adds an entity
  under `entities/` and its first migration under `migrations/`; `--ports` adds `ports.ts` and the
  `ctx.di.providePort` call that registers the port; `--admin` and `--action` add
  `admin/index.tsx`, a screen and its palette entry. It refuses `--worker` and `--subscriber`,
  naming why: each is one call in `backend.ts`, `ctx.worker(…)` or `ctx.subscribe(…)`.
  `pnpm exec endora new migration <id> --name <slug>` writes the module's next migration.
- **A build** — `pnpm run build` runs `endora build overlays`, which compiles `apps/` with the
  instance's own `tsc -p backend/tsconfig.apps.json` into `backend/dist/apps` and copies each
  module's `i18n/` beside the code; `pnpm run dev` does the same on every change. The API, the
  worker and every `module:*` command run the compiled code and compare it with `apps/` first: an
  edit that was not rebuilt, a module that was never built or a compiled file whose source is
  gone stops them, naming both files. `pnpm run typecheck` checks the overlay code with
  `erasableSyntaxOnly` set, so keep to plain TypeScript: no `enum`, no `namespace`, no
  constructor parameter property.
- **The divergence report** — `pnpm run generate` renders
  `apps/<deployment>/divergence.generated.md`, and exits 1 — after writing the report — while a
  derived divergence has no sentence in `divergence.ts`, or a sentence describes one that is gone.
  `pnpm run setup` runs it, so neither slips through.
- **Lifecycle** — `pnpm run module:install <id>`, `module:enable`, `module:disable`,
  `module:uninstall` and `module:status` treat an overlay module like any other. `pnpm run
  migrate` applies its migrations, `module:status <id>` lists them, switching it off or a soft
  uninstall keeps its tables and rows, and `module:uninstall --hard` reverts them.

[Create your first Module](../create-your-first-module.md) walks through all of it.

## What you may override

Every row names a seam. None names a file path, because there is no seam that
takes one.

| Want | Seam |
|------|------|
| Change what a core service does | `ctx.di.decorate('<name>', (inner) => …)` from the deployment's own overlay module — see *Service overrides are decorations* below |
| Add a capability | a client-only overlay module under `backend/src/apps/<deployment>/modules/<id>/`, shipping `backend.ts` and `manifest.ts` |
| Run before or after another module's endpoint; veto it; rewrite its response | `ctx.interceptors` |
| Take part in a write the owner declared hookable — add your own row, or refuse it | a command hook, `ctx.commandHooks` |
| Refuse, or measure, every Command whose action matches a filter | command middleware, `ctx.commandMiddleware` — `admit` or `observe`; see *Moving a bus wrap to command middleware* below |
| Vary a behaviour the owner anticipated | a strategy port the owner publishes, registered behind `ctx.di.providePort` and read through `lazyPort` |
| Change configuration | a manifest-declared Setting, and `divergence.ts` to omit a module |
| Add client-specific tables | the overlay module's own: a side table it owns, or declared extension columns on an extensible core table — see *An overlay module owns its schema* below |
| Share a service between two of the deployment's modules | a port the owner registers with `ctx.di.providePort`, its types in the owner's `ports.ts` |
| **Replace a route handler wholesale** | **No seam. Not offered.** See *The one thing there is no seam for* below |

## An overlay module owns its schema {#an-overlay-module-owns-its-schema}

A per-deployment overlay module may own entities and migrations, from release
0.113.0, both in an instance and in a platform repository's own `apps/` tree. It
contributes them the way an installed package does, and the same rules hold it:

- **Entities** — `backend.ts` exports `entities`, an array of the module's entity
  classes, and every entity class under its `entities/` must be in it. Each
  entity takes exactly one tenancy decorator (`@OrgScoped`, `@CustomerScoped`,
  `@TransitivelyScoped`, `@RuleScoped` or `@GlobalEntity`) and its MikroORM
  decorators from `@mikro-orm/decorators/legacy`. A process with an unclassified
  entity does not start.
- **Migrations** — the module's `migrations/` directory, read file by file: there
  is no index file and no registry. Each file is named
  `<YYYYMMDDTHHmmss>_<module>_<slug>.ts` and exports one class whose name derives
  from the filename. Its chain is ordered by the module's manifest
  `dependencies`, so a migration referencing a core table runs after the one that
  created it.
- **The foreign-schema guard, with no exemption** — an overlay migration may write
  only the tables its own entities map, exactly like an installed package's. Being
  the deployment's own buys nothing here.
- **Extension columns** — an overlay module may declare `schemaExtensions` on an
  extensible core table, as an installed package does; see
  [Declared extension columns](./schema-extensions.md).
- **Promotion keeps the id** — a module later moved from the overlay into a
  package keeps its module id, so the migrations a database has already recorded
  still match.

`apps/example/modules/example_erp_keys/` in the platform repository is the
reference overlay module, and the one to copy: a side table on `organizations`
with its migration, a command hook filling it, a port in `ports.ts`, and an admin
screen with its palette action.

**The reason this used to be refused is retired.** An overlay module once
contributed no schema, on the reasoning that it lives in the same repository and
the same build as core, so a table can always be shipped from a core module. That
does not hold in an instance, which depends on released packages and has no core
tree to put a table in. The other reason once given — that the migration order
is "only meaningful over a fixed set" — was measured and is false: adding a leaf
module's migrations leaves the relative order of every existing migration
exactly unchanged. Do not repeat either.

**What is never offered** is changing another module's schema: a core column,
constraint, index or entity class is not overridable from an overlay module or
from anywhere else. That is the
[data ladder](./customisation-ladder.md#the-data-ladder-where-new-data-lives).

## Overlay module layout {#overlay-module-layout}

```text
apps/<deployment>/
├── divergence.ts                 # the deployment's declaration (hand-written)
├── divergence.generated.{ts,md}  # derived report
└── modules/
    └── <id>/                     # one module; <id> = manifest id
```

A few names inside `<id>/` are read by something other than the module, so they
are fixed:

| Path | Read by | Required |
| --- | --- | --- |
| `manifest.ts` | the loader, which identifies the module by it | yes |
| `backend.ts` | the loader: `registerModule`, `entities`, `schemaExtensions` | no — a module may have no server half |
| `i18n/en.json`, `i18n/pl.json` | the manifest's `i18n.bundlesDir` | when the module has any label |
| `migrations/` | schema discovery, file by file | when the module owns schema |
| `admin/index.tsx` | the deployment's admin build | when the module has an admin screen |
| `ports.ts` | a sibling overlay module, with `import type` only | when the module publishes a port |

Everything else — `entities/`, `services/`, `hooks/`, `routes.ts` — is the
module's own naming. A `manifest.ts` below `<id>/` is refused as `nested-module`,
and a `package.json`, `tsconfig*.json` or `tsup`, `vite` or `vitest` configuration
inside it as `package-in-disguise`: one project compiles the whole deployment's
overlay code. When a module grows two concerns, make two sibling modules and
declare the dependency.

**Between two overlay modules only port types cross.** A module may import a
sibling's `ports.ts`, and nothing else of it, with `import type`, when both are
in the same deployment and its manifest `dependencies` name the sibling; it then
resolves the port with `lazyPort`. Every other import between two overlay modules
is refused, naming each failed condition.

**The admin layer is per deployment.** `admin/index.tsx` exports the same
`contributions` a package's `./admin` layer does, and lands in the admin build of
its own deployment only. Palette coverage and the permission inventory judge it
for that deployment.

## Service overrides are decorations

A client override of a service **wraps** the core implementation and delegates to
it. It does not shadow a file and it does not subclass core.

That is a correctness property, not a style preference. Replacing a service means
the deployment stops receiving core fixes to the overridden methods the day the
override is written — whatever core does to that method next lands in a class the
deployment no longer instantiates, and nobody finds out until the behaviour
diverges in production. A wrapper keeps core in the call path, so a core fix
arrives *and* the client behaviour survives it.

A decoration is written from the deployment's **own overlay module**, in its
`registerModule`, and there is no other way to write one:

```ts
// backend/src/apps/acme/modules/acme_pricing/backend.ts
export function registerModule(ctx: ModuleContext): void {
  ctx.di.decorate<DecoratedPricing>('pricingService', (inner) => wrap(inner));
}
```

It names the **registration**, not a file, so core moving a file breaks nothing
and a deployment can override a second service without a core edit of any kind.

Where two modules decorate the same registration, the wrapping order must be
declared — composition fails rather than picking by package load order — and
every applied decoration appears in the composer's override report.

### There used to be a second mechanism, and it is retired

Until 2026-08 a deployment could also drop a file under
`backend/src/apps/<deployment>/decorations/`, named after the registration it
wrapped and exporting `decorate(inner)`. If you are reading a client tree that
still has one, or a document that still describes one, this is why it is gone
and why you should not reinvent it.

It existed because the overlay layer predated the change that made an overlay
module an ordinary composed participant. An overlay module was then a `plugin.ts`
over a frozen seven-field context: it could not reach the container, so it could
not decorate anything, and a deployment that wanted to wrap a service had nowhere
else to go. That change gave an overlay module a full `ModuleContext` —
`ctx.di.decorate` included — which left the file seam with no capability of its
own.

It was also, as shipped, a documented capability that silently did nothing for
every registration but one. The loader read *every* file in that directory and
keyed a map by the registration name derived from each filename; the single
consumer looked up one hard-coded key and threw the rest of the map away. A
deployment adding `decorations/command-bus.ts` got no wrap, no warning and no
error. Extending it meant a core edit per registration — exactly the coupling the
overlay pattern exists to remove.

**One thing was genuinely given up.** The file imported the owner's
`*.interface.ts`, so `tsc` held the wrapper to that interface and refused it the
moment the interface changed — the original contract gate. `ctx.di.decorate<T>`
asserts `T` at the call site and compares it to nothing, so the wrapped shape is
declared **structurally** and interface drift surfaces at runtime instead of at
build time. When a deployment wants the gate back, the way to get it is for the
owning module to publish its interface on its package's `./ports` subpath and
for the overlay to name it there: a type-only `./ports` reach is not a module
boundary reach, and a published type's shape changes cost a major version.

### Decorating across owners is the deployment's, and only the deployment's

`ctx.di.decorate` refuses a module that wraps a registration it did not
register. The reason is that decoration rewrites what *every* consumer of that
name resolves: a core module allowed to wrap `commandBus` observes every audited
write in the platform, one wrapping `auditLogService` changes what the audit
records, and one wrapping another module's read port sits between a consumer and
its owner with nothing declared anywhere. A module that needs different
behaviour from another module asks it for a seam — a port, a contribution point,
an event — which is a coupling the manifest declares and the checks can see.
A name a composition root registered is refused on the same rule: no module owns
it, so no module may wrap it.

An overlay module is the one exemption, because it is a different act. A
deployment wrapping core is the customisation seam this page describes; core
wrapping core is a coupling nothing declares. The exemption is not a claim a
module makes about itself — the generated composer marks an entry `overlay: true`
from the root the module was discovered under,
`backend/src/apps/<deployment>/modules/`, so core has no way to assert it and
`overlay:check` fails on a hand-edited artefact.

**The exemption stops at an installed extension package, and at the guard
seams.** An overlay may wrap anything core or another of the deployment's own
modules registers, and any name a composition root supplies (`redis`, `orm`,
`requireAdmin`, …) — except the four guard seams below. It may not wrap a
registration a package installed from `node_modules` owns —
`PackageDecorationNotOfferedError`, refused at composition, naming the overlay,
the package and the registration. The reason is that there is nothing to write
the wrap *against*: a package's `exports` map publishes `registerModule`, its
entities, its migrations and `./ports`, and the container names it registers
internally are published by none of them, so the name may change in a patch
release. The `*.interface.ts` gate the retired file seam carried did not transfer
either — for a package the compiler would be holding the deployment to a
`dist/*.d.ts` written by someone the deployment does not employ. The message says
*not offered yet* rather than *forbidden*, and names the exit: a package
declaring which of its registrations are decoratable, `./ports` being the natural
home, where changing the shape costs a major version bump. Until then, ask the
package's author for a port, an event, or use an interceptor around its routes.

**The four guard seams are not decoratable from 0.114.0.** `commandBus`,
`auditLogService`, `eventBus` and `emFactory` are the names through which tenant
isolation and write auditing are enforced. An overlay's decoration of one is
**deprecated in 0.113.0** — it still composes, logs `kernel.decoration.deprecated`
once and is a `deprecated-decoration` warning in the divergence report — and
**refused from 0.114.0**. Each has a replacement:

| Instead of decorating | Use |
| --- | --- |
| `commandBus` | command middleware: `admit` to refuse, `observe` to measure; a command hook for one declared action |
| `auditLogService` | an `observe` middleware for an extra sink, or a read of `audit_log_entries` for a durable one; the audit writer itself is not replaceable |
| `eventBus` | `ctx.subscribe` for a reaction; an `afterCommit` hook for durable delivery |
| `emFactory` | nothing — tenant scoping is not overridable; ask the owning module for a port |

Decorations are **applied after every module has registered**, not at the call.
Which array a module was composed from therefore has no bearing on what
it can wrap, and a decoration of a name nothing registers means exactly that
rather than "not yet". Order within the drain is call order, which is why one
module decorating a name twice is unambiguous and two modules decorating it are
not.

An older service override shadowed
`modules/<id>/services/<name>.ts` and replaced the core class. That is retired
too, and completely: a `services/` file under an overlay module is now just one
of that module's own files, because an overlay module owns everything it ships.

## There used to be file shadowing, and it is retired

Until 2026-09 this page described a second mechanism: an overlay file at the
same module-relative path as a core file *shadowed* it, with a taxonomy of
overridable kinds (`route`, `config`), two rejected ones (`schema`, `other`),
a conflict policy and three build-time refusals. If you are reading a client
tree, an older spec or a document that still describes one, this is why it is
gone and why you should not reinvent it.

**Nothing that ran was given up**, and that is measured rather than asserted.
`git log -S` over the whole history of `backend/src/overlay/` finds exactly one
loader for a shadowed file ever written — `loadOverlayServiceClasses`, for
`service` — and it was deleted deliberately, replacing it with
`ctx.di.decorate` for the reason the section above gives. `route` and `config`
never had a loader at all: the resolver's `overrides` output had exactly one
consumer in the history of the tree, the divergence report's generator (then the
override-manifest generator), which serialised it into an audit artefact. So a route override never changed what a
running platform served, on any deployment, in any tree state.

**And it had stopped even classifying.** The scan indexed core from
`backend/src/modules`, which has held no module since the packaging sweep
finished on 2026-08-28. With that index empty every overlay directory
short-circuited to "a brand-new module claiming this id" before a single file
was looked at, so all three refusals below were unreachable — including the one
whose whole job was to stop a deployment shipping a migration it would never
run. A dead fail-closed guard is worse than no guard: the author who trusts it
gets silence.

Retired with it: **Conflict** (two overlays targeting one core unit),
**Unknown target** (an overlay file whose core equivalent does not exist) and
**Schema override** (an overlay file under a core module's `entities/` or
`migrations/`). What that last refusal stood for is *not* retired: no overlay
changes another module's schema. An overlay module's own `entities/` and
`migrations/` are its own schema, held by the foreign-schema guard — see *An
overlay module owns its schema* above.

**Why it was not repaired instead.** Shadowing a file inside a published package
is not a coherent operation. The platform composes a module through
`@endora-commerce/mod-<id>/backend`, whose `exports` map points at `dist`, so
making one overlay file replace one of those would mean intercepting Node's
resolution for a single file of a single package — reintroducing that package's
*source* into a graph that already holds its build output. Two rules refuse the
shapes that would take: the one that is why a module package ships `dist` at
all, and `check:singleton-identity`, whose whole subject is that evaluating one
package twice duplicates its module-scope values **silently**. Doing it at the
specifier level instead — re-pointing the package at the deployment's copy —
avoids the double evaluation and replaces the whole module, which is forking a
module rather than overriding one, and is the thing the untouched-core rule
exists to prevent.

## The one thing there is no seam for

**There is no way to replace a route handler wholesale.** `ctx.interceptors`
runs after the route's own guards and after schema validation: a
pre-interceptor may veto by throwing a registered `HttpError` and may replace
the validated body, and a post-interceptor may replace the payload, but neither
can substitute the handler.

That is not a regression the retirement introduced — route shadowing never
replaced a handler either. It is stated here rather than implied, in the idiom
`PackageDecorationNotOfferedError` already uses: not offered, naming the exit.
The honest sequence for a deployment that needs one is to decorate the service
the handler calls, which is where the behaviour usually is, or to ask the owning
module for a port. If a real deployment turns up needing more, that is a feature
with a real requirement behind it, and it should not be justified by a mechanism
that never worked.

## Fail-closed guards

Every guard on this list can be provoked. The build fails — never resolves
silently — on:

- **Module id collision** — an overlay module claiming an id already held by
  core, a workspace module package, an installed package or another overlay
  module. The refusal names every claimant's file.
- **Layout** — a manifest nested below a module (`nested-module`), or a
  `package.json` or build configuration inside one (`package-in-disguise`),
  refused by the overlay build and by every process that resolves overlay
  modules, naming the file and the remedy.
- **A stale build** — compiled overlay code that does not match `apps/`: an edit
  that was not rebuilt (`stale`), a module never built (`unbuilt`), a compiled
  file whose source is gone (`orphan`). The API, the worker and every `module:*`
  command refuse to start on it.
- **An unclassified entity** — an overlay entity with no tenancy decorator, or
  more than one, stops every process that configures the ORM before it opens a
  connection. So does an entity class under `entities/` missing from the
  module's `entities` export, and a migration file whose name, class or module
  segment do not agree.
- **A foreign write** — an overlay migration touching a table its own entities
  do not map, refused at `migrate` by the foreign-schema guard.
- **An import across overlay modules** — anything but `import type` from a
  sibling's `ports.ts` that the importer's manifest depends on, reported by
  `check:module-boundary` here and by `pnpm run generate` in an instance.
- **Missing manifest** — an overlay module directory carrying no
  `manifest.js`/`manifest.ts`. The refusal names both candidates.
- **Unregisterable backend** — an overlay module whose `backend.js`/`backend.ts`
  exports no `registerModule`. (A directory with *no* backend entry point is
  skipped, deliberately: a deployment may ship a module with no server half.)
- **Ambiguous decoration** — two modules decorating one registration with no declared order.
- **Foreign decoration** — a core module decorating a registration it does not own.
- **Package decoration** — an overlay decorating a registration an installed
  extension package owns; not offered yet, and the refusal says so.
- **Guard-seam decoration** — an overlay decorating `commandBus`,
  `auditLogService`, `eventBus` or `emFactory`: a warning in 0.113.0, refused
  from 0.114.0.

## Guards still apply

A decoration wraps an *implementation*, never a guard seam: overlay code runs
under the same tenant isolation, sales-channel scoping and Command-Bus auditing
as core, and cross-cutting behaviour on Commands is contributed as declared
command middleware. Overlay modules are ordinary lifecycle participants and must
register their permissions and pass the permission-inventory check per
deployment.

What an overlay module may contribute across owners follows from **where the
platform found it**, never from anything it declares: it is of origin
`deployment` because the loader discovered it under `apps/<deployment>/modules/`,
whether or not it owns a table. That origin may contribute an `admit` command
middleware, which an installed extension package (origin `package`) may not.

## Moving a bus wrap to command middleware {#moving-a-bus-wrap-to-command-middleware}

A deployment that measured or rate-limited writes by wrapping `commandBus` moves
the wrap to command middleware before 0.114.0. Before — one decoration doing
both:

```ts
// apps/acme/modules/acme_write_limits/backend.ts — deprecated in 0.113.0, refused from 0.114.0
ctx.di.decorate<Bus>('commandBus', (inner) => ({
  ...inner,
  async run(command) {
    if (overLimit(command)) throw new HttpError(429, 'RATE_LIMITED', 'Too many writes');
    const started = performance.now();
    try { return await inner.run(command); }
    finally { metrics.observe(command.action, performance.now() - started); }
  },
}));
```

It saw only the Command handed to `run`, never the child Commands that one runs;
it kept running while its module was switched off; and nothing downstream could
tell its refusal from a failed write. After — the same behaviour as two declared middleware, with the
decoration deleted. The manifest declares both, with their filters:

```ts
// apps/acme/modules/acme_write_limits/manifest.ts
export const acmeWriteLimitsErrorCodes = defineModuleErrorCodes(['ACME_WRITE_LIMITS_RATE_LIMITED']);

export const manifest = defineModuleManifest({
  id: 'acme_write_limits',
  // …
  errorCodes: [{ code: 'ACME_WRITE_LIMITS_RATE_LIMITED' }],
  commandMiddleware: [
    { id: 'quote-rate-limit', phase: 'admit', actions: ['quote_request.create'] },
    { id: 'write-metrics', phase: 'observe', actions: '*' },
  ],
});
```

and `backend.ts` registers the code under the same ids and phases:

```ts
// apps/acme/modules/acme_write_limits/backend.ts
import { CommandRefusedError } from '@endora-commerce/platform/commands';
import type { ModuleContext } from '@endora-commerce/platform/kernel';
import { acmeWriteLimitsErrorCodes } from './manifest.js';

export function registerModule(ctx: ModuleContext): void {
  ctx.commandMiddleware([
    {
      id: 'quote-rate-limit',
      phase: 'admit',
      admit: (meta) => {
        if (meta.organizationId !== null && overLimit(meta.organizationId)) {
          throw new CommandRefusedError(acmeWriteLimitsErrorCodes.ACME_WRITE_LIMITS_RATE_LIMITED, {
            status: 429,
            retryAfterSeconds: 60,
          });
        }
      },
    },
    {
      id: 'write-metrics',
      phase: 'observe',
      observe: (outcome) => {
        metrics.observe(outcome.root.action, outcome.committed, outcome.durationMs);
      },
    },
  ]);
}
```

- **`admit`** runs before the Command does anything — before the transaction
  opens — and for a matching child Command too. It receives metadata only (the
  action, the object, the actor, the organisation, the request id, the lineage)
  and may only pass or throw `CommandRefusedError` with a code the module
  declares. A refused Command writes nothing and records no audit entry; the
  caller receives the code and the status. It has a time budget (100 ms by
  default, at most 500 ms), and one that does not answer in time fails closed.
- **`observe`** runs after the run has committed or rolled back, never awaited by
  the writer. It receives the outcome — committed or not, the refusal or error
  code, the duration, and every Command the run attempted — as ids, codes and
  booleans, and cannot change anything. A throw in it is logged and swallowed.
- Both are skipped while their module is switched off, and both appear in the
  divergence report as `command-middleware`. Two of the deployment's modules with
  overlapping `admit` filters and no dependency between them are ordered in
  `divergence.ts` (`commandMiddlewareOrder`), or composition refuses.

`apps/example/modules/example_overlay/backend.ts` in the platform repository
registers an `observe` middleware of this shape:

<!-- verbatim-from: backend/src/apps/example/modules/example_overlay/backend.ts -->
```ts
ctx.commandMiddleware([
  {
    id: 'organization-timing',
    phase: 'observe',
    observe: (outcome, { log }) => {
      log.info(
        {
          root: outcome.root.action,
          committed: outcome.committed,
          errorCode: outcome.errorCode,
          commands: outcome.commands.length,
          durationMs: Math.round(outcome.durationMs * 10) / 10,
        },
        'example_overlay.organization-timing',
      );
    },
  },
]);
```

:::note Operator commands run no middleware
A Command Bus an operator command builds for itself, outside the application —
today the schema-extension lifecycle commands — runs **no command middleware and
no command hooks**. Its Commands are still audited. `admit` is a business policy
gate for the application's paths; do not rely on it to stop a maintenance
command run by someone with shell and database access.
:::

## Adding an overlay

```bash
# 1. Add the deployment's overlay module (it ships backend.ts, never plugin.ts):
#    backend/src/apps/acme/modules/acme_loyalty/{manifest,backend}.ts
#    — with entities/ and migrations/ if it owns a table

# 2. Override a core service from its registerModule, by registration name:
#    ctx.di.decorate('pricingService', (inner) => wrap(inner))

# 3. Say why, in the deployment's own declaration:
#    backend/src/apps/acme/divergence.ts, `reasons`, keyed by the derived entry's
#    own key — `decoration:acme_loyalty:pricingService`

# 4. Render the deployment's divergence report and commit both renderings:
DEPLOYMENT=acme pnpm --filter backend run overlay:divergence

# 5. Check that every divergence is derived, owned and explained, and that the
#    committed artefacts are what this tree produces:
pnpm --filter backend run check:divergence
pnpm --filter backend run overlay:check
```

**Which seam to reach for, and what each costs**, is the
[customisation ladder](./customisation-ladder.md). Read it before writing any of
the above: rung 3 is not available to a deployment wanting to substitute an
implementation, and that page says so rather than sending you to a mechanism that
will refuse you.
