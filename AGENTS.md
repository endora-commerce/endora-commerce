# Endora Commerce (b2b-platform) — Agent Instructions

Last updated: 2026-08-20

**This file is the single source of truth for every AI coding agent working in this
repository.** `CLAUDE.md` and `.cursor/rules/specify-rules.mdc` are thin pointers to it —
put shared knowledge here, never in a pointer. Cursor, Codex, Amp and other AGENTS.md-aware
tools read this file directly; Claude Code reaches it through the `@AGENTS.md` import in
`CLAUDE.md`.

## Stack

- **`backend/`** — TypeScript 5.x strict on Node.js ≥ 22.17. Fastify, MikroORM (PostgreSQL),
  Zod, ioredis, BullMQ, Meilisearch, `nodemailer`, `pdfmake`. Cross-cutting infrastructure:
  module lifecycle (`src/lifecycle/`, host-owned since D-160.11; i18n is now the package
  `@endora-commerce/mod-i18n`). The kernel, the
  HTTP layer, the in-process `EventBus`, the Command Bus and TenantContext are **not** in
  `backend/src` — they are `@endora-commerce/platform` (see `packages/` below), and `backend/src`
  reaches them through re-export shims at their old paths while feature 080's T040b drains them.
- **`admin/`** — React 19 + Vite + react-router-dom 7 + `@endora-commerce/api-client` +
  `lucide-react` + Tailwind 4 + Radix/shadcn primitives; `@measured/puck` for the CMS/e-mail
  builders;
  `@dnd-kit` for drag-drop; charts through the `<EChart>` wrapper
  (`admin/src/components/charts/echart.tsx`).
- **`storefront/`** — Next.js 15 App Router + React 19 + Tailwind v4, Server Components and
  server actions.
- **`packages/`** — `contracts` (Zod schemas: the source of truth for every API shape),
  `api-client`, `page-builder-core`, `cms-components`, `email-components`, and
  **`platform`** — the host package (feature 080), which owns
  `src/{kernel,http,tenancy,commands,events}` and publishes them as five enumerated subpaths.
  **`packages/modules/<id>/`** is the module tree F4 is draining `backend/src/modules/` into
  (T040b), and the workspace glob that reaches it is `packages/modules/*`. **How many are there
  is not written here** — `ls packages/modules` answers it and this sentence went stale twice
  while naming one (D-100). What is worth knowing is that the count is not the whole population:
  `backend/src/modules` holds the rest, all of them carrying a `manifest.ts`, and the generated
  manifest index registers **both** roots.
  Every one of them builds a
  real `dist` and resolves there through its own `exports` map (feature 080, T042/D-164), so
  **`pnpm run build:packages` is a precondition for running anything** — tests, `dev`, both
  frontend builds. Its filter is `./packages/**`, not `./packages/*`: the single star does not
  cross a directory separator, so a module package would silently not be built and every
  specifier naming it would be unresolvable. `tsc` is the exception and stays on source through `tsconfig.base.json`'s
  `paths`; see *Building the packages* under *Commands*.

**A published `@endora-commerce/*` package compiles under `moduleResolution: NodeNext` *and*
under `Bundler`** (D-162). This repository is on `Bundler`, which is the lenient of the two;
`tsc --init` on TypeScript 5.9 writes `"module": "nodenext"`, so a third-party author's
default toolchain is the strict one. The whole difference is **one package**: `ioredis` is
imported **by name** — `import { Redis } from 'ioredis'`, never `import Redis from 'ioredis'`
— because `built/index.js` reassigns `module.exports` to the class while `built/index.d.ts`
writes `export { default }`, so NodeNext models the default binding as the module namespace:
`TS2709` as a type, `TS2351` as a constructor. The named export is the identical class at
runtime (`default === Redis`). It is a rule about *this* package and not a prohibition on
default imports — the other eight default-imported bare specifiers in the tree (`stripe`,
`exceljs`, `sharp`, `nodemailer`, …) are clean under both modes, measured. Two ratchets, and
neither is a `check-*` script, deliberately: a `no-restricted-imports` entry in
`eslint.config.js` refuses both bad spellings, and
`test/unit/packages/package-dist-build.test.ts` compiles every package's **emitted `dist`** in
a NodeNext consumer with `skipLibCheck: false` — the only thing that can see the error once it
is inside a published `.d.ts`, where the author who hits it cannot fix it.

**A new runtime dependency needs written justification** in the feature plan's Complexity
Tracking section (Constitution IV). The default answer is "no new dependency" — reuse what
is already in the stack.

## Repo map

| Path | Contents |
| --- | --- |
| `packages/modules/<id>/src/` | A domain module, and **this is where every one of them lives** since T040b closed on 2026-08-28: `manifest.ts`, `backend/` (composition in `index.ts`, plus `entities/`, `services/`, `routes.ts`, optional `plugin.ts`, `actions/`, `workers/`), `migrations/`, optional `ports/`, `i18n/`, `test/`. `backend/src/modules/` holds nothing but a `README.md` — a specifier pointing into it resolves to nothing, which is why an old branch cannot be merged without being packaged (measured on !1103: no intermediate state of it compiles) |
| `backend/src/apps/<deployment>/modules/<id>/` | Per-deployment overlay modules (feature 057) |
| `backend/test/{unit,contract,integration,perf}/` | Backend tests, mirroring module names |
| `specs/NNN-slug/` | Feature artifacts: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `tasks.md` |
| `.specify/memory/constitution.md` | Binding principles — read before designing anything |
| `docs/` | Docusaurus site (end-user and engineer documentation, English only) |

## Commands

```bash
pnpm run build:packages                  # FIRST, after any install: every package
                                         # under packages/ resolves at ./dist
pnpm -r run typecheck                    # or: pnpm --filter <app> run typecheck
pnpm -r run lint
pnpm --filter backend run test:unit:fast # FAST: test/unit minus its 16 service-dependent
                                         # files, plus the co-located src unit tests —
                                         # no Postgres, no Redis, no Meilisearch
pnpm --filter backend exec vitest run <path>   # targeted run — prefer this while iterating
pnpm --filter backend run test           # COMPLETE (~1 h): unit + contract + integration,
                                         # needs all three services running
pnpm run dev                             # full dev stack; pnpm run dev:infra for docker services
pnpm --filter backend run db:fresh       # rebuild the schema from migrations
pnpm run check:naming && pnpm run check:language
```

**Building the packages** (feature 080, T042). Every package under `packages/` ships a
compiled `dist` and its `exports` map points at it, with a `types` condition on every
subpath. A **module** package does so for a second reason of its own (D-164): `tsx` applies one
tsconfig per process, so a decorated file outside it is lowered with standard decorator
semantics while MikroORM's are legacy, and a source-shipping module's entities die at load. So `pnpm run build:packages` is not an optional step — until it has run in a fresh
checkout, every `@endora-commerce/*` specifier is unresolvable at **runtime**, which is
`vitest`, `tsx`, `vite` and `next` alike. Every CI job that executes repository code runs it
after the install;
`release:changeset` is the one that does not, because it imports nothing of ours. **`tsc` is
the exception and deliberately so**: `tsconfig.base.json`'s `paths` keeps it on the packages'
*source*, which is what makes a type error land on the line that caused it and what keeps the
#255 worktree guard working. The consequence is a real one and worth stating: a stale `dist`
means the type-check and the test run are reading different files. Rebuild after touching a
package.

**That now includes the platform**, which is the case most likely to catch someone out:
`kernel`, `http`, `tenancy`, `commands` and `events` are `@endora-commerce/platform`'s sources,
so editing one and re-running a test without
`pnpm --filter @endora-commerce/platform run build` runs the previous build. `@endora-commerce/platform`
is also the one package `tsc` does **not** read at source — it has no `paths` entry, deliberately;
see the worktree note below. And `pnpm run dev` does not watch those files either: since feature
080's T047a it is one esbuild context over `backend/src` plus a restart driven by that build
(`backend/scripts/dev.mjs`), and the platform is not under `backend/`. That last sentence used
to name `tsx watch src/index.ts`; the loop changed and the consequence did not, but the loop
also **stopped** picking up the five packages that have a `paths` entry, which `tsx` did read at
source. So the rule is now uniform and worth stating once: **edit a package, build that package,
restart the loop** — for `@endora-commerce/contracts` exactly as for the platform. Measured, that
is 5.4 s of `tsc` and a 5.9 s boot, against the 24.9 s restart `tsx watch` took to do it
automatically for `contracts` alone while running its *source* against a `dist` everything else
in the repository reads.

**And the application itself compiles** (feature 080, D-165). Production runs
`node dist/index.js`, not `tsx src/index.ts`: the image builds
`pnpm --filter backend run build` and `deploy/compose.prod.yml` migrates with
`node dist/db/migrate.js up`. That build is `tsc` **plus** `copy-runtime-assets`, and the second
half is not a convenience — `tsc` compiles `.ts` and copies nothing else, so a tree without it
holds every module's code and none of its data, which is a *silent* defect and not a crash:
`loadModuleBundles` reads an absent bundles directory as "this module ships no translatable
strings". Measured on one machine, three runs each: boot to first request 11.9 s -> 5.3 s,
resident 838–851 MB over five processes -> 480–486 MB in one. **Nothing in a source-tree check
can see whether any of this is true**, which is why the `boot-gate` job exists and why it is the
condition of the ruling rather than a follow-up — see its row in the inventory below.

Two things about the build shape that look like detail and are not. Each package has **two**
tsconfigs — `tsconfig.json` type-checks with `paths` active and cannot emit (`noEmit: true`),
`tsconfig.build.json` clears `paths`, sets `rootDir` and emits. Do not merge them: `rootDir`
with an active `paths` block is TS6059, which exits 2 **and emits the sibling package's
output beside that sibling's source** — 432 untracked files in `packages/contracts/src` and
`packages/page-builder-core/src`, in the measurement that produced this rule. And every build
sets **`noEmitOnError: true`**, because `dist/` is git-ignored: a compile that failed would
otherwise ship its artefacts and leave nothing for anybody to notice.

**Deleting a file? Grep `backend/test/**` for it before you finish, and do not trust
`test:unit:fast` to tell you.** That command is the one everybody runs locally and it skips the
contract and integration trees entirely — where a test that *spawns* a deleted script, or imports a
deleted module's path, fails with `ERR_MODULE_NOT_FOUND` rather than with anything a type-check or a
`check-*` script can see. Measured three times on 2026-08-24: a contract test red across **29
merges**, an integration test red across **50** while reporting a live product defect nobody read,
and a suite deleted with the two scripts it existed to exercise. All three were invisible to the
fast suite by construction, and CI's own red did not stop a single merge because
`only_allow_merge_if_pipeline_succeeds` is off.

**The same blind spot has a second shape, and it has now produced three reds on `master` in a
row: a ledger derived *about* the files you changed is not a file you changed.**
`test/integration/kernel/module-removal.test.ts` holds a two-way residue ledger, so packaging a
module reds it the moment that module's last reference under `backend/src` goes. A packaging batch
runs its targeted tests over the paths it *touched* — and this file is never one of them, because
moving a module does not edit it. **The batch that frees an entry is structurally the batch that
cannot see it go stale.** Ten entries drained on 2026-08-25 across batches two and three, each red
found by the next piece of work rather than by the one that caused it. So: after a change that moves
or deletes anything, ask what is **derived** from its location, not only what **names** it — and
re-derive that in the same merge request.

**Which backend test command to use.** `test:unit:fast` (config: `backend/vitest.unit.config.ts`)
is the one to run while you iterate and the one CI runs on every backend MR as `test:backend:unit`,
with no service containers. **The suite's size is not written down here**, and that is the second
correction to this paragraph rather than the first: it read *"324 files in 96 s, against 316 files
in 252 s"* while the tree ran **431 files and 5371 tests** — a number that grows with every merge
request and was stale by a third. `pnpm --filter backend run test:unit:fast` prints it, and the
printed figure is the only one that is ever current. It skips the 16 unit files that genuinely talk to a live Postgres or Redis —
each named with a reason in `backend/test/service-dependent-unit-tests.ts`, each still run by the
complete suite, and `test/unit/harness/service-dependent-ledger.test.ts` fails if that list drifts
in either direction. Choosing that config **is** the run's declaration that it has no services
(`BACKEND_TEST_SERVICES=none`); the declaration is never inferred from a connection that failed,
and a test that needs a service stops the run with a sentence naming the ledger. The remaining
`test:unit` / `test:contract` / `test:integration` scripts, and `test` itself, are the complete
side and need the services; `test:backend` in CI shards them five ways and takes hours rather
than the better part of one, because since issue #199 the five shards also **serialise**
(`resource_group: backend-suite`). That is not a performance oversight: the runner host is
shared — two GitLab registrations are two job slots on one 4 vCPU / 7.9 GB machine, and that
machine also carries another project's Magento test server — so two shards at once make the
**host's** OOM killer take whichever fork is largest, and a silent `Worker exited unexpectedly`
leaves two hundred files unrun. One whole job costs **2.5 GB** of anonymous memory (2396 MB of
job container plus 202 MB of postgres, redis and meilisearch), flat from its fortieth file to
its last, so the serialisation is a fact about *this* host and should be reconsidered — from the
runner's own `concurrent` setting, not from here — once the suite has a machine to itself. The
numbers and the rejected alternatives, a lower `--max-old-space-size` among them, are in the
Memory block above the job in `.gitlab-ci.yml`. A run that dies that way now says so in the
kernel's own words: `test/oom-evidence.ts` reads the container's cgroup `memory.events` and
`test/run-completeness.ts` prints the verdict beside the files that never ran.

**Two runs at once no longer corrupt each other** (issue #189). Isolation used to be per
database and per Redis instance, never per invocation: `setupBackendServer` truncates
`SEEDED_TABLES` and reseeds on every booting file, so a second `vitest run` landed its truncate
inside the first one's setup — a `beforeAll` timeout, a teardown dereferencing a handle that was
never built, a just-created row reading back `null`. Every one of those is indistinguishable
from a real failure, which is the actual cost. `test/global-setup.ts` now gives each invocation
its **own** database — `<base>_r_<stamp>_<rand>`, a `create database … template` clone of the
migrated `<base>_tpl`, ~1 s — and its **own** Redis logical database, leased in index 0. Both
are released when the run ends and swept if it crashed. Nothing to remember and nothing to
pass: `TEST_DATABASE_URL` still names the base, and the run's actual DSN is in `DATABASE_URL`
— read that one if you spawn a CLI from a test. `BACKEND_TEST_ISOLATION=shared` restores the
old behaviour for a post-mortem, `BACKEND_TEST_KEEP_DATABASE=1` keeps the run's database, and
`test:unit:fast` is untouched because it declares `BACKEND_TEST_SERVICES=none` and provisions
nothing. See `backend/test/README.md` § *One database per invocation*.

**Standing a `git worktree` up: one command, and never a symlinked
`node_modules`** (issue #255).

```bash
git worktree add ../wt-<slug> -b <branch> master
bash ../wt-<slug>/scripts/setup-worktree.sh          # pnpm install --frozen-lockfile
bash ../wt-<slug>/scripts/setup-worktree.sh --link   # only off the store's filesystem
```

Every package under `packages/` resolves through its own `exports` map at `./dist`,
built from the checkout it lives in — and which checkout that is comes down to one relative
symlink, `backend/node_modules/@endora-commerce/contracts -> ../../../packages/contracts`.
Point a workspace's `node_modules` at another checkout and every one of those links re-roots
there. Measured on this repository, in a worktree whose `packages/contracts` carried a
symbol `master` does not have: `vitest` imported the **main tree's** file and the branch's
own contract test failed against `master`'s source, while `tsc` — protected by the `paths`
block — compiled the worktree's. One run type-checking one branch and executing another is
worse than either being wrong, and `pnpm ls @endora-commerce/contracts` reported this
worktree's path throughout, because it answers from the manifest's `link:` declaration and
never looks at
the symlink. **Do not use it to check this.**

The default is the boring one and it is not slow: `pnpm install --frozen-lockfile` in a
fresh worktree took **4 s** for 2055 packages and cost essentially no disk — every file
under `node_modules/.pnpm` is a hard link into the pnpm store, same inode as the main
tree's. `--link` exists for the worktree that is on a *different* filesystem from the store
(a tmpfs scratchpad, a container mount), where pnpm cannot hard-link and an install
materialises 1.3 GB: it symlinks the **root** `node_modules` — third-party packages only,
identical on every branch — and `cp -a`s each workspace's own, so the relative `@endora-commerce/*`
links inside them re-root here. 0.2 s, and it refuses when `pnpm-lock.yaml` differs from
the checkout it would borrow from.

Getting it wrong no longer produces a wrong measurement: `vitest.config.base.ts` — the one
file every workspace's vitest config merges — refuses the run, naming each foreign link and
its target. **Which runs it covers is derived, not listed.** The guard classifies every
declared consumer→package link in the checkout, whichever workspace invoked it — the count
is in the line it prints — but it is evaluated only where `vitest.config.base.ts` is
**imported**, so coverage is exactly the workspaces whose vitest configuration merges it, and
a run declares its own membership by printing
`[workspace-resolution] read: links=… sources=workspace-packages:…`. A test run that prints
no such line is outside the guard, whatever its colour. This sentence read *“it covers
`backend`, `admin` and `storefront` in one place”* until 2026-08-28: true when written, still
true the day it was replaced, and exactly why nobody learned that five packages under
`packages/` ran on vitest's defaults with no configuration at all. So the derivation is
enforced rather than restated — `backend/test/unit/harness/workspace-resolution.test.ts`
fails a workspace member that invokes vitest with no configuration, and a configuration that
does not import the base. `tsc` is covered
instead by `paths` in `tsconfig.base.json` being complete, which
`backend/test/unit/harness/workspace-resolution.test.ts` keeps true for every package the
workspace globs produce — **however deep** they nest it (feature 080, T040a) — with the
packages the running platform **composes** refused an entry rather than required one. Those
packages keep their sources in their own directories like the other five, so the derivation
alone would demand a `paths` entry; they must not have one, because `paths` is honoured by
`tsc` and `tsx` and not by `vitest` or `node`, so an entry would make the application resolve
their *source* under `tsx` and their *`dist`* everywhere else. For schemas and React components
that split costs nothing; for `HttpError`, `SalesChannel` and `effectiveState` it is the
duplication the platform relocation removed, and
`test/unit/kernel/platform-single-copy.test.ts` is what measures it. For a **module** package
it is worse than a duplication: `paths` would point every `tsx` entry point at eleven decorated
entity files that D-164 measured dying on load, which is the reason that package ships `dist`
at all. Which members those are comes off their own `endora` block — `type: 'platform'` for the
host, `type: 'module'` for a module package — so the exception is derived rather than listed,
and the 66th module package changes the answer by existing. Both halves of
that population used to be written down: `readdir('packages')`, one level, filtered by the
literal scope `'@b2b/'` — the one the packages carried before T042e renamed them. Neither
survives 66 module packages a directory deeper under a second scope, and a package this guard
cannot see is a package with no protection at all — which is the one way a #255 repair can
regress in silence. `ALLOW_FOREIGN_WORKSPACE_PACKAGES=1` is the override for deliberately
measuring another checkout. What neither covers is `eslint` and the `check-*` scripts —
stated here rather than discovered later. See `scripts/workspace-resolution.ts`.

## Binding principles

Full text in `.specify/memory/constitution.md` — this is the working summary, not a
replacement. Non-negotiable ones are marked **(NN)**.

- **I. Modular architecture (NN)** — a module owns its entities, services, routes,
  migrations, i18n and tests. Cross-module interaction goes through exported services or the
  `EventBus`; never import another module's internals. Design every module so it can be
  detached.
- **II. API-first** — define the shape as a Zod schema in `packages/contracts/` first;
  breaking changes are versioned.
- **III. TDD (NN)** — failing test first, then implementation. Every functional requirement
  traces to a test.
- **IV. YAGNI & minimal dependencies** — see the Stack note above.
- **V. TypeScript everywhere** / **VI. Naming conventions (NN)** / **VIII. English-only
  working language (NN)**.
- **VII. SEO, performance & discoverability** — storefront pages stay SSR/SSG-capable.
- **IX. UI reuse** — reuse the admin design system and existing primitives before adding new
  ones.
- **X. Scalable queue consumers** — long-running or repeatable work follows the existing
  BullMQ worker pattern (e.g. `quote_requests/rfq-expiry-worker.ts`).
- **XI. Multi-tenant isolation (NN)** — the Organization is the one tenant concept; every
  transacting customer has one (B2C gets a personal org). Tenant-scoped entities pass through
  the global-filter guard in the platform's `tenancy/` (`@endora-commerce/platform/tenancy`).
  A design with a "no-organization" path
  is invalid.
- **XII. Sales-channel content scoping (NN)** — channel-scoped reads go through the resolved
  request channel and the sanctioned bridge accessors, not hand-rolled queries.
- **XIII. Uniform write auditing via Command Bus (NN)** — admin/domain writes run through
  `CommandBus.run` so auditing and undo stay uniform.
- **XIV. Entity-agnostic extensibility** — runtime custom fields instead of bespoke columns
  where the requirement is "add a field".
- **XV. Untouched core & per-deployment overlay** — see "Overlay modules" below.
- **XVI. Module discoverability in the command palette** — see the checklist below.
- **XVII. Operator-toggleable modules (NN)** — presence is the conjunction of **two
  orthogonal axes**: platform availability (lifecycle registry, deployment-owned, CLI) and
  operator activation (a manifest-declared Setting, flipped on the kernel-served
  `/platform/modules` screen — a surface no module owns — business-owned, Admin UI). Neither
  overwrites the other. A module that is off behaves as if never
  installed — business logic, API, Admin UI and Storefront — its own activation control
  being the one exception. Off is non-destructive and reversible; non-deactivatable modules
  declare that in their manifest; dependencies fail closed. See the checklist below.

## Required checklists for a new backend module

### Composition — `backend.ts` (feature 072)

**A module is composed by the kernel container, not by a composition root.** Every core
module exports `registerModule(ctx: ModuleContext): void` from `packages/modules/<id>/src/backend/index.ts`;
`backend/src/composition.ts` and `backend/test/test-server.ts` compose that list and pass
deployment inputs, nothing more. Never construct a module's services in either root, and
never add a "module options" object for something the module can read itself.

1. **Own services** — `ctx.di.register({ name: ctx.asFunction(…).singleton() })`. The key is
   claimed: a second writer gets `DuplicateRegistrationError`.
2. **Ports you own** — `ctx.di.providePort('<name>', …)` for anything another module resolves.
   It wraps the registration in a transient gate on the module's effective state, so a caller
   gets the 503 `MODULE_DISABLED` envelope instead of a half-executed operation (Principle XVII).
3. **Reading someone else's port** — `lazyPort<T>(ctx, 'literalPortName')`. **Never resolve a
   port into a singleton**: Awilix strict mode refuses the capture, and it is right to — a
   captured gate keeps answering after its owner is switched off. The name must be a **string
   literal**, or `check-port-dependencies.ts` cannot see the edge (a `port(ctx, name)` helper
   once hid fourteen resolutions, several registered by nobody, while the check read clean).
   **`T` is a contract type from `packages/contracts/`, never the provider's class** — and not
   a `Pick<>` / `ReturnType<>` / `InstanceType<>` over it either, since each of those imports
   the class. A module may not name a file in another module's directory in any specifier
   shape, `import type` included; `check:module-boundary` is the ratchet, and the 674 edges
   standing when it landed are ledgered per consumer module under
   `backend/scripts/ledgers/cross-module-imports/` while feature 075 drains them.
4. **Declare the edge** — resolving a port owned by `X` puts `X` in your manifest
   `dependencies`. That is what makes the edge real to the lifecycle, the migration order and
   an operator switching `X` off. The port check fails the build without it.
4a. **Say what happens when `X` is off.** `check-port-dependencies.ts` also builds the
   **deactivation-consequence ledger** (feature 074): every cross-module edge into a
   switchable module answers one of four ways — it fails closed at the seam, it degrades as
   your `nonBindingDependencies` entry declares, it is a boot-time contribution the host
   filters, or it is schema-only. An edge that answers none fails the build, and the three
   shapes that do are all fail-*open*: a captured cross-module registration, a read of an
   ungated registry whose owner states no absent-owner policy, and a gated port resolved
   before the first request. **The first of the four has a manifest spelling too**, since the
   owner ruling of 2026-08-25: `nonBindingDependencies` kind **`refuses-without`**, whose
   `whenAbsent` is the sentence the operator reads instead of a translated default. Reach for
   it when the honest answer is "this operation stops" and putting `X` in `dependencies` would
   make `X`'s activation control a dead switch — which it does whenever the *dependent* is
   `nonDeactivatable`. It is held to three things nobody has to remember: the name is a
   `di.providePort` registration, the manifest does not also bind `X` (one edge, one claim, in
   one place — `defineModuleManifest` refuses the pair), and the entry carries a sentence.
   The classification is not CI bookkeeping: the same artefact is what
   the operator's confirmation dialog **will** render, which is feature 074's deliverable
   (issue #121, in flight). Today's dialog is a bare `window.confirm` naming the module and
   nothing else (`admin/src/modules/platform/ModuleActivationControl.tsx`), so classifying an
   edge is currently answering the question that dialog cannot yet ask — write the entry for
   the operator who will read it, not for the check. See
   `docs/docs/architecture/kernel.md` § *The deactivation-consequence ledger*.
5. **Routes, workers, subscribers** — `ctx.routes` / `ctx.worker` / `ctx.subscribe`. These
   already apply the gating wrappers; do not call `defineModuleRoutes` and friends by hand.
6. **Settings your module owns** — read them through `settingsReadPort` inside the module.
   A knob a root resolves on the module's behalf is a knob that drifts between the two roots,
   and repeatedly did.
6a. **A gated port may not be resolved where a throw has nowhere to go — and error
   serialisation is the case nobody expects.** AGENTS.md already says presence is *decided* before
   the work at an entry point with no caller to answer (a timer, a boot hook, a signal handler).
   The same rule holds one layer down, inside a reply Fastify is **already serialising as an
   error**: a `ModuleDisabledError` raised there cannot be routed back through `setErrorHandler`,
   so the reply degrades to Fastify's fallback shape — no `error.code`, no `error.details`, no
   `error.requestId` — and `@endora-commerce/api-client` reports `undefined: undefined`. Measured
   in feature 080's T052, where converting one entity read to a gated port broke **every** error
   answered to a signed-in admin while the owner was absent, whatever the error was. The remedy is
   the one every other exit from that hook already took: guard the decoration and answer the
   untranslated payload. That is **not** a `catch` hiding a capability's absence — the caller still
   gets the full refusal, in the fallback language — and `check:port-catches` reads it as such.

7. **Never wrap a port call in a bare `catch`** — it swallows `ModuleDisabledError` and turns
   fail-closed into fail-open. Where a degrade genuinely belongs, put it inside the owner's
   implementation and express it in the return type
   (`allowedIdsFor(): Promise<string[] | null>` is the worked example). Where a **narrow**
   tolerance is genuinely correct — a per-item import failure, a compensating cleanup — keep
   the `catch` and make `rethrowIfModuleDisabled(error)` its first line, with a comment saying
   why the tolerance is right; "defensive" is not a reason. Enforced by
   `pnpm --filter backend run check:port-catches`, which also refuses a *conditional*
   re-throw: `ModuleDisabledError` is an `HttpError`, so a status-code test lets it through by
   accident rather than by decision. It follows the port **through the value**, not the
   `lazyPort` literal (issues #133/#113): a `catch` around a holder the port was constructed
   into, or around a name a composition root contributed, is the same violation. Run it with
   `PORT_CATCH_WHY=1` to see why a name reads as a port. A site whose **every** gate belongs to
   a module the platform refuses to switch off is reported as `OWNER LOCKED` instead: the
   presence answer is unreachable, so there is nothing to drain and a ledger entry over one
   reads stale (D-63). That classification is derived from the manifests on every run, never
   written into a reason — un-lock the owner and the site is a violation again, in the same run.
8. **One registration pass, one boot phase (D-45).** A root calls `composeModules(MODULES, …)`
   once and `runBootHooks()` once, immediately before it builds the Fastify app — so **a boot
   hook may resolve anything**, whichever module registered it. Registration itself resolves
   nothing (`compose.ts`'s `registering` guard), which is what makes its order meaningless.
   The one ordering rule left is for the **root**: a contribution over a name a module
   defaults goes in the single slot between `composeModules(MODULES, …)` and `runBootHooks()`
   — earlier and the module's default overwrites it, later and a boot hook has already read
   that default. **That slot is a method** (issue #52): write
   `composedModules.contribute({ name: value })`, never `registerValues(container, …)` after
   the compose call. The early edge is then structural — there is no object to call it on
   until every module has registered — and the late edge throws
   `ContributionWindowClosedError`. `registerValues` stays legal *above* the compose call, for
   a host value no module defaults (`redis`, `eventBus`, the `*RunWorkers` flags): there is no
   window because there is nothing to overwrite.
9. **Install-time work goes in `manifest.ts`, never in the context.** `ctx.onBoot` is the
   only lifecycle hook a `ModuleContext` carries; `ctx.onInstall` / `ctx.onUninstall` were
   deleted (D-46) because `module:install` composes nothing, so a hook the container
   collected could never fire. Export `installHook` / `uninstallHook` from the module's
   `manifest.ts` — the composer generator wires them. Their contract, in full: the hook is
   **idempotent by contract** (it re-runs after a failed install and after a
   soft-uninstall → install cycle); a **failing install hook aborts the install** and reverts
   that run's migrations; a **failing uninstall hook removes nothing**; **`ctx.hard`**
   discriminates soft from destructive uninstall, so cleanup sits behind
   `if (!ctx.hard) return;`; **neither hook fires on activation or deactivation** — that is
   the other axis (Principle XVII) and no hook may be added to it; and the hook context is
   `{ em, redis, log, module }` (`+ hard`), which cannot carry services.
10. **The platform roots may not import a module (D-52/D-53).** `src/kernel`, `src/http`,
   `src/events` and `src/tenancy` are one rule, not one plus three peers: the kernel does not
   compile without them (five kernel entities take `@GlobalEntity()` from `src/tenancy`, four
   kernel files take `HttpError` from `src/http` as a value), so a peer allowed to name
   `src/modules/` or `src/apps/` is a kernel importing modules with one extra hop. A platform
   file that needs something a module owns takes it **by injection from a composition root**
   — the pattern `ErrorEnvelopeOptions` uses. `src/db`, `src/overlay` and `src/commands` are
   not platform roots.
11. **CI** — `pnpm --filter backend run check:port-dependencies`, `check:port-catches`,
   `check:kernel-boundary`, `check:module-boundary`, `check:container-imports`,
   `check:subscribe-seam`, `check:entry-presence`, and
   `pnpm --filter backend exec vitest run test/contract/kernel/harness-parity.test.ts`
   (drift between the two composition roots, as an explicit draining ledger).

Full guide, including the contribution-point rules and the request scope:
`docs/docs/architecture/kernel.md`.

### Admin permissions

Every module with routes gated by `requireAdmin(...)` **must** register its permission codes
so they appear on `/admin-roles` and pass the CI inventory.

1. **`manifest.ts`** — `permissions: [{ code, label, module?, requires? }]` for every code this
   module owns. `requires` is **advisory** (D-175, feature 080 T057): the codes a role holding
   this one also needs before the surface it opens is whole. Nothing reads it at runtime, no
   upsert is refused, and it is **not** a lifecycle edge — it puts no module in your
   `dependencies` and does not stand in the way of an operator switching that owner off. The
   role editor renders the shortfall for the codes currently ticked, with a one-click add.
   **Do not write a fact the platform already derives.** *A module enforcing a code another
   module owns* is a different question, it is derived from the gates and the manifests
   (`backend/test/helpers/foreign-gates.ts`, D-173), and declaring it here as well would be two
   answers to one question waiting to disagree — the shape D-100 is about. `requires` carries
   what nothing here can work out: a coupling running from an admin screen's own fetches to
   another module's route, plus the judgement of whether a role without the second code is
   broken or merely degraded in a way somebody accepted. Measured before the field was added:
   of 705 `apiClient` call sites in module-owned admin layers, 82 name their path as a plain
   literal, and 299 of the 689 admin route registrations bind their `preHandler` to a variable —
   so even the derivable half would be a heuristic over a minority of the sites, and the
   judgement is not derivable at all.
2. **`manifest-index.generated.ts`** — **generated** (feature 072): a module that ships a
   lifecycle-shape `manifest.ts` is picked up by the tree walk. Run
   `pnpm --filter backend run composer:generate` and commit the result; never edit the file.
   It is the only generated manifest registry (feature 071, F2) — `registered-manifests.ts`
   derives `REGISTERED_MANIFESTS` from it, and the deployment-resolved set on top of that.
3. **Routes** — `requireAdmin('…')` literals must match manifest `code` values exactly.
   The inventory scanner reads the call in every shape the tree writes it (bare,
   through `deps.`/a cradle, optional-call, `requireAdminAny([…])`, a constant or a
   permission-map member, and a `hasPermission` capability check), and **fails on an
   argument it cannot resolve** rather than skipping it. Write the code as a literal or
   a resolvable constant; do not compute it.
4. **i18n** — `adminRoles.permission.<code>` in **your own module's** `i18n/en.json` and
   `i18n/pl.json`, flat, in both shipped languages
   (`specs/091-module-owned-admin-surfaces/`, Phase 3). This item said `_i18n/i18n/{en,pl}.json`
   until 2026-08-30, and that instruction cannot be followed by a module installed from a
   registry: `_i18n`'s bundle is a file in this repository. The **89** labels still in it are
   the legacy block, a per-owner two-way ratchet in
   `backend/test/helpers/permission-labels.ts` — a label added there fails, and a number left
   standing after that owner's labels moved fails too. Never raise one to make the build pass;
   an owner retires by having its entry deleted, and when the last one goes the block goes with
   it. Whether the resolution reaches your bundle is not a matter of taste either: it did not
   until Phase 3, so `mfa`, `pwa`, `stripe` and `prompt_actions` each shipped their labels in
   their own bundle *and* in `_i18n`'s and only the second copy ever rendered — the screen
   looked the key up in the synthetic `core` namespace alone. It now resolves over the merged
   bundle (`admin/src/modules/admin_users/permission-label.ts`), so one home is enough and two
   is a duplicate.
5. **AppShell** — `requiredPermission` on nav entries where applicable.
6. **CI** — `pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts`
   before opening the MR. It sweeps **both** directions — enforced ⇒ grantable and
   grantable ⇒ enforced — plus the label coverage, so a permission declared before its
   gate lands fails just as loudly as one gated before it is declared. The label half is the
   file's second `describe` and answers item 4's rule rather than a second question of its own:
   `missing-label` and `split-label` (a label in one shipped language and not the other),
   `foreign-label` (a module labelling a code its manifest does not declare),
   `orphan-legacy-label`, and the ratchet. It discloses what it read in the estate's grammar —
   `[permission-labels] read: files=… sites=… sources=manifest-index:…` — with the generated
   manifest index as the independent author, so a module tree that moved refuses instead of
   reporting clean over the modules it can still find (issues #244 and #215). It carries the
   ratchet rather than a new `check-*` script because it is already the instrument that answers
   "does this code have a label", and two derivations of one population are two answers waiting
   to disagree. The file's **third** `describe` is item 1's `requires`, on the same reasoning
   and with the same disclosure (`[permission-dependencies] read: …`): the machine owns exactly
   one half of that field — that a requirement names a code the platform's **vocabulary** holds,
   `listKnownCodes()` and deliberately not the grantable set, so a requirement on a
   switched-off module's code is not a finding — because a typo, or a code its owner renamed,
   would otherwise advise an operator forever to grant something that does not exist. The rule
   and its red proofs are `backend/test/helpers/permission-dependencies.ts` and
   `backend/test/unit/admin_roles/permission-dependencies.test.ts`.

Do not duplicate shared codes from core `PERMISSION_CATALOGUE`
(`packages/contracts/src/admin.ts`). Contract:
`specs/026-admin-roles-permissions/contracts/module-manifest-permissions.md`.

**A code has three notions attached to it and they are not one thing** — `module`, a display
grouping that need not be a module id at all; `owners`, the set whose presence keeps the code
grantable; and the **vocabulary versus grantable** split. Until D-175's T058 only the first was
visible anywhere, which is why a reader seeing `module: 'quote_requests'` on `rfqs:handle`
reasonably concluded there was one owner and D-173 is the proof that a careful reader got it
wrong. All three are written down **once**, in `docs/docs/architecture/permissions.md`; `owners`
is now on the wire on `GET /api/v1/admin/permissions` and rendered on `/admin-roles` wherever it
says something the grouping does not.

### Command palette (Principle XVI)

Every module with an admin surface **must** be discoverable under ⌘K / CTRL+K. Sidebar-only
is not enough.

1. **`manifest.ts`** — `actions: [{ id, labelKey, descriptionKey, icon, targetRoute,
   requiredPermission, keywords, weight }]` for the module's landing surface plus its few
   highest-value operator actions. Curate — this is a discovery surface, not a route dump.
2. **`requiredPermission`** — the code gating the target surface, so the palette never
   advertises a 403.
3. **i18n** — `labelKey` / `descriptionKey` are **relative to the module namespace**
   (`actions.openX.label`, not `<module>.actions.openX.label`) and live in the module's own
   `i18n/en.json` + `pl.json`. Those files must be a **flat** `{"a.b.c": "text"}` map — a
   nested object fails `TranslationBundleEntriesSchema`, the boot reconciler only logs and
   skips it, and the palette silently renders raw keys.
4. **`icon`** — must be in `KnownIconNameSchema` (`packages/contracts/src/admin-actions.ts`);
   adding a name there requires the matching entry in
   `admin/src/lib/admin-actions/icon-map.ts` in the same MR.
5. **`targetRoute`** — a real admin route (no query string; the route regex rejects one).
   Deep-link actions need an actual route, e.g. `/credentials/new`.
6. **CI** — `pnpm --filter backend exec vitest run test/unit/_i18n/registered-bundles-shape.test.ts`
   verifies that every registered module's on-disk bundles load and that every manifest action
   key resolves in every shipped language. `pnpm --filter backend run check:action-route-permissions`
   verifies item 2 itself: that the declared code is the one enforced on **this action's**
   `targetRoute` and not merely a code enforced somewhere. The permission inventory's two
   directions cannot see that — both codes in issue #232 were real, declared and enforced —
   so a valid code on the wrong route was invisible until this check existed.

### Module enable/disable (Principle XVII)

A module's presence is the **conjunction of two orthogonal axes** — do not conflate them:

| Axis | Stored in | Owned by | Changed via | Answers |
| --- | --- | --- | --- | --- |
| **Platform availability** | lifecycle registry (`module_registrations`) | deployment operator | CLI / deployment tooling | is this module installed and wired here? |
| **Operator activation** | a manifest-declared Setting in the settings store | business operator | Admin UI, on `/platform/modules` | does this client want this capability? |

Effective presence = **both true**. Gate on the effective state, fail closed if either is off.
An activation write must not touch the registry, and a platform disable → enable cycle must
preserve the operator's activation choice.

The gating wrappers exist in the platform's `kernel/lifecycle/` (`defineModuleRoutes`,
`defineModuleWorker`, `subscribeForModule`, `requireModuleEnabled`) — extend them to the
effective state rather than adding a parallel check. They live in the kernel, alongside the
registry cache, the activation resolver and the effective-state combiner, because the kernel
applies them to every module it composes and may not import from `src/modules/` (D-37).
`_lifecycle` keeps the operator-facing half: the manifest, the permissions, the routes, the
Commands, the orchestrator and the `module:*` CLI scripts. It is a **registered module whose
sources the host owns** — `backend/src/lifecycle/`, not `backend/src/modules/_lifecycle/` — and it
is the one module the packaging sweep does not turn into a package (D-160.11): as a package the
host would have to publish twelve platform targets for its sole consumer, and a package that
enumerates all of its siblings is a cycle waiting to be declared. The generated manifest index
went to `backend/src/` with it (D-160.3). Everything else about it is unchanged: it carries a
manifest, permissions, an activation declaration, i18n bundles and a palette action, and every
check that judges a module judges it — `scripts/lib/module-roots.ts` places it from the index's
own `manifestPath` rather than from a directory named after its id.

**You almost never call those wrappers yourself.** Every core module is composed through
the kernel container (feature 072), and `ctx.routes` / `ctx.worker` / `ctx.subscribe` apply
the wrappers for you — see the composition checklist above. **A per-deployment overlay module
under `backend/src/apps/<deployment>/modules/` is composed the same way** (D-103): it ships
`backend.ts`, gets an ordinary `ModuleContext`, and calls the same seams. Call the wrappers
directly only where there is no `ModuleContext` — a CLI entry point. A few core modules still
wrap a second time inside their `plugin.ts`; that is conversion residue, not a pattern to copy.
**The set is not written down here**, because it is derived and it drains: this paragraph named
four, and by the time anyone read it two of them (`product_feeds`, `pim_ergonode`) had been
converted and now carry a comment saying they deliberately do *not* wrap, while `catalog` had
joined and was named nowhere. A list wrong in both directions is worse than no list. Derive it:
`grep -ln 'defineModuleRoutes(\|defineModuleWorker(' backend/src/modules/*/plugin.ts`.

1. **Routes** — wrap the module's route registration in `defineModuleRoutes('<id>', …)` so
   gating holds at the registration seam for every route the module owns, including later
   ones. Never gate per handler.
2. **Workers and subscribers** — register BullMQ workers through `defineModuleWorker` and
   EventBus subscriptions through `subscribeForModule`, so both stop when the module is off.
   In a composed module that means `ctx.worker` / `ctx.subscribe`, and the subscription is
   registered from `backend.ts` — a handler kept in a service is fine, a **registration**
   kept in a plugin body is what produced twenty-two ungated subscribers (issue #107).
   `pnpm --filter backend run check:subscribe-seam` fails the build on a bare `eventBus.on`
   in a module **and on a BullMQ `Worker` that never reaches `ctx.worker`**, against two
   empty two-way ledgers — see its row in the inventory. That second half exists because a
   worker outside the seam is in no per-module registry, which makes it a queue consumer
   nothing in the platform can stop; `pwa`'s push delivery was one.

   **The worker gate is a *pull*, and that is not an implementation detail** — it is what
   makes it work on the axis an operator drives. `pauseWorkersFor` reaches only the process
   that called it, and the two processes that flip presence are exactly the two that hold no
   workers: the API process serving `/api/v1/admin/modules/:id/activation`, and the `module:*`
   CLI, which composes nothing (D-157.2) and so registers nothing. Until this was repaired a
   runtime **deactivation** took the routes to 503 and left the queue consuming — measured on
   a running build while `google_analytics` was being packaged, which for that module meant
   events still going to Google after the operator withdrew that disclosure. So
   `defineModuleWorker` gates on the **registry cache** instead, which every composed process
   keeps fresh from the same `b2b:module:state-changed` channel: every presence install
   reconciles every registered worker (the *fetch* gate, level-triggered and idempotent), and
   the worker's own processor decides presence before it runs (the *work* gate, for the job
   already in hand when the flip landed). `pauseWorkersFor` / `resumeWorkersFor` survive as an
   optimisation that makes the local answer immediate rather than one refresh away.

   **A refused job is left waiting.** The work gate uses BullMQ's own "not now, put it back"
   idiom — `Worker.rateLimit` plus `RateLimitError`, which the worker handles with
   `job.moveToWait(token)`: no `failed` event, no attempt consumed, nothing dropped, and the
   job drains when the module comes back. Failing it would burn its retries on a decision that
   is not about the job; completing it would drop work nobody asked to lose. The backoff is
   one presence-refresh window (`FALLBACK_TTL_MS`), **not** the 60 s `Retry-After` a 503'd
   client is told to wait: BullMQ's `waitForRateLimit` holds the fetch loop for the whole
   remaining window *across a `resume()`*, so at 60 s a job caught in the flip window sat for
   the better part of a minute after the operator switched the module back on — correct, and
   indistinguishable from broken.
3. **Cross-module calls** — the gate is the **port registration**, not a call you write.
   `ctx.di.providePort('<name>', …)` wraps the registration in a transient gate on the owner's
   effective state, so a consumer resolving it through `lazyPort` gets the 503 `MODULE_DISABLED`
   envelope at the call site instead of a half-executed operation. That is the whole instruction for
   an entry point another module can reach: **publish it as a port and declare the edge** (composition
   checklist items 2–4). A gate the registration applies cannot be forgotten in the one service
   somebody adds later, which a hand-placed call can and did.

   `requireModuleEnabled('<id>')` (the platform's `kernel/lifecycle/plugin-helpers.ts`) is kept for
   the entry point that has **no port and no request** — a `module:*` CLI script, a one-off
   maintenance entry. This item used to instruct every module author to call it, which is how it
   came to be cited far more often than used; the correction then overshot into *"zero call sites
   in `src/` today"*, which D-157.5 measured false. It has **one** call site, and since feature
   080's T042b that call site is the **host**, not a module: `src/cli/module-commands.ts` asks it
   about the module that **declared** the command it is about to run — first, before it builds a
   context and outside every `try`. That is the same question the one module that used to ask it
   (`carts`' abandonment sweep) asked about itself, applied once for every command instead of a
   line each author has to remember, which is what this item's first paragraph says a gate is
   for. It is never asked for an **owner's** id: that answer is the port gate's, and asking it
   twice is how the two come to disagree.
   `check-port-catches.ts` knows the spelling, so a `catch` around one is refused like a `catch`
   around a port.

   **A module's own operator command is a manifest declaration the host runs** (D-160.9,
   D-157.8), not a script that bootstraps the host. Export `cliCommands` from `manifest.ts`
   beside `installHook` — the same tree walk picks it up, so core, an overlay module and an
   installed package all declare one on identical terms — and keep the body in
   `packages/modules/<id>/src/backend/cli/<name>.ts`, `await import()`ed from the declaration so the
   generated manifest index stays light. The handler receives a `ModuleContext` and resolves
   with `lazyPort<T>(ctx, 'literalName')`, byte-identical to `backend.ts`; a
   `scope.cradle.someForeignPort` read would be an undeclared edge `check:port-dependencies`
   reports clean. `pnpm --filter backend run cli -- --list` prints every command an instance
   offers. The five `module:*` scripts are the **other** family and must not convert: they
   operate *on* the platform, and composing runs the reconciler that would make
   `module:install` a silent no-op (D-157.2/.4).

   **Where nothing can catch the throw, presence is *decided* before the work — not caught after
   it.** A timer callback is the standing example: it has nowhere to throw *to*, so a
   `ModuleDisabledError` raised inside it is either swallowed by a `catch` that was meant for
   transient failures or it takes out the tick. So ask `effectiveState.isPresent('<id>')` and return
   — **first, and outside the `try`**, so a genuine failure and a switched-off module do not share
   one silent no-op. `backend/src/modules/ksef/plugin.ts:179-190` is the worked example and says so
   in its own comment. The same rule holds for any entry point with no caller to answer: a boot hook,
   a signal handler, a `process.on` sweep.

   `pnpm --filter backend run check:entry-presence` is the ratchet (issues #126 and #146), and it
   sees **less than the rule says**: a `setInterval`, a `setTimeout` the callback re-arms, a
   `process.on` lifecycle handler and a `ctx.onBoot` hook, each in a module's own sources. It does
   not see a one-shot deadline inside an operation that already has a caller, a synchronous write
   reached through an imported helper, or a boot hook that awaits nothing.
   `TIMERS_WITHOUT_PRESENCE` and `BOOT_HOOKS_WITHOUT_PRESENCE` are two-way and, unlike the subscribe
   ledger, are not expected to empty: an entry says why a site is **right** to keep running while its
   module is off.

   **A boot hook is one of those entry points, and the obligation splits three ways** (issue #146,
   D-67/D-68). This paragraph used to except boot hooks on the grounds that "`runBootHooks` catches,
   so that is one kernel decision rather than a guard per module". It does not catch: it wraps the
   hook, attributes the failure to the module and **re-throws** as `ModuleCompositionError`, which
   `index.ts` turns into `process.exit(1)` — and that is the ruled-correct behaviour, because a boot
   hook runs during composition, where a swallowed failure would mean serving requests on a platform
   that is not what the code says it is. So the obligation is per hook: a hook that
   **does work** (a reconcile, a seed, a Redis or Postgres write) probes
   `effectiveState.isPresent('<own id>')` first and returns, exactly like a timer; a hook that
   **contributes** an inert descriptor to another module's registry must **not** probe, because the
   host filters by contributor at enumeration and a probe would make runtime activation require a
   restart; and a hook that does **both is split in two before either answer applies** — probing a
   mixed hook stops the contribution, which for `blog` and `cms` meant an operator could delete an
   asset a switched-off module's rows still embed. `blog`, `cms` and `product_feeds` all ship the
   split shape, a work hook and a contribution hook kept separate, each with the reason in its own
   comment. A module that declares `activation.nonDeactivatable` is exempt: it has no absent state
   for a hook to run in, and the check derives that from the manifest rather than a list.
4. **Manifest** — declare the module's activation control and its default, and, if the
   platform genuinely cannot run without the module, declare it non-deactivatable with a
   reason. The lifecycle orchestrator refuses to disable **or uninstall** a module that
   declares it — soft and hard alike, with no `--force` (D-69) — so the declaration bites on
   both axes and on every withdrawal. **It also says the module is required to be *present*,
   not merely un-switch-off-able** (issue #258): `composeModules` refuses, before the first
   module registers, a composition that lacks one — naming it, the reason the manifest gives
   and the remedy — because a platform without it does not degrade, it exits, in whichever
   module's boot hook happens to need it first. *"Required to be installed"* and *"cannot be
   switched off"* are one set on purpose; do not add a second manifest field for it, and do
   not write the set down anywhere — `requiredModulesFrom(manifests)` derives it on every
   composition, so an owner withdrawing a lock changes the refusal in the same run (D-100).
   Never hard-code an exception list in the
   admin app, and never declare it because a screen happens to live in the module — the
   activation controls render on `/platform/modules`, which belongs to no module (D-36).
5. **Admin and Storefront** — a module that is off contributes no sidebar entry, palette
   action, widget, tab, settings group or editable configuration, and no storefront element.
   Both frontends resolve this from the server's effective enabled-set; do not hard-code the
   surfaces. A platform-unavailable module renders as absent or blocked-with-a-reason, never
   as merely "switched off".
6. **Tests** — ship an off-state test proving API rejection, admin absence, non-editable
   configuration and storefront absence while off, plus full restoration — and cover the
   deactivated-while-platform-available case specifically.

Switching a module off is **not** uninstalling: it drops no data, configuration, bundles,
permissions or schema.

**The two therefore differ on the operator's activation choice, and the difference is
deliberate.** `disable` → `enable` is a pause: the platform row flips, nothing else moves,
and the choice comes back. A soft `uninstall` → `install` is taking the module off the
table: the settings sweep in the orchestrator runs on soft and hard alike, and the
activation control is a Setting the module owns, so a re-install starts from the manifest
default. Do not "fix" that asymmetry — it is the product's answer, and
`test/unit/_lifecycle/orchestrator.test.ts` asserts both halves so a fix fails.

### Migrations (feature 065)

There is **no repo-wide sequential migration number**. Never write "the next free `NNN_*`
number", never pick a number, never edit an execution list.

1. **Scaffold it** — `pnpm --filter backend run migration:new -- --module <id> --name <slug>`.
   The file lands in the module's own `migrations/` directory, **resolved** rather than
   spelled: `--module core` is `backend/src/db/migrations/`, and a module package's is the
   directory its own `exports` map publishes as `./migrations`. This step read
   *"`backend/src/modules/<id>/migrations/`"* while the scaffolder rejected all 67 module
   ids with `Valid ids are: core.`, because that is where the tool looked and F4 had emptied
   it. The file is named `<YYYYMMDDTHHmmss>_<module-segment>_<slug>.ts` with a UTC
   timestamp. The class name is derived mechanically from the filename
   (`Migration<STAMP><PascalCaseTail>`); it is the name persisted in `mikro_orm_migrations`,
   so never rename an applied class. **The tail must begin with the owning module's
   segment** (`orders` → `Migration…Orders…`, `_i18n` → `Migration…I18n…`, core →
   `Migration…Core…`) — that is what makes a class name unique across every module the
   platform can compose, including one installed from a package. `orderMigrations` refuses a
   violation as `unscoped-name` and `check:naming` refuses one in the core tree.
2. **Register it** — run `pnpm --filter backend run composer:generate` and commit
   **`backend/src/db/migrations-registry.generated.ts`** alongside the migration. The
   registry is generated from a filesystem walk (feature 071, F2) and replaced the
   hand-ordered `migrationsList` in `mikro-orm.config.ts`; never edit it by hand. An
   unregistered migration does not run; `test/unit/db/migrations-registry.test.ts` and
   `overlay:check` both fail the build for a stale artefact.
3. **Do not order by hand, and do not order by timestamp.** Declaration order in the
   registry has no effect — and there is nothing to reorder, since regenerating restores it.
   Execution order is computed by `backend/src/db/migration-order.ts` (feature 081): a frozen
   historical prefix, then **module by module** in a topological order of the manifest
   `dependencies` graph, each module's migrations contiguous and ascending by timestamp. So a
   **timestamp orders a module's own migrations and nothing else** — two modules may legally
   share one, and moving a stamp cannot change a cross-module position. If `db:fresh` fails on
   ordering, the answer is always the manifest `dependencies` of the module that owns the
   referencing table. The 45-day correction horizon, the dependency-inversion edges and the
   `unresolvable-order` failure are gone; a dependency **cycle** is now a reported diagnostic
   rather than a boot failure — because the graph is the primary ordering and a manifest can
   arrive from an installed package, so a throw would let one stranger's declaration stop a
   shop's own schema from migrating. It has **three readers and three reactions**, and the
   split is the point: red in `test/unit/db/module-graph.test.ts` for a cycle in this
   repository, logged at `warn` at boot for one on a running platform, and **refused by the
   `_lifecycle` orchestrator** for one that is about to arrive — `install` walks the installed
   set plus the arriving module with `findModuleCycles` and refuses with `manifest-cycle`
   (exit `65`) when a component holds it. Only the arriving module's component is refused; a
   loop between two already-installed modules blocks nobody else's install.
4. **Cross-module FK ⇒ declare the dependency.** A new foreign key to another module's table
   requires that module in your manifest's `dependencies` (transitively), or
   `pnpm --filter backend exec vitest run test/unit/db/fk-dependency-drift.test.ts` fails.
4a. **And so does any other cross-module table reference — plus, for a *write*, a
   declaration is not enough** (feature 097). Item 4's rule is a rule about **DDL**, because
   its instrument reads `create table`, `alter table` and `references "…"` and no DML
   statement at all; until this landed, an `insert`, `update`, `delete` or `select` in a
   migration naming another module's table was judged by nothing in the repository. 76 such
   accesses stood in 28 migration files, 4 of them undeclared and 37 of them writes.
   `check:module-boundary` now judges them, under two rules with two ledgers:
   **R1** is item 4 with its predicate widened from `references` to every statement
   `sqlTableAccesses` recognises, and **R2** is that a migration owned by `A` may not
   **write** a table owned by `B` *whether or not R1 holds* — a declaration is an
   ordering-and-presence fact and a write is an ownership fact, so seeding, reseeding and
   correcting a module's rows is that module's own migration's job. Kernel-owned tables are
   outside both, derived from the owner map and never from a table list: the kernel cannot
   appear in a `dependencies` array. The three seams a write's repair takes are the owner's
   own migration, the writing module's `installHook` (idempotent by contract, and it re-runs
   after a soft-uninstall → install cycle) and the owner's port at boot. Do **not** answer an
   R1 finding with a manifest line where your module is `nonDeactivatable` and the owner is
   switchable: that makes the owner's activation control a dead switch (§ *Composition*
   item 4a), and it is the case that produced the feature.
   `specs/097-migration-sql-boundary/contracts/migration-cross-module-sql.md` is normative.
5. **Renaming an applied migration class costs a database rebuild.** Since feature 072 there
   is no frozen name map and nothing in the repository forbids the rename — but
   `mikro_orm_migrations` stores the **class name**, so every database that already ran the
   migration under its old name will see the new name as pending and try to re-apply it.
   Rename only when moving a migration between groups is genuinely required (as feature 072
   T020 did), and ship the rename with a note telling every developer to rebuild the **dev**
   database: `pnpm --filter backend run db:reset`. The test suite needs nothing, since issue
   #289: its migration template is named after a digest of the migration set, so a renamed
   class is a different set and the next invocation builds its own template rather than
   re-applying anything into yours.
6. **Never scaffold a migration stamped at or before `BASELINE_THROUGH`**
   (`20260801T000000`, `backend/src/db/migration-order.ts`). Everything the committed core
   registry contributed at or before it is the **frozen historical prefix**: its order is
   history — the pre-065 block contradicts the manifest graph in 37 places, and recomputing it
   produces an order a fresh database cannot apply — so a migration landing there is ordered
   by that history instead of by its module's `dependencies`. The block is closed and is never
   drained. `migration:new` clamps the stamp for you; do not hand-write one below the
   watermark. Membership also takes the entry's **origin**: only the committed core registry
   may join, so a package's back-dated stamp cannot.

**Entities are registered the same way.** `backend/src/db/entities-registry.generated.ts`
comes out of the same command and the same walk: add the `@Entity()` class under the
module's `entities/`, run `composer:generate`, commit the artefact. An **overlay** module
contributes to neither — it can ship no migration (D-106), so the generator refuses an entity
or a migration under `backend/src/apps/` rather than emitting schema nothing creates.

**A module that has become a workspace package contributes to all four artefacts, with a
bare specifier** (feature 080, T041a; D-149). Until then the generator had no notion of one:
every walk was rooted at `backend/src`, `MODULE_MIGRATION_RE` was anchored at
`^modules/<id>/migrations/`, and `specifierFromDb` emitted a relative path and nothing else —
so the first module to move would have left the migration registry, which is the one artefact
where an absence is invisible. Four things about how it works now, because each is a rule an
author can trip over:

- **A package is discovered by its own `endora: { type: 'module', id }` block**, over the
  members `pnpm-workspace.yaml` globs, and by nothing else. `packages/modules` appears in no
  check and in no generator (D-100), so **the glob and the move belong in one merge request**:
  a package no glob reaches is not a member, is not discovered, and drops out of every
  artefact silently.
- **An *installed* package contributes nothing** (D-119/D-155). It is discovered at runtime;
  baking it into a committed artefact registers it twice, and `overlay:check`'s `foreign`
  verdict refuses it by **real path**.
- **The specifier is derived from the package's own `exports` map** — the most specific
  declared subpath whose target covers the file, where a target named `index.*` covers its
  directory. Nothing spells `./backend` or `./migrations` anywhere in the tree; a package that
  names its layers differently is followed. A file **no** declared subpath covers is
  **refused**, because a committed registry importing it would get
  `ERR_PACKAGE_PATH_NOT_EXPORTED` and skipping it is how a migration goes missing without a
  word. Wildcard subpaths (`"./i18n/*"`) are outside the rule.
- **A packaged migration is attributed to `endora.id`, never to a path segment** (D-142) — a
  hard uninstall reverts exactly the migrations registered under the module being removed.

**A module package's own `package.json` is generated too, and it is the one generated artefact that
is also install-affecting** (feature 080, T041). `pnpm --filter backend run manifests:generate`
renders it from the layer inventory — peers from the bare specifiers the module's sources actually
import, `exports` from which layers exist, the `endora` block from the module's `manifest.ts` — and
`manifests:check` fails on drift. Everything about it is **derived**: `google_analytics` gets
`bullmq` and `ioredis` because it runs a real worker and `quote_requests` gets neither because its
"worker" is a plain sweep, and that difference falls out of the walk rather than out of an author
remembering. Node's built-ins are excluded by asking `isBuiltin`, not by a list, and the package's
own name by reading specifiers as literal AST nodes — a text scan reports every package as depending
on itself, measured.

**It also writes one file that is not a package's: `admin/package.json`'s dependency on the module
packages the admin composes** (feature 091). The admin contribution registry names each
contributing module by a **bare** specifier, and pnpm links a workspace member into `node_modules`
only for a package that declares it — so a module that ships `src/admin/` and is not a dependency
of the admin is a registry entry the bundler cannot resolve. The reconciliation is deliberately
narrow: a module package this run found, or a dependency carrying a `workspace:` range naming no
current member (a package that has *gone*). A third-party package from a registry carries a semver
range and is never touched, whatever it is called, and every other key of that file — the React,
Radix and Tailwind ranges, which are a human's with Constitution IV's justification behind them —
keeps its value and its position. The alternative, a refusal telling the author to `pnpm add`, was
rejected for re-creating the thing feature 091 removes: a shared file every module author edits by
hand. **The ranges a module package peers on come from the applications, plural**, for the same
reason — `react` and `lucide-react` are declared by `admin` and by no other member — and which
workspace members are applications is derived from the shape of their `pnpm-workspace.yaml` entry
(a literal names one deployable, a glob enumerates a library family), never from a list.

**Run `pnpm install --lockfile-only` in the same breath and commit `pnpm-lock.yaml`.** A generated
manifest changes what a workspace declares, so `pnpm-lock.yaml` goes stale the moment the render
differs — and `pnpm install --frozen-lockfile` is the **first** thing every CI job does, so the
whole pipeline dies in `quality` before a single check runs. That is not hypothetical: it is how
`master` went red on 2026-08-24, from three lines of lockfile left behind after the generator
correctly dropped a `zod` the package imports nowhere. The pairing is the same one
`composer:generate` has with its four artefacts; this one is newer and easier to forget, because a
hand-written manifest never needed it — whoever edited one was already running an install.

**And `manifest-index.generated.ts` carries each entry's real `manifestPath`.**
`registered-manifests.ts` used to compute it as `<modules root>/<id>/manifest.ts`, a
convention nothing verified, and every consumer takes `dirname` of it to reach the module's
own directory — the `_i18n` boot reconciler joins `bundlesDir` to it and **logs and skips** a
directory that is not there. A packaged module would therefore have loaded no bundle and
rendered every command-palette entry as its raw i18n key, with no error anywhere. The
generator emits the location it walked (`src/manifest-locations.ts` resolves it against
the index's own `import.meta.url`, so it follows a `dist` run and a moved index alike), and
both halves **refuse** rather than substitute: a specifier reaching no file throws at the
first import of the index, and an entry with no path throws in `coreManifestEntries`.

Full guide: `docs/docs/architecture/migrations.md`. Contracts:
`specs/081-per-module-migration-order/contracts/ordering-algorithm.md` (normative for the
order) and `migration-identity.md` (naming and uniqueness);
`specs/065-manifest-aware-migrations/contracts/naming-convention.md` §1–§2 (still the only
filename and class-name recognizers) and `fk-dependency-check.md`. The `065` ordering contract
is superseded.

### Documentation (feature 100)

**A module's page appears in the navigation because the module exists, not because
somebody remembered two shared files.** `docs/sidebars.js`' Modules category and the module
map are **generated** — `docs/sidebars.modules.generated.js` and
`docs/docs/modules/module-map.generated.md`, artefacts six and seven of
`composer:generate`. Never hand-edit either, and never add an entry to `sidebars.js` for a
module.

1. **Write the page** under the site's modules category, named after the module id (a
   hyphenated slug folds onto a snake_case id, so `google-analytics` documents
   `google_analytics`). A module with sub-pages gets a directory and an `index.md`.
2. **Front matter is Docusaurus's own and nothing this repository invented** — `title`
   (required), `description` (one sentence naming the capability; it is the module map's
   summary column and the page's meta description), and optionally `sidebar_label` and
   `sidebar_position`. That is deliberate: a third-party module author writes ordinary
   Docusaurus markdown and learns nothing from us.
3. **Regenerate** — `pnpm --filter backend run composer:generate` — and commit both
   artefacts. `overlay:check` holds them to its `missing`, `stale`, `empty` and `foreign`
   verdicts like the other five.
4. **A module with genuinely nothing to document declares `docs: false`** in its manifest.
   Absent and `false` are not the same state: `false` is a decision and owes nothing,
   absent is a module nobody has decided about and is a `check:module-docs` finding.
5. **CI** — `pnpm --filter backend run check:module-docs` (in `quality`, and its row in the
   inventory below says what it refuses) and the `build:docs` job, which is what makes a
   sidebar entry naming no page and a link to a page that moved fail the pipeline rather
   than a developer's machine.

Pages still live in the site's own tree; moving them into the packages that own them is
feature 100's Phase 2, and the manifest field `docs: { dir }` that will locate them is
`i18n.bundlesDir`'s mechanism unchanged — a package-root directory, in `files`, no `exports`
subpath, joined to `dirname(manifestPath)`.

### i18n

All user-facing strings ship in **both `en` and `pl`**; a static CI check rejects hard-coded
literals in the admin SPA (`pnpm --filter backend run i18n:hardcoded`, in the `quality` job since
issue #116 — before that it was cited here while running nowhere). It compares the tree to
`HARDCODED_STRINGS_BASELINE`, a **per-file two-way ratchet** over the 274 pre-existing findings: a
new hard-coded string fails, and so does a baseline number left standing after the strings under it
were translated. Never raise a number to make the build pass — add the key. Run
`pnpm --filter backend run i18n:hardcoded -- --strict` to see the whole remaining debt, or pass one
path while draining a screen.

**Read those first two clauses as a rule and an instrument, not as a rule and its enforcement** —
the semicolon has been doing work it cannot do. The rule is every user-facing string; the
instrument is `.tsx` files under three admin roots, judging JSX (`collectTsxFiles` pushes a path
only `if (entry.endsWith('.tsx'))`, and the classifier's two branches are `ts.isJsxText` and
`ts.isJsxAttribute` over four attributes). **Prose a backend module composes is outside it by
construction**, and not by a root that could be added: a module's backend sources are `.ts` and
contain no JSX, so a backend root adds zero files to that walk while enlarging what its `read:`
line claims — issue #244's shape arriving through the repair. `check:language` does not cover it
either, and there too the reason is design rather than oversight: Principle VIII v3.0.0 names
inline comments and `/docs/` pages and says string literals MAY be in any language, which its
per-extension regex implements by matching only a line carrying a comment marker **and** a
diacritic. So a Polish notification title in a module's service breaks the *first* clause above
and no principle and no check — which is how an admin notification came to be a finished sentence
in whichever language its module was written in, English for four modules and Polish for a fifth,
rendered raw beside bell chrome that is translated eleven lines away. 45 such literals stand
across three delivery seams; the measurement, the shape and the instrument are designed in
`specs/093-backend-delivered-prose/`. Until that lands, **this paragraph is the only thing between
an author and shipping the forty-sixth**.

**The translation policy, owner ruling of 2026-09-01 — and it binds the storefront, the admin and
the backend alike.** Three clauses, in the owner's terms: *every module's messages are in **English
by default***; *every module or package we implement ships a **Polish** bundle too*, so two
languages are the floor and not the ceiling; and *a missing Polish message **falls back to
English***. It lives here rather than in `.specify/memory/constitution.md` deliberately — Principle
VIII governs which language the **source artefacts** are authored in and was narrowed in v3.0.0 to
comments and `/docs/` precisely so that it would not be read as a user-facing translation rule.
Putting this beside it invites exactly the conflation that has already happened once in writing:
a Polish string literal is not a Principle VIII violation, and the repair that premise suggests
would make every correct Polish seed sentence in the tree a finding. If the owner would rather it
were constitutional, the amendment is drafted for them in
`specs/094-translation-boundary/contracts/translation-boundary.md` § 5; **one home either way,
and a pointer from the other** — never two statements of one rule.

**Where it already holds, measured rather than assumed.** The **storefront** implements all three
clauses and is the strongest of the three surfaces: `storefront/lib/i18n/messages.ts` declares
`const MESSAGES: Record<string, Record<MessageKey, string>>`, and that inner `Record` is **total**
— so a Polish string missing from the catalogue is a **`tsc` error**, not a runtime fallback, and
`pnpm -r run typecheck` is the instrument. Its `tForLocale` still carries the runtime chain
(requested locale → `en-US` → the key), which is what answers a *third* locale nobody has written
a catalogue for. The **admin** implements the same chain independently in
`packages/admin-kit/src/i18n/resolver.ts` (`FALLBACK_LANGUAGE = 'en'`, requested → English →
`${scope}.${key}`), with one structural caveat: the English step is attempted only when the caller
supplies `fallbackBundle`. There is exactly one caller that builds those arguments —
`TranslationProvider`'s `t` — and it *self-supplies*, fetching the English bundle itself whenever
`language !== 'en'`, so the policy holds by construction and not by anyone remembering. **The
window where it does not** is between the two awaits: `setBundle` lands before `getBundles('en')`
resolves, so for one network round-trip a key missing from `pl` renders `scope.key` rather than
English. The resolver names that state itself (`outcome: 'placeholder'`), which is where to look.
The **backend** implements no clause at all for the prose it composes and delivers — that is
`specs/093-backend-delivered-prose/`.

**The second clause's gap is closed, and it was locked at zero violations.** 62 of the 69
registered modules ship both `i18n/en.json` and `i18n/pl.json`, 7 ship neither, and **none ships
one without the other** — so the invariant was true when the instrument landed, which is the
cheapest possible moment to lock one and the only moment at which its ledger is empty on the day
it arrives. `check:bundle-pairing` is that instrument (its row is in the inventory below), and the
predicate it enforces is a **conditional**: the 7 owe nothing, because a module with no
user-facing strings owes no translation.

`backend/test/unit/_i18n/registered-bundles-shape.test.ts` is the file that looked as though it
already did this, and it was a two-way miss — the family this repository spends its review effort
on, a population derived from the artefact under judgement. Its symmetry case read
`if (!en || !pl) continue;`, so a module that dropped `pl.json` was **skipped by the case whose
subject is bundle symmetry**; and its action-key case iterated `loaded.byLanguage`, the languages
*that module happens to ship*, so a module shipping only `en.json` had its keys checked against
English and passed. This file's own description of that test — *"every manifest action key
resolves in every shipped language"* — was true, and "every shipped language" silently meant the
module's rather than the platform's; the two read identically and are not the same claim.
**Measured**: with `packages/modules/blog/i18n/pl.json` removed, that file passed 66 of 66. Both
halves are repaired in the merge request that landed the check — the action-key case iterates
`SUPPORTED_LANGUAGES`, and the symmetry case separates the two states its disjunction ran together
(*neither* bundle is the module that ships no strings, *one* is a failure) — and on the same tree
it now fails two cases. The two instruments are not duplicates: the check answers file-level
presence over every registered module, the test answers key-level resolution inside the bundles a
module declares.

**Where the translation happens is a separate question from which languages exist, and it has a
boundary** (owner question of 2026-09-01, analysed in `specs/094-translation-boundary/`). The rule
is **not** "the backend returns codes and the consumer translates", and it is not the opposite
either — it turns on one derived fact:

> **Can the backend resolve the reader's language at the moment it composes the string?**

- **It can** — an HTTP response (the request's language, feature
  `specs/083-buyer-language-resolution/`), an e-mail (the recipient's), a PDF (the document's
  `locale`). The backend translates, **and ships the code too**. That is what the error envelope
  already does: `error.code` is on the wire for a consumer to branch on, `error.message` is the
  sentence the backend resolved. Do not move this to the consumer; it is what issue #234 fixed,
  and a third-party consumer with no vocabulary would render raw codes.
  **"Can" means capability, not current practice** — a site with a resolvable reader that simply
  does not consult them is case 1 with the translation step missing, never case 2. Read it the
  other way and the rule is circular: it would classify every un-internationalised site as case 2
  and ratify whatever the code already does. `organizations`' `describeStatus` is the worked
  example — Polish prose composed on a request whose language `createRequestLanguageResolver`
  resolves and whose *error envelope already uses that resolution*, returning
  `{ status, reason }` so the machine token is on the wire beside the prose and only the
  translation step is absent.
- **It cannot** — the reader is plural or reads later. An admin notification is the case: one row,
  many administrators, different `preferredLanguage`. Ship a key, its params **and an English
  fallback sentence**; the consumer translates. That is `specs/093-backend-delivered-prose/`.
- **There is no reader with a language** — a webhook payload, an integration document. Ship a code
  and **no prose at all**. `webhooks`' `eventType` already does.

**Four kinds of string leave the backend and only the first is in scope**, which is the
distinction that makes the question answerable: *platform prose* a developer wrote (a bundle,
`en` + `pl`); *operator content* the shop wrote (per-language columns — a category name, a
transactional-email body — and never a bundle); a *machine token* (`eventType`, `error.code`, a
status — never translated); and *third-party text* passed through verbatim (a vendor's failure
detail — never translated, and wrapping it is a different decision). Sweeping these together is
how "should the backend hold translations" becomes unanswerable.

**Classify by where the string is *read*, never by what carries it.** A mechanism-keyed population
is defined by the presence of the mechanisms somebody enumerated, and they are unbounded:
`specs/093-backend-delivered-prose/` surveyed three delivery seams — a port call, a mailer, a
renderer — and the tree held six more shapes carrying prose, among them a plain `return` from a
route handler and a push into a persisted log, one of them in a file that survey had already read.
A string does not become user-facing by being carried; it becomes user-facing by being read. So
the population is *a string a human eventually reads* and the question above is the whole
classifier — it answers for the shape nobody has thought of yet, which a list cannot.

**The first clause has an instrument too, and unlike the second's it did not land empty.**
`check:default-language-prose` (its row is in the inventory below) refuses *a prose literal in a
natural language other than English, outside a per-language structure, in a module's own sources*
— which is what "English is the default" says, enforced as written. Its asymmetry is the rule and
not a limitation: it finds non-English prose and says nothing about English prose, because under
this ruling an English literal is not a finding. It is therefore **not** an instrument for "is
this string translated"; that is `specs/093-backend-delivered-prose/`'s question for the case-2
seams and `tsc`'s for the storefront. **46 sites over 41 keys stood when it landed**, in a
per-module ledger under `backend/scripts/ledgers/non-english-defaults/` that is two-way and
expected to empty — every entry names its literal, says what the site is and says which case of
the boundary above its repair takes, so a reader is sent to the right repair rather than to the
finding. Its bound is declared rather than discovered: detection is **Polish only**, by
`check:language`'s own diacritic class plus a stopword list, so Polish carrying neither signal is
invisible (`'Nowa Organizacja'` is the measured example) and a third shipped language is exit 2
until it has a detector.

**The cost of consistency is nearly nil, and that is the finding rather than a convenience**: every
seam in the tree already sits on the correct side of this boundary, and what is left is
translation steps that were never wired rather than designs that were wrong. So this is a rule for
new code with two draining ledgers, not a migration.

## Static checks and their escape hatches

**Adding or changing a check?** It needs an entry in
`backend/test/unit/scripts/check-inventory.test.ts` (which enumerates every `check-*` script
and fails on one it does not name), a companion test, and an exit code of **2** for "nothing
was read" — an empty file list, a missing input, a tree it could not walk. A green result
must not be able to mean "not looking": that is issue #113.

**And it prints what it read** (issue #244). Exit 2 answers "the input was empty"; it does
not answer "the input was 7% of itself", which is the case that happens — the same shape has
now been found seven times, and every one of them was a check whose output said what it
found and never said what it read. So every check prints one line in one grammar, from
`backend/scripts/lib/read-size.ts` or the shell twin `scripts/lib/read-size.sh`:
`[entry-scope] read: files=1459 sites=47 sources=manifest-index:65/65,package-scripts:18/18`.
`files` is what the walk **opened**, never the files a finding landed in; `sites` is the
finer population where the check has one (#235/#237 are the case where the file count stood
still and the site count moved); `sources` is the **independent** derivation it is reconciled
against — the manifest index for a module walk, `package.json` scripts for a declared
program — because a check that computes its own population and then reports it has said the
same thing twice. Where there is genuinely no second author the token is `self-reported` and
the reason goes in `READ_SIZE_WITHOUT_AN_INDEPENDENT_SOURCE`. The reporter itself exits 2 on
nothing read, on an expectation of zero and on a walk **shorter** than its expectation, and
`backend/test/unit/scripts/check-read-size.test.ts` spawns **every** check and holds
each printed number to the band recorded in `backend/test/helpers/check-read-sizes.ts`
(−10% / +50%). Re-record a number when the population legitimately grows; never widen the
band to make a run pass — **and which entries to re-record is now printed rather than
remembered**: the same run emits a `[read-size drift]` block naming every recorded entry that
no longer describes the tree, with the recorded value, the observed one, the signed delta and
how much of the slack to that edge the move consumed, on a green run as well as a red one
(feature `specs/095-read-size-drift-report/`). It exists because the band ratchets *blindness*
and cannot ratchet *staleness* — a recorded value went wrong three times in ten days, twice
silently, every one of them comfortably inside the band — and because "re-record in the merge
request that moved it" presupposes an author knows which entries their change moved, which is
the computation each check performs and not a thing a checklist can enlarge. The header is a
census (`3 drifted, 32 agree, 0 not measured, of 35 recorded`), printed even when nothing
drifted, because a silent report cannot be told from one that did not run; an entry the run
could not measure is named as *not measured* and never counted as agreeing.

**How many checks that is is not written here**: this sentence read
*"all twenty-seven"* while `RECORDED_READ_SIZES` — the list the test actually spawns — held
**34**, a count of a derived fact going stale by seven inside the paragraph whose entire
subject is a number nobody re-derived (D-100). The record file answers it, and it grows in the
merge request that adds a check. The copies that stood in `check-read-sizes.ts`' and
`check-inventory.test.ts`' own headers were removed rather than decremented (feature 091,
Phase 5 T5): what they meant was *"every check in `CHECKS`"*, which is what they now say.

**That spawning test tolerates a non-zero exit and refuses a *signal*, and the two are not
the same finding.** A check may legitimately be red on the working tree and still has to
disclose what it read; a check the kernel killed disclosed nothing for a reason that is not
its own. Collapsing both into one caught error is how `master` came to fail with
`check-port-catches.ts printed no read line` — a content-shaped assertion, exit 1 rather than
137, matching nothing anyone greps for after an OOM — while the truth was that the two
heaviest checks (746 MB and 627 MB of peak RSS, measured) had been SIGKILLed inside a 4 GB
runner. `backend/test/helpers/check-process.ts` keeps the `close` event's answers apart, and
`backend/test/helpers/spawn-pool.ts` sizes the pool from the container's own accounting
rather than from a number somebody picked: cores, intersected with what cgroup v2 says is
left, minus one child's worth of headroom. If you write a test that spawns processes, spawn
them through those two — the next resource failure will wear the same disguise.

The inventory entry carries the red proofs, and two properties decide whether they are worth
anything (issue #130). **The fixture enters at the top of the analysis** — source text, a
file map, an injected reader, a fixture tree on disk — never a value the check normally
computes: the entry for `check-entry-scope` handed a *pre-classified* record to the last
function in the chain, so the classifier it was supposed to protect never ran, and the
`setInterval(`-only grep inside it hid a live FR-020 gap. A fixture that enters below the
defect cannot catch it. And **one proof per shape the check claims to refuse**, each
asserting the finding's kind, or four of a check's five signals can go blind behind the
fifth's red. `docs/docs/architecture/kernel.md` § *Writing a check that can go red* is the
working guide.

**Exit 2 on a walk that came back *short*, not only on one that came back empty** (issue
#215). `files.length === 0` is the wrong predicate for a check whose population is
`backend/src/modules`: 1364 of the 1469 `.ts` files under `backend/src` live there, so a
moved module tree does not empty the walk — it leaves the other 105 files, which the check
reads, finds nothing wrong in, and reports clean. Measured with `src/modules` moved out of
`src`, eight checks exited 0; three more were red only because a ledger went stale, and
four survive a *partial* move because their floor is "at least one" rather than "all of
them". So a module-tree walk derives its expected population from the generated manifest
index and refuses when a registered module contributed no source —
`backend/scripts/lib/module-population.ts`, and never a count written down, here or in a
check (D-100). `backend/test/unit/scripts/moved-module-tree.test.ts` spawns each of them
over a fixture backend whose modules are gone and whose registry still lists them; the
inventory's `residueGuard` field is the two-way link to it.

**Refusing a moved tree is not following one, and the difference is what makes F4's layout
move reviewable** (feature 080, T040a). Because that floor is *per module*, the first module
to leave `backend/src/modules` reds all sixteen checks at once — the index still registers it
and no walk produces a file for it — so before this the move was one commit or nothing. The
module root is therefore a **derived list**, `backend/scripts/lib/module-roots.ts`: the
generated index is *located* (searched for over the workspace members, so it is found where it
is today and equally at `backend/src/` after the ruling that makes it host-owned), the
application's source root is the index's own ancestor one level inside the member holding it,
and each module's directory is either a directory under that root named after a registered id
or a **workspace member declaring `endora: { type: 'module', id }`** — the package's own
statement about itself, the same one the runtime discovery reads. Which directories are members
comes from `pnpm-workspace.yaml`, never from a path written down: `packages/modules` appears in
no check and in no ledger. A check takes `layout.moduleWalkRoots` (module sources) or
`layout.sourceRoots` (the whole application tree plus each package), and `layout.keyOf` /
`layout.displayOf` for the two key shapes the ledgers already use — both byte-identical for a
tree that has not moved. The split half of `moved-module-tree.test.ts` is the proof: every
check in that file's list, over a fixture with some modules in packages and the rest in
`src/modules`, exits **0**, and over the same tree with one module's `package.json` removed —
nothing else changed — every one of them exits **2**. **Which** modules the fixture puts where
is a **pool** and not a roster, and a module leaving `backend/src/modules` for real therefore
costs no edit to it: the fixture relocates whichever pool members the application tree still
holds, counts the real module packages toward the same floor, and refuses — naming the pool —
when too few modules would sit outside the application tree for the split to stage anything.
The counts are printed by the run and are deliberately written down neither here nor in the
fixture (D-100); what is written down is the pool, because "this module carries no ledger key,
no `scripts/*.ts` entry point, no cross-owner permission gate and no overlay reach" is not a
property a walk can decide.

Both run in CI as GitLab's `quality:static` job — full tree, every MR and every push to
`master`. They need only bash, grep, perl and POSIX awk (no `pnpm install`), so keep them
free of gawk-isms and of anything that assumes a node toolchain. Neither script may pass on
an empty file list; both exit 2 when `git` is missing rather than reporting a vacuous green.

`pnpm run check:language` (Principle VIII) scans source-code **comments** and `docs/docs/**`
pages for Polish. It ignores cited terms — anything inside backticks, `"quotes"`, a fenced
code block, or (in docs) markdown emphasis — because an English comment routinely has to
quote a Polish UI label, currency rendering or expected test string. **If it flags you, cite
the term rather than translating it.** Two deliberate carve-outs exist:

- Polish proper nouns with no English form (state institutions, official registries, the
  Polish names of shipped features) live in the `proper_nouns` list in
  `scripts/check-language.sh`. Keep it short — a UI label is a citation, not a proper noun.
- An intrinsically bilingual page opts out with `check-language: allow-non-english` plus a
  reason, in its YAML front matter. Currently only the EN→PL glossary
  (`docs/docs/contributing/translations.md`) qualifies.

`pnpm run check:naming` (Principle VI) checks backend module folder shape, migration
identifiers, Zod contract keys, route segments and — since feature 081 — that a migration
**class name is scoped by its owning module** (`unscoped-name`; zero findings when it landed,
and it exits 2 on a tree that holds no migration rather than reporting a vacuous green).
Module folders are plural snake_case;
`_`-prefixed infra modules (`_i18n`, `_lifecycle`), singular named surfaces and vendor/
protocol proper nouns are allow-listed in `scripts/check-naming.sh`. A `z.object()` field
that must stay snake_case because it is **persisted verbatim** (a JSONB envelope with a SQL
column default, an external vendor's wire format) is marked with `naming:allow-snake-case`
plus a reason in a comment directly above the field — see `cmsContentEnvelopeSchema` in
`packages/contracts/src/cms.ts`. Do not use it to skip a genuine API-shape fix.

**Its module root is resolved, never spelled** (feature 080, T012), and since T040a it is a
**list of module directories** rather than one root. Three of the five rules walk the module
tree, and the path used to be written into the script eight times, so a tree that moved took
them with it: the rules iterated nothing, the other two reported on what was left, and the
script printed a green tick. `scripts/lib/module-root.sh` — the bash twin of
`backend/scripts/lib/module-roots.ts` — resolves it instead: the generated manifest index is
found by **name** anywhere under the checkout (T012 keyed on `<root>/_lifecycle/`, which stops
being where it lives once the index is host-owned), the ids come off its entry array rather
than off its import specifiers (a specifier is relative today and a bare package name
tomorrow), and a module's directory is the ancestor of a `manifest.ts` named after one of those
ids that either sits under the application's source root or carries a `package.json` of its
own. A repository with no index is exit 2 and one with two is exit 2 as well, rather than a
scan silently narrowed to whichever sorted first. If you are writing a shell check that walks
modules, iterate that list; do not add a ninth literal. Rule 1 is the one exception and says
so in place: it judges *names*, so its population is every directory that sits **where** a
module sits (`module_root_module_folders`), because a misnamed folder is the one the index does
not list. `read_size_module_coverage` takes the same directories, so its
`manifest-index:<covered>/<expected>` token counts a module that has become a package instead
of reporting the shortfall it exists to refuse. **`check:language` resolves it the same way**,
and did not until the nested-worktree repair below: it spelled the index path, so a moved tree
ended its run on "could not read the manifest index" — a refusal rather than #215's silent
green, but still a check that stops working for a layout change it should follow. The two are
one job and one pair of modes; deriving the population twice is two answers waiting to
disagree.

**"This repository" excludes a checkout nested inside it, and that is what makes the refusal
survivable here.** Agents in this project work in `git worktree`s created *under* the
repository directory, so from the main checkout the repo-wide walk finds one index per
worktree plus its own — eleven when this was measured — and `check:naming` exited 2 on every
local run while CI stayed green, which is to say it became unrunnable exactly where
verification happens. Pruning a nested work tree is not a weakening of the refusal: another
commit of this same repository is not this one's source, so scanning it means judging another
branch's tree and reporting the verdict as ours. **The discriminator is the `.git` entry**,
derived per run and never a path name — a rule keyed on `.claude/worktrees` would be a derived
fact written down (D-100) and would miss the first worktree somebody put elsewhere.
`git worktree list --porcelain` was the alternative and was rejected: the walk sees files, and
the `.git` marker travels with them while git's registry can disagree with the filesystem in
both directions; the registry knows nothing of a nested clone or a submodule; and it needs
`git` on `PATH`, which a sourced library cannot assume. What it cannot see is stated in
`scripts/lib/module-root.sh` — a checkout whose marker is elsewhere (`GIT_DIR`, a
`--separate-git-dir` whose gitfile is gone) reads as ordinary source and is walked, which is
the direction to be wrong in. Two generated manifest indexes in one checkout are still exit 2,
and `shell-checks.test.ts` proves both halves over real fixture trees.

### The full inventory

Every check that runs in CI, so a rule cited nowhere here stops being a rule nobody knew about
(issue #137 — `check:harness-teardown` had run in every pipeline since issue #111 while this
file had never heard of it). Run with `pnpm --filter backend run <name>` unless the row says
otherwise. `backend/test/unit/scripts/check-inventory.test.ts` is the machine-checked version
of this table: it enumerates every `check-*` script and fails on one it does not name.

| Script | Job | What it refuses |
| --- | --- | --- |
| `check:action-route-permissions` | `quality` | A manifest action whose `requiredPermission` is not the code enforced on its own `targetRoute` (issue #232; Principle XVI item 2). The permission inventory sweeps two directions — enforced ⇒ grantable, grantable ⇒ enforced — and **both** defects that produced this check passed it: `settings`' palette entry declared no code at all against a `settings:read` route, and `inventory`'s declared `catalog:write` against an `orders:read` one. Real codes, enforced somewhere, on the wrong route: a set sweep cannot see either. Three findings — **missing**, **mismatched**, and **unresolvable**, which covers a `targetRoute` no registration matches, candidates that disagree, and a `preHandler` it cannot read (that last one matters most: an unreadable gate taken for "ungated" agrees with everything). Agreement is **sufficiency, not equality** — holding the declared code alone must open the screen — so either member of `requireAdminAny([…])` passes and a conjunction of two guards passes for nobody; the codes are opaque strings, so `catalog:write` does not satisfy a `catalog:read` gate. The SPA `targetRoute` is linked to an API path by nothing in the tree, so the check reconstructs the **entry route** in three levels (exact, subtree, then the owning module's own routes, for a screen whose placement is not its API path), and flips to the create route for a `/new` target. `ACTION_PERMISSION_DISAGREEMENTS` is two-way and holds the three verb-labelled actions whose screen needs a read code to open and a write code to use — one field cannot say both, and the choice is the owner's. **And it refuses a run that read the wrong copy of the manifest.** The route half is source text, walked; the manifest half is *imported*, and a module package resolves through its own `exports` map at its build output (D-164) — so an action edited in `packages/modules/<id>/src/manifest.ts` and not rebuilt was a **false green**, measured three consecutive times on feature `specs/091-module-owned-admin-surfaces/`'s admin drain and most sharply on !1203, where `payu:read` → `payu:write` read `findings=3 violations=0` exit 0 before the package was built and `findings=4 violations=1` exit 1 after. Two more findings, both exit **2** rather than 1 — the tree is not in violation, the run could not see it (issue #113): **`stale-artefact`**, an emitted manifest whose source is strictly newer, and **`unpairable-artefact`**, one whose currency cannot be decided (not on disk, or no TypeScript source under the package's `rootDir` emits it) — because an artefact that cannot be decided must not be reported current. **No ledger, deliberately**: `pnpm run build:packages` is always available, so an entry could only license reading the previous build. Everything is derived from the package's own declarations — `exports` for where a bare specifier lands, `tsconfig.build.json`'s `rootDir`/`outDir` through a relative `extends` for how a source becomes an artefact — so `packages/modules` and `dist` appear in no predicate (D-100), and the subject is **the file whose bytes this run read**: a registry that named a package's *source* (the split fixture, a package that declares no build) has no staleness question and is not refused. The comparison is mtime and the tolerable error is stated: a source touched and reverted asks for a rebuild that turns out to be a no-op, because `tsc` emits no `sourcesContent` here and there is no content to compare. The `read:` line carries it as **`emitted-manifests:<n>/<n>`** — `files` counts the source text the route walk opened and says nothing about the manifests, which are imported rather than walked — and the token is *omitted* rather than printed `0/0` on a tree where every manifest came from source, that being the `no-expectation` shape `read-size.ts` refuses. The derivation is shared (`packages/cli/src/lib/emitted-freshness.ts`) because the exposure is not this check's: **19 of the 27 backend checks import a module package's `dist/manifest.js`**, and `check:port-dependencies` was measured taking its verdict from that content too. Only this check is wired to it; the rest are in the defect register. |
| `check:admin-zones` | `quality` | **The zone mechanism's two-way refusal, which its own contract promised from the day the enum landed and which nothing implemented in either direction** (feature 091, P4a; `contracts/admin-component-contribution.md` §5). All four of `AdminZoneNameSchema`'s opening members were rendered by no host and contributed to by no module — a place nothing mounts is a promise to a module author that nobody kept, and a contribution to it renders nowhere with no error anywhere. Five findings for that: **`unrendered-zone`**, **`contribution-to-unrendered-zone`** (reported per contribution as well as per zone, so the author who wrote it is named rather than the enum), **`unpublished-zone`** (a name the enum does not carry — `tsc` refuses it for a first-party host, this covers a host that is an installed package), **`computed-zone-name`** (refused rather than skipped: the refusal compares rendered names to declared ones, so a name it cannot read is a zone it would report as rendered by nobody) and **`missing-props-type`**, a member with no `AdminZonePropsMap` entry. Two renders of one zone are **legal and expected** — one member is many mount points — so multiplicity is not a finding. **No ledger for those five, deliberately**: the remedy is always available in the same merge request and it is either to render the place or to remove the member. The sixth is **`foreign-module-id`**: one predicate — *a module id written as a string literal, in a file the module does not own* — over three populations, and the tree is what says they are one thing (`OrderShipmentsTab.tsx` carries `useSurfaceVisibility()({ module: 'inpost' })` **and** `useTranslation('inpost')`). Nothing else in this estate reads either spelling: `check:module-boundary` reads import specifiers and a string names none, `check:admin-surface`'s subject is kit symbols, `i18n:hardcoded` reads literals and not scopes — which is how `CategoryTreePicker` shipped a whole phase rendering out of the `catalog` namespace and was found by a human reading an unrelated diff. A computed `useTranslation` in the kit is a **finding, not a skip** (issue #113), with the kit's own `src/i18n/useTranslation.ts` exempt by **exact path** — the `check:diacritic-folds` shape, never a filename rule. **Its three populations are `admin/src`, the admin-ui family and every module walk root the layout derives** — and the third arrived late, which is the part worth knowing. Renders and contributions came off `layout.moduleWalkRoots` from the day P4a landed while `foreign-module-id` read `admin/src` and the family and nothing else: one population when every admin screen was the application's, and a shrinking one from the first batch of Story 3 that moved a screen into its module's package. **How many module packages ship an admin layer is not written here** — `ls -d packages/modules/*/src/admin | wc -l` answers it, and the number that stood in this sentence was **37** against a tree holding **55**, measured 2026-09-03. It went stale in the paragraph whose entire subject is a population the check could not see (D-100, met in the act of recording a derived fact). The clause after it — *"and six batches will move sixteen more owners"* — was a forecast, and F6 closed on 2026-09-02, so it now describes a completed move as pending. A *packaged* module gating on another module's id or rendering out of another module's namespace was seen by nothing at all — the shape issue #215 is about, one surface over: the check was right when it was written and the tree moved. Found by the widening on the day it landed: `mod-settings`' `ConfigurationReferenceInput` gates on `credentials`, a **correct** Z12 gate written by the very batch that moved the file, unwatched from the moment it was written. Ownership is the layout's, never a directory name. For the admin application it is the route table and the nav (`scripts/lib/admin-surfaces.ts`), so a directory no nav entry claims is the application's and is judged as nobody's; for a module's own sources it is the `endora.id` a package declares about itself, the same statement the runtime discovery reads. A file no module owns is skipped rather than judged in both walks — the fail-closed direction with respect to *attribution*, since the alternative is filing a coupling under a module that does not own the file. `FOREIGN_MODULE_IDS` is two-way, keyed `<file>:<population>:<id>` and **never a line** (a line-keyed entry reds on any insertion above the site), with a `sites` count in `check:module-boundary`'s own shape; it empties inside this feature, and it drained twice before P4a merged — !1230's kit repair took two entries and the ratchet, not anyone's memory, said so. Exit 2 **eight** ways, one per input whose absence would leave a classification vacuously clean: no zone name, no props-map key, no host file, an enum with members and a walk with **zero renders and zero contributions** (the moved-tree shape, which would otherwise report every member as `unrendered-zone` — a finding about the walk dressed as one about the tree), no kit source, no `useTranslation` site anywhere (`check:subscribe-seam`'s worker-half reasoning), no module id from the index, and an admin application whose generated contribution registry names **no** module package, which is the module-admin floor losing its author. The `read:` line has **four** independent authors. `zone-enum:<n>/<n>` is `AdminZoneNameSchema` held against `AdminZonePropsMap`, and the check computes no list of zone names of its own. `manifest-index` is issue #215's shared floor. `admin-ui:<n>/<n>` is the admin-ui members other than the kit, added by P5b when the second one existed. `module-admin:<n>/<n>` is the floor that moved with the widened population, and it exists because none of the other three can see what it sees: `manifest-index` is satisfied by any file a registered module contributes, which for a module package is its backend sources, so a package's *admin layer* dropping out of the walk leaves it green, and `admin-ui` counts packages that are not modules at all — measured, by taking one package's `src/admin` away, which was `manifest-index:69/69` and `module-admin:36/37` when it was taken, exit 2 — the shortfall is the discrimination, and the two totals move with the tree. Its expectation is the generated admin contribution registry's, read as literal import nodes: a second program's answer to *"which packages ship admin code, and under which subpath"*, so nothing in the check spells `./admin` or `src/admin`, and the subpath's source directory comes off the package's own `exports` map. It is **omitted** rather than printed `0/0` where there is no admin application — `read-size.ts` refuses `expected=0` as `no-expectation` — and the omission cannot become the silent path, because a registry that names none while an application exists is the eighth refusal above. It carries issue #215's shared floor over its module walk and is still **not** in `moved-module-tree.test.ts`, stated rather than quietly omitted: that fixture is a backend tree with no admin application and no kit, so this check refuses both of those populations first and would exit 2 on the moved and the split tree alike — which asserts no discrimination at all. |
| `check:bundle-pairing` | `quality` | **A module that ships a bundle in any language ships one in every language the platform ships** (`specs/094-translation-boundary/contracts/bundle-pairing-ratchet.md`; the owner's ruling of 2026-09-01, § i18n above). It landed at **zero violations**, which is the argument for landing it and not against: the invariant was true and nothing held it there. The predicate is a **conditional** and that is the whole design — 7 of the 69 registered modules ship no bundle at all, correctly, because a module with no user-facing strings owes no translation, so the obligation attaches to the **first** bundle rather than to every module; a universal would be repaired by seven empty files whose only effect is to make the check pass. Four findings: **`missing-language-bundle`** (the centre), **`empty-bundle`** (a bundle parsing to zero entries — it satisfies a presence test while translating nothing, and is the way around this check that would otherwise be one `echo '{}' >` away), **`unparseable-bundle`** (a finding and **not** a skip: the boot reconciler logs and skips such a bundle and the module then renders raw keys, so a check that also skipped it would agree with the defect) and **`undeclared-bundle-dir`**, the inverse failure — files on disk under a module whose manifest declares no `i18n.bundlesDir`, so nothing loads them. **No ledger, deliberately**: every finding is a module one file away from compliance and an entry could only license shipping a single-language module, which is the thing the ruling forbids. Every set it uses is derived and none is written into it (D-100): the languages from `SUPPORTED_LANGUAGES`, so a third shipped language makes every two-bundle module a finding in the same run; the modules from the generated manifest index; and the **probe directory name** from the `bundlesDir` values the other manifests declare, since `undeclared-bundle-dir` is a finding about files nobody reads and a check spelling `'i18n'` into itself would answer for one convention and go quiet for the next. A module's bundles are read at `dirname(manifestPath)` — the anchor the `_i18n` boot reconciler joins, so the check reads the files the running platform reads. Exit 2 four ways, one per input whose absence would make the conditional vacuously true: no shipped language, no registered module, a **short module walk**, and **no bundle read at all** — that last one is the one a careless implementation omits and the one that matters most, because with a conditional predicate "nobody ships anything" prints `findings=0` honestly. Its module floor is a **conjunction** and both halves were measured failing on the fixture the other catches: the layout must *place* the module (which sees the half-moved tree — sources at a package address with the `package.json` withheld, where the directory is on disk and readable) **and** that directory must exist (which sees the moved tree, where the layout derives a host-resident root from the index's own `manifestPath` and places all 69 modules at directories that are not there). It does not judge key-level symmetry: that is `registered-bundles-shape.test.ts`, whose symmetry case this check is the missing **precondition** for. |
| `check:command-coverage` | `quality` | A sensitive write that neither runs a Command nor records an audit row (Principle XIII). `--strict` in CI, so a finding in any module fails. The vocabulary is `persist*`, `nativeUpdate`, `nativeDelete`, `remove*`, `flush` and — since D-89 — **`create`**, the last two only off an EntityManager receiver, because both are ordinary service vocabulary. It reads **call** shapes: a field assignment on a managed entity (`order.status = ref`) is a write the unit of work will flush and this check **cannot see it**, refused in writing rather than deferred, so its green means "no unaudited write of a shape this check can see" and not "every sensitive write is audited". The staleness half reports a `command-coverage-ignore` guarding nothing, and since D-89(c) a downstream write that carries **its own** marker no longer keeps a caller's marker alive. |
| `check:container-imports` | `quality` | A module importing the container library — a module sees `ModuleContext` and nothing else (feature 072, FR-032). |
| `check:default-language-prose` | `quality` | **A prose literal in a natural language other than English, outside a per-language structure, in a module's own sources** (`specs/094-translation-boundary/contracts/default-language-prose-check.md`) — the **second signal** for the owner's ruling of 2026-09-01, whose clause 1 is *English is the default*. It is a check of its own because neither instrument that looks like its home can hold it (D-8): `check:untranslated-delivery`'s predicate is *a delivery call that passes prose and no key*, and a `return`, an array push and a field assignment are none of them, while `check:language`'s scope is **comments** by constitutional design — Principle VIII permits a string literal in any language, and widening it would make every `{ en, pl }` map a violation. **It keys on the language of the string, never on how the string is carried**, which is the correction `specs/093-backend-delivered-prose/` forced: that survey named its population after three delivery *mechanisms*, mechanisms are unbounded, and **30 of the 36 sites it missed were shapes nobody had enumerated** — one of them in a file it had already read. Three findings: **`non-english-default`** (the centre), **`polish-default-behind-a-prop`**, reported apart because *"it has a mechanism"* is the exact reasoning that waved 18 `invoices` sites through once already and a distinct finding is what stops it happening twice, and **`unclassifiable-literal`**, a computed key on the path — a finding and **not** a skip (issue #113), because treating a path the analysis cannot place as exempt is the direction that agrees with the defect. **The exemptions are where it earns its keep and every one is decided from the syntax**, never from a filename (`check:diacritic-folds`' discipline): an enclosing property key that is a shipped language (`'pl-PL': { … }`, `pl: 'Przesyłka wysłana'`), an object that declares the language it is *written in* in a `languageCode` / `locale` field — the narrowing that keeps a seed row's `entryCode: 'en-US'`, which is its *subject*, from exempting it — and a file whose declared export name carries a language code. **Detection is Polish only, and the bound is declared rather than discovered**: a diacritic class plus a stopword list, both `scripts/check-language.sh`'s, with its `proper_nouns` list blanked first, held to the shell's own text in both directions by the companion test. Polish carrying neither signal is invisible (`'Nowa Organizacja'`), and so is a single-word literal outside the prop-default position — which is what keeps 30 Polish numeral words and a unit abbreviation out of the ledger, the position supplying in the one case what the token count infers in the others. Both exclusions from the stopword list are **measured**: `we` reported five English sentences, and one-letter `w` reported a `select w.id` join alias and seven `http://www.w3.org/` URIs against two real Polish sites. A module's `migrations/` is out, because an applied migration cannot be edited and a ledger entry over one would never drain. **`NON_ENGLISH_DEFAULTS` is sharded per module** under `backend/scripts/ledgers/non-english-defaults/`, two-way, keyed `(file, digest of the literal)` — a **digest, never a line**, so an insertion above the site does not red it and an edited sentence does — and it **arrives pre-populated**, because 46 sites over 41 keys stand today and a check that landed red would be reverted rather than read. Every entry names its literal, says what the site is, and says which case of `translation-boundary.md` § 2 its repair takes; it is expected to empty, and the entries that should survive are domain-mandated, the KSeF marking on a Polish invoice being the standing example. Exit 2 five ways — no shipped language, no registered module, a module walk that came back short, **no literal classified at all** (with an exemption-heavy predicate that state is *vacuously clean*), and **no detector for a shipped language other than English**, which is what makes the Polish-only bound a refusal instead of an implied coverage claim. The `read:` line's second author is `SUPPORTED_LANGUAGES`: `detected-languages:1/1` today, and a third shipped language makes it `1/2`, which the shared reporter refuses as a short walk. |
| `check:diacritic-folds` | `quality` | **Three signals over one population: this repository folds diacritics, and builds a slug, in exactly one place.** (1)+(2) A diacritic fold written outside `packages/contracts/src/text-normalization.ts` (issue #240). `normalize('NFD').replace(/\p{Diacritic}/gu, '')` reads as complete and is not: `ł` is a standalone code point with no canonical decomposition, so NFD leaves it where it was and the strip removes nothing. Four private copies had grown by !745 — typing `naglowek` found no block named `Nagłówek`, and `platnosci` found no `Metody płatności` in any picker. It refuses the **decomposition**, not "a decomposition followed by a strip": a proximity window is escaped by moving one line into a helper, and half a fold is still a second implementation. So a literal naming `NFD`/`NFKD` (`NFC`/`NFKC` compose and are outside the rule), and a combining-mark class in any of four spellings, including the U+0300–U+036F range written as raw characters, which a grep for `\u0300` cannot see. (3) **`slug-run`** — a `.replace()` collapsing a run of non-ASCII-alphanumerics to a separator, i.e. slug construction, which since issue #245 also has one owner (`slugify`, same file). It exists because signals 1 and 2 had **a population defined by the presence of the thing they check** (issue #244): a site that folds nothing writes no `NFD` and no `\p{Diacritic}`, so its absence was undetectable, and two slug builders shipped that way for a year — `Żółw` produced `w`, `KAT_ŁĄCZNIKI_01` produced `kat-czniki-01` — while the check printed `violations=0`. The third signal keys on the **builder**, which is present whether or not the site folds, so the rule is *"slug construction has one owner"* and **not** *"a slug builder must fold"*: the second would need dataflow the expression cannot carry, and the first caught `BlogPostEditor`, a ninth private copy that folded perfectly and was invisible to everything. The **run collapse** is what keeps that population honest, and it was measured rather than asserted: any negated ASCII-alphanumeric class matches 9 sites and 7 of them legitimately need no fold (a payment hash seed, an XML element name, a DOM `id`, a Meilisearch index name, a test database name), which would be a ledger that is mostly exceptions; requiring the collapse leaves 4, of which none is an exception. Two spellings — quantified in place (`[^a-z0-9]+`) and collapsed by a later `.replace` **in the same call chain** (`.replace(/[^a-z0-9_]/g, '_').replace(/_{2,}/g, '_')`); the window is one expression and stops there, in the idiom of `check-port-catches`. It cannot see a computed class, a builder written with `split`/`join`, a collapse split across two statements, or a bare `[^a-z0-9]` with no collapse at all — each stated in the header rather than discovered later. All three signals read literal **AST nodes**, so the files that quote the wrong one-liner or the wrong chain to say why they do not use them are out of the population by construction. **The population is the whole tree** — `admin`, `backend`, `storefront`, `packages` — since the fold was extracted as `foldDiacritics`: it had been correct and reachable all along, but it was named `normalizeOrganizationName`, so six authors wrote their own instead of finding it. Out: `backend/scripts` and `backend/test/unit/scripts`, whose job is to spell the shapes the rule refuses. The helper's exemption is one exact path, never a filename rule (issue #197) — there are two files called `text-normalization.ts` and only one is exempt — and that same path is the vacuous-pass guard: a helper that is gone, or that no longer parses as **all three** shapes, is exit 2, the third because `slugify` is the import every `slug-run` message tells the author to use. **Two ledgers, both per-file two-way count ratchets**, because they answer different questions and one count over both kinds would make "never raise a number" ambiguous. `DIACRITIC_FOLDS_ALLOWED` is **empty**: it opened with four slugifiers, !753 repaired the admin pair and issue #245 the backend pair, under one owner ruling — new values are to be correct, historical ones are not migrated. `SLUG_RUNS_ALLOWED` holds **two**, both `pim_ergonode` key derivations, and neither is an exception to the rule: both are the same defect deferred because they are **lookup** keys re-derived on every import run to find a row a previous run created, so a repaired derivation grows a second attribute beside every Polish-coded one rather than fixing it. That is what #245's ruling does not reach, and it is the retiring condition. An entry that ever says "this is not a slug and needs no fold" means the predicate has outgrown its population — narrow it, never add the entry. |
| `check:doc-snippets` | `quality` | A code block marked `<!-- verbatim-from: <path> -->` that no longer appears verbatim in that file. The quickstarts are copied by every module conversion, so a stale snippet is a defect scheduled for mass production. Its population is the **documents**, not the module tree they cite — a cited file that moved is a finding, so #215's silent green cannot reach it from that direction. It can from its own: `docs/docs` holds 92 of the 943 markdown files and one of the seven citing documents, so a docs tree that moved left a run reporting six documents checked and exiting 0, comfortably inside the read-size band. The floor is therefore per declared root — each of `docs/docs` and `specs` must contribute a file, or exit 2. |
| `check:entry-presence` | `quality` | A module-owned `setInterval`, self-rescheduling `setTimeout`, `process.on` handler or **working `ctx.onBoot` hook** that does not decide presence before it works (issues #126, #146). A contribution hook passes silently; one that mixes work with a contribution is reported as `mixed-boot-hook`, and its remedy is "split it first", never "probe the top" — probing a mixed hook stops the contribution too. Non-deactivatable modules are out of the boot-hook population, derived from their manifests through `scripts/lib/switchable-modules.ts` (shared with `check:port-catches`). `TIMERS_WITHOUT_PRESENCE` and `BOOT_HOOKS_WITHOUT_PRESENCE` are two-way and are not expected to empty. |
| `check:entry-scope` | `quality` | A non-HTTP entry **site** that does not establish its scope explicitly (feature 072, FR-020). Six classes: a CLI script and a declared program (one site per file — the file's own top-level execution), and one site per `new Worker(...)`, per repeating timer, per `x.on('message', …)` and per `process.on/once(...)`. It classified **files** until issue #237, and a file reported `scoped` the moment one of its entry points was right: that is how `kernel/lifecycle/registry-cache.ts` hid a scope-less database read in a pub/sub handler behind a correctly wrapped `setInterval` 130 lines below (issue #235), and how `kernel/container.ts`'s shutdown handler stayed outside the population altogether — it is under no `scripts/` directory, is no declared program, constructs no `Worker` and starts no timer, so no file-level class contained it. A site is scoped when a sanctioned entry function is called in its own callback or **one hop** into a function bound in the same file; deeper, an imported delegate and a `this.<method>()` delegate all read as unscoped, which is the direction a blind spot has to fail in. The population's second source is issue #228's: every `src/**.ts` path a `backend/package.json` script runs, because the shape classes were written from what the tree held when FR-020 landed and `src/seeds/dev-catalog-seed.ts` was none of them. `NO_SCOPE_NEEDED` is keyed `<file>:<enclosing name>:<construct>` — line-independent, two-way — and it prints `sites=` and `files=` so a widening that moved no population size is visible as having moved nothing. Exits 2 on an empty declaration source, on a declaration that resolves to no walked file, on no site at all, and on no worker/timer/handler site at all — the file-level classes keep printing numbers while the syntax walk is blind. |
| `check:error-translations` | `quality` | An operator-visible error code with no sentence in both shipped languages, and (P2, D-127) a sentence written where the routing table does not look. The envelope replaces the message wholesale, so a missing key renders the raw code and nothing reports it. Ledger may only shrink; P2 has none, deliberately. Its bundle half **is** a module walk, and the floor is the modules `ERROR_TRANSLATION_KEYS` routes a code to — 18 of the registered 66, derived per run from two static imports. It was marked "not a module walk" until feature 080's T010 on the ground that a residue is loud rather than green: it is, and loudly wrong — emptying any one routed module's bundle reports between 2 and 41 codes as untranslated, which sends an author to write sentences that already exist. The walk itself stays a listing of `src/modules` rather than a resolution of the index, because P2 asks whether every sentence written **anywhere** is reachable and a bundle left behind by a dropped registration is exactly that question. |
| `check:fixture-substitution` | `quality` | A test that turns "the row is not there" into a value that looks like data (issue #159). Six files carried `(await em.findOne(SalesChannel, { systemDefault: true }))?.id ?? ''` and were green only because another file's `setupBackendServer` had created the channel first. Sees both shapes (two-step and inline) and the fabricating fallbacks — a string, a number, `randomUUID()`; `?? null`, `expect(x ?? null)` normalisation and a fallback that *creates* the fixture are outside the population, because each keeps the absence visible. Since issue #275 it also sees the **binding shape**, which is a third axis and was the blind one: `const [channel] = await em.execute(…)` bound no name, so the `??` under it was rooted in nothing and the file read clean — two live sites defaulted the system-default channel's language and currency that way, on a row D-47…D-51 says always exists. The dialect was never the gap (`execute` and `getConnection().execute` were in the vocabulary from the start, and the same destructuring hid an ORM `find` just as completely); the one dialect that was, a `getKnex()` builder chain naming no read at its tail, is closed with it. It follows receivers and callees and **not arguments**, so a read inside `Promise.all([…])` is invisible, and it does not follow a read through a helper into another file. `DEFAULTED_FIXTURE_READS` is two-way and is not expected to empty: an entry says why the fallback is right. |
| `check:harness-teardown` | `quality` | A test that releases a `setupBackendServer` resource itself instead of calling `teardownBackendServer` (issue #111). A hand-written teardown is a copy of the seam frozen when it was copied, so it cannot learn about the awilix container or the pub/sub Redis client, and both leak for the length of the single-fork run. `HAND_RELEASED_RESOURCES_TO_DRAIN` is an empty two-way ratchet. |
| `check:kernel-boundary` | `quality` | An ORM relation from a module into another module; a module may relate into the kernel, the kernel into neither (feature 072, D-32). |
| `check:lock-claims` | `quality` | A reason string asserting a lock the manifests contradict (issue #216). D-100 forbade the shape in acknowledged-edge reasons because a hand-written copy of a derived fact goes stale silently; it was found twice more within a day, once in a **ledger shard**, which D-100 does not cover — so the prohibition holds for **any reason string anywhere**, enforced by derivation. The locked set comes from `scripts/lib/switchable-modules.ts` on every run, never a list: un-lock a module and every sentence resting on the lock goes red in the same pipeline, with no ledger to edit. Two signals — a lock claimed over a module that has an activation control (the shape that withdrew a written port conversion, its load-bearing step spelled *"is always present"* without ever writing the word), and switchability claimed over a locked module (`catalog` carried one for `price_lists` across two features). The population is the artefacts whose job is to carry a reason: ledger shards, the ledgers that live inside a check, every module manifest — comments included, since that is where the #216 claim sat — and, since issue #279, **`packages/contracts/src/**`**, because a published port's doc block is where its "when the owner is switched off" paragraph belongs and it is written about another module: a hedged one got written on the author's own judgement, and the unhedged alternative would have passed silently. **How many named-subject claims stand is not written here** — the run prints `sites=`, and the number in this sentence was stale within a day of being written (D-100, met in the act of recording a derived fact). None was stale when the population widened, so the widening cost no repair — what it removed was the dependence on an author being careful. A claim must **name its subject** as a backticked module id; a pronoun subject (*"this module is…"*) is out of the population by construction, and ordinary source comments are out by decision. **No ledger, deliberately**: a claim the manifests contradict is never right to stand, so an entry could only license re-opening it. Exit 2 six ways — no artefacts, an index that would not load, no module ids, an empty locked set, (issue #215's shared floor, since the manifests *are* a module walk) a walk that came back short of the modules the index registers, and a **contracts** walk that came back short of the files `packages/contracts/src/index.ts` re-exports. That last floor is derived the same way the module one is, from the package's own barrel rather than from a number, and is printed as `contracts-barrel:<covered>/<expected>`. |
| `check:module-boundary` | `quality` | **Two predicates, one ledger, and three source populations.** (1) A module naming an import specifier that resolves into another module's directory (Principle I; feature 075). Every specifier shape, `import type` included — it is 43% of the debt, and ESLint's `prefer: 'type-imports'` would otherwise launder value imports into it. **Its population includes module-owned *admin* code** (feature 091, FR-017), and it does so **before** the first admin directory moves, which is the whole point: `module-package-layout.md` §0 measured that rewriting a ledgered relative import as a package specifier *deletes* the reach from the walk, whereupon the two-way ledger calls the entry describing it stale — 72 admin reaches would have gone that way, one directory at a time, in the direction that looks like progress. Three things about that half. The `@/` alias is expanded, because 67 of the 94 raw cross-directory sites are written with it and a relative-only resolver reports the rest as third-party imports it cleared. **The directory name is not the module id** — `AppShell.tsx` attributes `/warehouses` to `module: 'inventory'` — so ownership is read from the route table and the nav (`scripts/lib/admin-surfaces.ts`), never from `basename`, and a directory no nav entry claims (`_shared`, `home`, `platform`, `profile`, `cms_pages`) is the admin application's and is judged as nobody's. And identity there is the **module**, not the directory, because one module owns two surface directories; comparing directories reports `inventory -> inventory` as a violation nobody can ledger. The admin root is derived from the one workspace member declaring a `"@/*"` tsconfig path — zero or two is exit 2 — and a run whose ledger names `.tsx` files that are still on disk while that derivation answered nothing is exit 2 too, because the coverage floor is derived from the very thing that went missing. **(1b) The admin *application* is a consumer too** (feature 091, P1). A reach between two modules leaves out a file the module root does not attribute, which is right for the file and left nine files under `admin/src/components` recording nothing at all — `IdleLogout.tsx` takes `settings`' admin API client and was in no ledger anywhere. That is the shape with the *worse* failure mode: a ledgered reach rewritten as a package specifier goes stale loudly, an **unrecorded** one is rewritten and nothing goes red, because there was no entry to strand. So `admin/src` outside the module root is walked and a reach out of it is attributed to `host` — the owner `ADMIN_HOST_OWNER` spells in `packages/cli/src/lib/admin-surfaces.ts`, which is where it was moved so that it would outlive `check:admin-registrations`, deleted with its ledger by feature 091's Phase 5 T5 — with a shard of its own. Three properties, each of them the design rather than a detail. **Source side only**: the target position keeps asking for a *module*, because attributing the host at both ends would turn every module→host reach into a finding — roughly 1700, into published kit surface, which is `check:admin-surface`'s population. **The three registries are out**, named by the layout and never spelled in the check: `App.tsx` imports one component per module screen, so ledgering it would record Story 3's own subject as its debt, and `modules.generated.ts` is a generated composition root doing its job. **`_shared` stays out deliberately** — where that directory goes is an open owner decision (`plan.md` § *Phase 4* P5), a ledger cannot answer it, and giving it a module id would put a false owner in an artefact three checks read; the 21 sites are in no ledger and `research.md` §6.6 is where that is written down. Two floors of its own: exit 2 when the admin layout resolved and the host walk opened **nothing** (the route table and the nav both live there, so an empty host walk is a broken one), and a `sources=admin-host:<covered>/<expected>` token whose expectation is the host files the **ledger** names and that are still on disk — reported only while there is host debt, since `expected=0` is a refusal in this grammar. (2) A module naming another module's **table** (feature 077, D-87) — 121 such reaches stand today, invisible to predicate 1 because SQL names no specifier, and a `violations=0` that cannot see them licenses a package split that is 121 couplings short of true. It reads a table identifier **two ways**: a SQL **statement** in a string or template literal, and a knex query **builder** (issue #187), which names its table as a call argument and so was invisible to the statement path too — ten reaches in six files, including the channel→warehouse join inside placement. The builder's method list (`from`, `into`, `table`, the join family, plus the knex callable itself, recognised by its `getKnex()` binding) is **enumerated**: `where`/`select`/`orderBy` take columns, and matching any string on any method would fill the ledger with them. The table→owner map has **three sources and needs all of them**: `@Entity()` table names (220), `create table` DDL (21 more, every join table and every `sales_channel_*` bridge among them), and — since feature 080's T034 — the tables an **installed extension package** owns; a core-block table is attributed to the module that owns the table its name begins with. The third source is read out of the artefact the platform composes (`scripts/lib/package-declarations.ts`: the `./backend` export's `entities`, plus the `create table` literals beside its `./migrations` entry point), because a published package ships compiled output in which the decorated source text is gone — a source-text probe of one finds nothing and reports clean. It answers **two ways and no third**: readable in full, or unreadable and named, which is exit 2. So `package pass=0` means "no package is installed", never "a package was installed and said nothing". Where the tree and a package declare one table the **tree wins**, for the reason the entity pass wins over the migration pass: it is the declaration this repository can change. The predicate reads literal **nodes**, so a comment is out of the population by construction. The ledger is **sharded per consumer module** under `backend/scripts/ledgers/cross-module-imports/`, so a cut touches one file; it fails eight ways — unledgered reach, stale entry, empty shard, orphan shard, entry filed under another module's shard, a `permanent: true` entry with no retiring condition, an entry whose **recorded count** disagrees with the walk (issue #267), and a shard that **declares an entry type of its own** (issue #217). The last one is what makes the sixth reachable: 29 of the 33 shards were typed `Readonly<Record<string, string>>`, in which a permanent entry is a type error, so a co-transactional seam could claim permanence in prose only — it counted toward `ledger-size` as debt nothing would drain and the retiring-condition rule had no field to run on. The declared type is read from each shard's own source, since the imported value has already lost it. The key is `(file, target)`, which answers "is this file already known to reach that target" and not "how much", so an entry also carries a **count**: `{ sites, reason }` where the file reaches its target more than once, a plain string — meaning one — where it does not. It is **omittable** because 60 of the 68 keys covered exactly one reach when it landed, and the default fails closed; both directions fail, a count below the walk being the reach nobody was asked about and a count above it the stale entry one granularity down. A permanent entry carries it on the same terms, permanence answering why an edge stands and never why it stands twice. `ledger-size` is derived and printed, never written down, covers both kinds, still means **keys** (the cut that retires an entry removes every reach under it; the site total is printed beside it as `(sites=…)`), and excludes the permanent entries: an edge a foreign key holds co-transactional is not debt (D-77), so it is declared `{ permanent: true, reason, retiredBy }`, printed separately, and refused if `retiredBy` names the sweep. **A reach into a module package's contract surface is not a reach** (D-171): T050 gave a module package a type-only `./ports` subpath so a published port interface has a home, and this check went on counting a consumer's `import type` from it exactly as it counts one from `<pkg>/backend` — so publishing the interface gave it a supported name and did **not** retire the ledger entry D-169 says the conversion removes. The designation is derived from the artefact every run and written down nowhere: **a subpath is contract surface iff the module it resolves to exports no runtime binding**. `./ports` emits `export {};` → exempt; `./backend` exports `registerModule` and `entities` → reach; `./migrations` exports `migrations` plus the named classes → reach; the root exports `manifest` → reach. It fails closed — a `const` on `./ports` makes the reach count again in the same run T050's guard goes red, an undeclared subpath stays a reach, and a later `./types` is exempt automatically while a `./services` is not — and the predicate is **one function** shared with that guard (`scripts/lib/emitted-exports.ts`), never a second copy. A named list in the layout contract was refused as D-100 and a field in the package's own `endora` block as a self-certified exemption from this check's ledger, issued by the measured party. `surfaceOf` is **not** the seam: it answers `'port'` for any path holding a `ports` segment, a relative `services/ports/foo.ts` included, which is right for a remedy sentence and wrong as a boundary decision. And "retire by reclassification" is structurally unavailable — a bare specifier is the only thing that has a subpath, so reaching the exempt state takes three separable edits, each in the diff. Exit 2 when **either** owner-map pass resolves zero tables — a half-blind map reports fewer findings rather than an error (issue #113) — or when a module package subpath a module reached has an emitted module the check could not read, which must never become an exemption. **(3) A migration's cross-module DML** (feature 097). The `sql` predicate excluded `migrations/` outright and its header sent the reader to `test/unit/db/fk-dependency-drift.test.ts`, which reads **DDL** and holds no `insert`, `update`, `delete` or `select` anywhere — so 76 cross-module DML accesses in 28 migration files were judged by nothing at all. The exclusion is **narrowed**, not deleted: what a migration is out of is this predicate's *every reach is debt* rule and its ledger, not the population. Two findings, kept apart so that R2 cannot go blind behind R1's red for the 21 of 37 writes whose module does declare its target (issue #130's shape): **`undeclared-migration-table-reference`**, a table reference whose owner is not in the declaring module's transitive manifest `dependencies` closure, and **`migration-writes-a-foreign-table`**, a write, whether or not the first holds. One statement may produce both. The closure is `scripts/lib/manifest-dependencies.ts`', extracted from `fk-dependency-drift`'s own `closureOf` so the DDL and DML halves of one rule cannot answer differently for one edge. The kernel is outside both, from the owner map's answer and never a table list — it cannot appear in a `dependencies` array, and a written list would go stale the first time the platform relocates a table, fail-**open**. Two ledgers, sharded per consumer module and two-way over the same eight failure modes: `migration-undeclared-references/` arrives with **one permanent entry** (`organizations → customer_accounts`, a 2-cycle no declaration can express, in a migration below `BASELINE_THROUGH`) plus the one this feature's own repair retires, and is not expected to empty; `migration-foreign-writes/` arrives with 21 keys over 37 sites in 13 shards, each naming the seam its repair takes, and **is** expected to drain. No `permanent: true` over historical migrations as a class and no timestamp watermark: the undeclared population is 4 accesses, not 141 migrations, because 55 of 59 module-targeting accesses already sit inside their module's closure. Four more exit-2 ways, and the first is the one that matters: **no migration file opened at all**, because the `manifest-index` floor is satisfied by any file a registered module contributes and a module's backend sources are plentiful, so a `migrations/` walk that stopped resolving leaves every other number intact; plus a migration walk **short** of the registry, a manifest graph in which nothing declares anything (an empty closure makes R1 fire on everything), and a missing — as opposed to empty — ledger directory. The `read:` line gains `migration-registry:<covered>/<expected>`, whose expectation is the module-owned migration classes `backend/src/db/migrations-registry.generated.ts` registers: a second program's answer, since the generator finds migrations by walking directories and this check finds them by path. It gains `sites=` with it — this check printed none until now — as the sum of the import specifiers and the table references it examined, with an exit-2 floor on **each** addend, which is how a sum over two populations is stopped from hiding the one that went to zero. |
| `check:module-docs` | `quality` | **The documentation navigation describes the modules the platform composes** (`specs/100-module-owned-documentation/contracts/docs-registry.md` §3). A check of its own rather than an arm of `overlay:check`, and the difference is measured rather than aesthetic: that one asks whether each artefact is what the generator would emit, and **a generator that correctly emits a sidebar for the 62 modules it can see agrees with itself perfectly** while eight written pages are reachable from no navigation. That was the tree on 2026-09-03 — three hand-maintained lists over one population (the sidebar's 70 refs, the module map's 51 rows, the 66 slugs on disk), all three disagreeing with the manifest index's 71 and with each other: **8** pages a reader could only find by guessing a URL, seven of them whole modules; **23** registered modules with no map row; **4** slugs naming no module. Nobody chose any of it, and nothing in the repository could see it — Docusaurus's own `checkSidebarsDocIds` enforces one of the two directions and ran in a build that existed in no CI job. Five findings. **`undocumented-module`**, whose whole design is that **absent and `docs: false` are not the same state**: `false` is a decision and owes nothing, absent is a module nobody has decided about, and collapsing them is how a conditional obligation becomes empty files that exist to make a check pass (`check:bundle-pairing`'s argument, one population over). **`orphan-page`**, asked against the **committed** artefact and never a fresh render, because a render agrees with itself. **`unlocated-page`**, a page under the modules category the walk cannot attribute — **no ledger, deliberately**: a page nothing attributes is the state that produced the eight orphans, so an entry could only license it, and it is a finding and never a skip (issue #113). **`unpaired-index-row`**, both directions, no ledger, each one regeneration from compliance. And **`stale-page-alias`**, the two-way half of `PAGES_ATTRIBUTED_BY_ALIAS` — the declared attribution for the four slugs that name no module, which exists because nothing derives them: a heuristic could be written to fit three of the four and would be a population defined by whoever wrote it (issue #244). It is an attribution **input** and not an exemption, and the distinction is load-bearing: a page with no alias and no matching slug is still `unlocated-page` with nothing to write that makes it pass. Every entry names its module, says why the slug disagrees, and names `spec.md` Q2 as the owner question that retires it. `MODULES_WITHOUT_DOCUMENTATION` arrives holding six; `PAGES_OUTSIDE_THE_NAVIGATION` arrives **empty**, because the generator reaches every page — pre-populating it would have written eight entries stale in their own merge request. Both are keyed `(module id, page slug)` and never a repository path (R4.1): Phase 2 moves 78 pages one module at a time, and a path-keyed entry goes stale on every batch, in the shape AGENTS.md records for `module-removal.test.ts`. Exit 2 six ways, one per input whose absence would make a predicate vacuously clean: no registered module; a module walk that came back **short** (issue #215's shared floor, asked **first**, so a moved tree is named as one rather than answered *"no workspace member holds a Docusaurus configuration"*); no site to resolve; **no page read at all**; a sidebar artefact naming no page (`orphan-page` compares pages to entries, and zero entries reports every page as an orphan — a finding about the walk dressed as one about the tree); and a module map holding no readable row. Plus `stale-artefact` / `unpairable-artefact` from `emitted-freshness.ts`, because `docs: false` is read out of an **imported** manifest and a module package resolves at its build output (D-164). The `read:` line has three authors — `manifest-index`, `sidebar-entries` (the committed artefact's own entry count, the only one that can see it render to nothing; its expected and covered are the same number **on purpose**, a sidebar missing one entry being `orphan-page` and not a blind run) and `emitted-manifests`, omitted rather than printed `0/0`. What it cannot see is in its header: front matter is a leading `---` block read as `key: value` lines, a doc id is a file path so a page overriding its own `id` or `slug` is followed for neither, and it says nothing about whether a page is good, current or complete. |
| `check:nul-bytes` | `quality` | A raw NUL byte in a source file (issues #182, #190). Git classifies a blob carrying one as binary, so every diff of that file renders as `Binary files differ` — the artefact that would reveal the byte is the one the byte switches off, which is how six files kept a raw NUL in a template literal through every review of every commit that touched them. The separator is right in all six; only its **spelling** is wrong, and `\0` compiles to the same byte, so no digest and no map key moves. Reads the **whole file**, not git's own first 8000 bytes: one of the six sat at byte 8032 and git itself still called it text. The population is everything under the repository root minus two *declared, reasoned* exclusions — `SKIPPED_DIRECTORIES` (trees that are not this repository's source) and `BINARY_EXTENSIONS` / `BINARY_FILENAMES` (file types that are bytes by definition). Deny-list on purpose: an allow-list of known-text extensions leaves the next `.sql` or extension-less script silently unscanned. `NUL_BYTES_ALLOWED` is an empty two-way ratchet, and hard to add to — a hostile-input fixture does not qualify, because `'\x00'` and a raw NUL build the same string. |
| `check:off-state-coverage` | `quality` | **A module with an activation control that is the argument of no `expectModuleAbsent` call** (Constitution XVII item 6; `specs/073-lifecycle-gating-completion/contracts/off-state-coverage-ratchet.md`). The strongest argument in the estate for an instrument, because the population was derived **by hand three times and gave three different answers** — 15, then 23, then 20 — and both careful attempts were wrong *in both directions at once*: they credited modules holding a partial proof while charging `payments`, which is asserted from its six consumers and from no file under `payments/`, and both missed `customers`, whose only mention is under `_admin_surfaces/`. **Both keyed on the path a test file sits at, and that is the defect**; the predicate here is the call **argument**. Nine files sitting in a module's own directory name a *different* module, so a path predicate is wrong in both directions by construction. **`expectModuleAbsent`, not `withModuleOff`, and the difference *is* the tiering**: the second is a state seam a palette test, a consumer's fail-closed test and an *exemption* test all use, and only the first asserts item 6's five things at once. A module named exclusively by `withModuleOff` has an off-state mention and no off-state proof — the residue feature 073's F5 drained — and that state is reported as `uncovered-module` rather than as a finding of its own, because two findings for one condition are two numbers waiting to disagree. Its sites are still walked: they are what `sites` and the harness-export floor are computed over. Six findings: **`uncovered-module`** (the centre), **`unresolvable-subject`** (a **finding, never a skip** — issue #113: reading an unreadable subject as "some module is covered" is the direction that agrees with the defect), **`unknown-subject`**, and the ledger's three — `stale-ledger-entry`, `orphan-ledger-entry`, `ledger-entry-without-a-reason`. **The resolver is load-bearing** and its shapes are the ones the tree writes, measured rather than guessed: a string literal, a file-local `const` resolved **lexically** (`off-state-harness.test.ts` shadows one `CORE` with another and a file-wide map answers one of them for both sites), a member of an object literal, and a loop or table binding — `for…of`, `.forEach`, `.map` and **`it.each(TABLE)(name, cb)`**, which is the shape the sixteen `_admin_surfaces/batch-*-palette-off-state.test.ts` files use and the one a naive resolver misses. Dropping the `each` shape alone loses four subjects and turns nine correct sites into findings that are not there. A table it cannot read **in full** resolves to nothing: partial resolution credits the members it read and says nothing about the rest. Two exemptions, both **derived from the artefact and neither a path**, because a path exclusion is the very defect this check replaces. A **synthetic** module a file builds for itself (`fixture_gated`, `demo_carrier`) is excused when that same file seeds the id into the registry cache in literals the analysis can read — a seeding through a name it cannot read excuses nothing, which is the fail-closed direction. And a **per-deployment overlay module** is excused from `unknown-subject` and kept **out of the population**, because the generated index is bare core under every value of `DEPLOYMENT` (D-104) and an overlay's off-state proof is a per-deployment concern, exactly as its permission inventory is. One file is out of the caller walk by **exact path**: `backend/test/helpers/off-state.ts`, which *declares* the two names and is not a caller of them — and that path is already the subject of the fifth refusal, so a harness that moved is a refusal rather than an exclusion matching nothing. **`health_checks` falls out by derivation, not by an entry**: it declares no activation block and every route it owns is ungated through `ctx.ungatedRoutes` (D-36b), so there is no seam an assertion could drive; that its class has one member is pinned independently by `test/unit/_lifecycle/non-deactivatable-set.test.ts`, and writing it here would be a derived fact copied into a second place (D-100). The 24 locked modules are excluded for the measured reason that including them would land the check with 21 findings — a ledger that starts full is a ledger nobody drains and a number somebody eventually raises. `OFF_STATE_COVERAGE_EXEMPT` is two-way and **landed empty**, all 46 switchable modules proven, which is the cheapest moment to lock an invariant and the only moment at which a ledger is empty on the day it arrives. An entry is subject to `check:lock-claims`; an entry reading "this module has no admin surface" means the predicate has been misread — a "none" is answered in the test file's doc block, never by an exemption from having a proof. Exit 2 six ways, one per input whose absence makes the predicate vacuously clean, and the dangerous silence here is **not** an empty walk (which reports 46 findings, loudly): an index that yields no module; no module declaring an activation control; a caller walk that opened no file; **a walk that resolved no `expectModuleAbsent` site**, the load-bearing one, which would otherwise be a finding about the walk dressed as a finding about the tree and send its reader to write 46 test files they do not need; a harness that is not at its exact path or no longer exports both names; and a harness that grew a **third** assertion helper, which is `harness-exports:2/3` and the shared reporter's short walk. Two independent authors on the `read:` line and no list of its own: `manifest-index:<classified>/<registered>` and `harness-exports:<recognised>/<exported>`, the second read as literal export declarations from the harness's source — exported *types* are not counted, or the floor would be 2/5 and refuse every run. Not in `moved-module-tree.test.ts`: its population is the manifest index and its walk is `backend/test/**`, both of which a moved *module* tree leaves intact, so that fixture would assert no discrimination — its own moved-tree cases are the third and fifth refusals, proven directly. |
| `check:platform-surface` | `quality` | A module naming an import specifier that resolves to platform surface the host does not publish (D-160.8). `specs/080-f4-real-scope/contracts/host-package.md` §1 classifies all 53 platform files a module reaches as **P**, **A** or **O**; three delivered rows build on that classification and nothing enforced it — `check:module-boundary` is module→module, `check:kernel-boundary` is ORM relations, and the `exports` map D-160.7 rules enforces nothing for the modules still in `backend/src`, which is all of them. The verdict is per **symbol of a named file**, not per file: !883 measured sixteen symbols of **P** files that no module takes and that are deliberately unpublished, so "the file is P" would license `SettingsCache`, `decryptSecretValue` and the LRU tuning constants along with the symbols the classification names. Per-file would also be wrong in the other direction — it would refuse the eight symbols §8 publishes *out of* **O** files (the four settings errors, `parseHostMap` / `ResolverError`, the two membership shapes), because a `@throws` a caller cannot name is a method a caller cannot call. Whether a symbol belongs on a barrel is a different question and stays `test/unit/kernel/published-surface.test.ts`', which holds each barrel to §1.3 in both directions; **both read the barrel through `backend/scripts/lib/platform-surface.ts`**, so the two cannot come to disagree about what it says. Five findings — `unpublished-symbol`, `whole-file-reach` (a namespace or side-effect import names no symbol, so it takes the file's internals whatever they are), `unresolvable-reach` / `unattributed-source`, which are #215 one layer in (!879): a file the `read:` line counts and nothing judges is a finding, never a skip — and **`unpublished-subpath`** (T060), a bare specifier into the host naming a subpath its `exports` map does not declare, the root export among them. `node` and `tsc` refuse that path today too, which is not a reason to leave it unjudged: widening the map is its obvious repair and the whole of D-160.8 is that the map is not widened quietly. Plus a **refusal**: a barrel with an `export *`, a namespace re-export or an `export { … }` with no `from` is exit 2, because a short published set reports *more* findings and its obvious repair is to widen the barrel. Every path — source, target, ledger key — is repo-relative, one namespace, because `layout.keyOf` has two bases and a resolver straddling them lost 90 reaches on the split-tree fixture. **Its population is both spellings of one reach** (T060): the relative specifier a module in `backend/src` writes, which lands on a re-export shim and is judged against the file the shim forwards to (`canonicalTargetOf`, because a shim publishes nothing and judging one would refuse every reach in the tree), **and the bare `<host>/<subpath>` a module in a package writes**, which resolves through the host's own `exports` map to the same barrel. Neither the host's name nor its subpaths is written into the check — both come off the manifest of the member declaring `endora.type: "platform"`. It was relative specifiers alone until T060, on this check's own written reasoning that a packaged module's reaches need no judging because the `exports` map refuses a deep path: measured, that took **216** reaches out of the walk (104 of them in batch one alone) and would have taken the remaining 51 modules' with the sweep, while the check printed a clean line over the remainder. The floor that follows the sweep is `host-dependents`, printed in the `read:` line: every module package whose manifest declares the host must have contributed a host reach, expected and covered derived per run — the manifest is rendered from the bare specifiers the package's sources import (`manifests:generate`), so a walk that stopped reading them makes the two derivations disagree in the same run. Neither of the other two can see it: `manifest-index` counts modules that produced a *file*, which a packaged module does plentifully, and `platform-barrels` counts barrels, which a module move does not touch. What it still cannot see is in its header: a container name (`check:port-dependencies`' and `check:port-shape`'), a platform-owned **table**, and where inside another *module* package a subpath leads. The last two are both `check:module-boundary`'s, and the table half is **not** unwatched: that check's owner map attributes `settings`, `audit_logs`, `module_registrations` and `sales_channels` to the kernel off the declaring file's platform-relative path, so `catalog`'s `sales_channel_products` join is ledgered under that attribution today and `admin_actions`' `module_registrations` join was until feature 080's SQL-reach sweep retired it. This row read *"nobody's today"* until that sweep measured it false; the claim predates the platform relocation that taught the other check to read a `packages/platform/…` path as the kernel's. `UNPUBLISHED_PLATFORM_REACHES` is a two-way draining ledger — **how many keys it holds is not written here**, because it drains with every conversion and the two numbers that stood in this sentence were stale by a third when T060 measured them (D-100); the run prints `ledger-size=` — its platform half spelled `packages/platform/src/…`, keyed `(file, target)` with the **symbols named** rather than counted — the verdict is per symbol, so an entry that did not name it could not be checked against the barrel it disagrees with, and swapping one unpublished name for another leaves a count unchanged. Both stale directions fail: a key describing no reach, and a symbol an entry names that the walk no longer sees. |
| `check:port-catches` | `quality` | A `catch` that swallows `ModuleDisabledError` — see composition checklist item 7. Since D-88 it also follows the gate **one hop backwards**: a method of the same class whose body reaches a port carries, for a `catch` around `this.<method>()`, transitively inside the class. That is not the propagation the header refuses — that one carries a call's *result* **forward** into every downstream and produced 39 false findings; this carries a callee's *body* **backward** to the call site, through `this` and nothing else. A free function in another file, a callback from outside the class and a method on a non-port collaborator are all outside it, deliberately; a class method also **shadows** a module-scoped alias of the same spelling. Since issue #278 an alias is visible **where its binding is**: a constructor or function parameter is scoped to the file that *declares* it rather than the module the call site sits in, and a bare identifier resolves lexically, so a nearer binding that *manifestly* holds no port — a literal, a `new` over those — hides a wider alias. The old module-wide scoping was not merely noisy: an author who names a parameter `transitionService` reds an unrelated local of that spelling two files away, and the rename that clears it hid a live fail-open (`orders/prompt-tools.ts`). "The analysis cannot follow this" is **not** "this is not a port", so a call-bound local shadows nothing; and the `OWNER LOCKED` gate merge stays deliberately over-approximating, because that argument is about which owners a site rests on, never about which sites exist. |
| `check:port-dependencies` | `quality` | A cross-module port edge the resolver's manifest does not declare, and an edge with no deactivation-consequence classification — see checklist items 4 and 4a. Since the ruling of 2026-08-25 it also holds the third `nonBindingDependencies` kind, **`refuses-without`**, to the mirror of the `contributes-to` rail: `refusal-over-an-ungated-name` (a refusal claimed over a plain `ctx.di.register` name, where nothing can refuse), `refusal-over-a-bound-owner` (the same manifest also names the owner in `dependencies` or `acknowledgedDependencies`, so the flip-time refusal fires and the entry's "the owner's control keeps working" is false) and `refusal-without-a-sentence` (no `whenAbsent`, which classifies exactly as declaring nothing). The last two are refused earlier by `defineModuleManifest` and re-derived here for a manifest built without it; the fourth condition — the read happens at call time — needs no signal, because `buildDeactivationLedger` assigns `gated-port-before-first-request` before it consults any declaration. Also verifies `PLATFORM_OWNED_NAMES`, which grants both of those exemptions, against the three supply sources a composition really has — the two roots and `src/kernel/**` — for four findings: unsupplied, one-root divergence, owned-by-a-module and stale (issue #49). The list stays hand-written; every consequence of being on it is derived. Since feature 080's T034 the port→owner map has a **fourth** supply source, the container names an **installed extension package** registers: without it a name a package owns resolved to nobody and the *consumer* was reported as `unowned-name` — a wiring bug — when the wiring is right and the map was short, which is the ordinary case of the F4 endgame. Read statically, with this file's own `providedPortNames` / `registeredNames`, from the package's `./backend` artefact; an artefact whose own source does not declare the `registerModule` it hands out is bundled or re-exported and is **exit 2**, never credited with zero names. |
| `check:port-shape` | `quality` | **Three signals on a published port, over one population.** (1) An **optional method** on a published port, or on an interface `extends`-ing one (D-97.3). Feature detection through a port is impossible by construction: `lazyPort`'s proxy answers every property with a function, so `if (port.maybe)` is always true and the forward throws when the provider has none — and the proxy cannot be repaired, because an honest property read on a gated name throws. Optional *parameters* and optional *data properties* are untouched. No ledger for it: the single occurrence (`catalog` widening the custom-field read port with `publishInvalidate?`) is deleted, so an entry could only license re-opening it. (2) A **container name** in a port's doc block that is not the name the port is registered under (issue #192) — §1.2 makes that name contract, it is the literal a consumer copies into `lazyPort`, and nothing read it: on the tree the signal landed against, eight of 98 were wrong. Two shapes, and they fail differently: a name nothing registers throws `is not registered in this composition` at first call, while a name that resolves to the **ungated** legacy twin does not fail at all — `AdminRolePort` documented `adminRoleService`, a plain `di.register` whose `list()` returns entities structurally assignable to the record type, so a consumer following the doc got no `MODULE_DISABLED` gate and no `tsc` error. The second shape needs the registration's type argument, so it sees only the `providePort<T>` calls that carry one. A doc block may name **more than one** container, because a published shape may have more than one provider (`OrderStatusRegistry`, registered by `payment_methods` and by `delivery_methods`); `PORTS_WITHOUT_A_REGISTRATION` answers for a port with *no* provider, is two-way, and is empty since D-98.5. (3) A module **resolving, cross-module, a container name no contract publishes** (issue #196, D-98.2) — signal 2's edge walked the other way. It has to be checked on the *name*, at the *resolution*: `lazyPort<T>` is `new Proxy({} as T, …)`, so `T` is asserted and nothing compares it to the registration, which is why branding the record types was rejected — a brand bites only where the compiler compares, and here it never does. !698 corrected the docs and three consumers went on resolving the class name, invisible to everything. 33 sites over 10 names when it was written; the two-way `RESOLUTIONS_OF_UNPUBLISHED_NAMES` ledger keeps 3, and issue #209 drained the last that were repairs rather than rulings. One of them was **two answers under one key**: `catalog` named `customFieldDefinitionService` four times because both roots had handed the owner's one service to two different options, so the definition *read* and the transactional *apply* seam were indistinguishable from the container's side. The read half re-points to the published `customFieldDefinitionReadPort`; the apply half stays, because **six of `CustomFieldDefinitionApplyApi`'s seven methods** take the caller's `EntityManager` (D-77, FR-034), which is enough to bar the interface from `packages/contracts` — that package holds zero `@mikro-orm` imports and both `admin` and `storefront` compile it. **"Every method" was written here and in three other places and has been false since feature 061**: `publishInvalidate(entityType)` takes none, by construction, because it is a post-commit cache fan-out that must run *after* the caller's transaction commits. The load-bearing half of the claim survives the correction, which is exactly why nobody checked it — a reason that is true is not thereby true as stated, and the overstatement is the kind D-100 is about. The three that remain are all of that shape — a seam a foreign key holds co-transactional — and retire with F4 package entry points, not with a doc fix. Self-resolutions and **cradle** reads are out of the population and both are proven by a discrimination fixture, the second because a cradle name is a contribution seam a root supplies. Exit 2 five ways, one per input a signal could be silently missing: no sources, no port type, no registration, no published container name, no `lazyPort` resolution. |
| `check:release-intent` | `quality`, plus a second mode in `release:changeset` | A `.changeset/config.json` under which the release gate below stops asking (feature 080, T043). The gate is `changeset status`, the CLI's own command, and *that* is why there was no check of it — which is backwards: the CLI is right, and what decides whether it is **looking** is the config. Measured, over the real five manifests, on a branch that changes `packages/contracts/src/index.ts` and carries no changeset — `privatePackages.version: true` exits **1**; `false` exits **0**; the block deleted exits **0**, and `false` is the `@changesets/config@4` default. Four lines of apparent boilerplate that nothing in the tree read, on a file no rung of `.backend-test-rules` matches. It runs in `quality`, which has no `changes:` filter, so it also runs on the merge request whose only diff is that file. Eight findings, none of them a list written down: `version-disabled` (the measurement above, required only while a versionable package is actually private); `publishable-package` (D-160.5 — everything stays private through Wave 4, and this is what makes the tag question land in the merge request that creates it); `tag-without-publication`; `ignored-family-member` and `unignored-application`, the two directions of the ignore list; `stale-ignore-entry`; `stale-group-member`; and `unversionable-changeset`, the reconciliation of written intent against derived classification. **Family or application is derived from the shape of the `pnpm-workspace.yaml` entry** — a glob enumerates a library family, a literal names one deployable — so 66 module packages arriving under a second scope and a directory deeper are versionable by default and the `ignore` list does not grow. That is also where the 67-package failure mode lives: `ignore` is glob-matched against **names**, so one entry reading `@endora-commerce/*` would exempt every module package at once while `changeset status` went on exiting 0, and `ignored-family-member` is the finding for it. The pattern reader implements `*` and `?` and **refuses** anything richer with exit 2 rather than reporting it as matching nothing — `@` and `+` are metacharacters only before a `(`, so `@endora-commerce/*` reads fine, which it has to, being the pattern the most valuable finding exists to catch. **No ledger, deliberately**: every finding is a configuration that makes the gate silent, and an entry could only license one. Exit 2 six ways — a missing or unparseable config, a `pnpm-workspace.yaml` that yields no globs (a flow-style list reads as none, and an empty workspace makes every predicate vacuously true), no member at all, a workspace entry that produced no member (#215 over this population: move the library tree and four application manifests still answer every question), and an unreadable `ignore` pattern. The floor lives **inside the analysis** rather than in `reportReadSize`, because a red proof entering where a real run enters could not otherwise reach it. **A ninth finding lives behind `--since <ref>`** (D-162), because it needs a diff and `quality` has no git: `unattributed-published-change`, a branch that changes a file a versionable package compiles into its published `dist` from **outside** the package's own directory while carrying no changeset. `changeset status` attributes a change to a package by the package **directory**, which is right only while a package's sources are its own — `@endora-commerce/platform` (!891) compiles five directories of `backend/src`, and `backend` is in `ignore`. Measured on that branch: a commit editing `backend/src/kernel/settings/settings-cache.ts`, compiled straight into the published `dist`, reports `Packages to be bumped:` empty and exits **0**; a commit editing `packages/platform/README.md`, which ships in nothing, exits **1**. The gate inverted with respect to what it protects. The population is derived from each versionable package's own `tsconfig.build.json` — `include` and `exclude`, following a relative `extends`, because !891 puts `include` in the file it extends — never a copy of the include list written into a check (D-100). It asks the CLI's own question at the CLI's own granularity (*did a versionable package change while this branch carries zero changesets*), so the two are one rule and not two, and it says nothing about a path the CLI can already attribute. Four more exit-2 ways, one per input whose absence would mean "this package publishes nothing outside its own directory": a build configuration it could not read, one whose `extends` chain declares no `include`, an `extends` that is not a relative path, and a git invocation that failed — plus a branch with an empty diff. **That last one is two facts, and only one of them is a refusal** (pipeline 11491): a correct merge request went red on *"the branch changes no file at all"* because it had already been **merged** when the job fetched its baseline, so `HEAD` was an ancestor of `origin/master`. Comparing against the **merge base** is not the repair and never was — the diff has been `<ref>...HEAD` since !882, which *is* the merge-base diff and *is* a merge request's own diff, and that is exactly why re-baselining is a no-op here: once the branch is merged the merge base **is** `HEAD`, so the merge base is what produces the empty diff. The fact that separates them is `git merge-base --is-ancestor HEAD <ref>`. A branch with a real fork point that changes no file stays exit **2**, in the same words plus the sentence saying it is *not* contained; a branch the baseline already **contains** exits **0** with a `contained=yes` line, because the files it adds to the baseline are empty **by construction** rather than by a measurement that came back empty — a verdict, not a silence. It cannot be manufactured to slip the gate: to be an ancestor of the target every commit must already be *in* the target, and getting them there took a merge whose own pipeline ran this gate against a baseline that did not yet contain them. A **squash** merge copies the content and leaves the commit outside that history, so such a branch is not contained and is judged normally. It runs in `release:changeset` beside `changeset status`; `test/release/changeset-gate.test.ts` measures both halves over real branches — the inversion, and all four baseline cases (changes with a changeset, changes without one, an empty diff, and already merged). |
| `check:shared-table-wipes` | `quality` | A test that empties a shared table instead of scoping its fixtures (issue #166). Eight comparison files ran `nativeDelete(Comparison, {})` in a `beforeEach`, which is what let four of them assert `toHaveLength(1)` over the whole table — a claim about the platform, not about the row the test created. Sees all three spellings: the ORM filter left empty, a `truncate`, and a `delete from` with no `where`; a filtered delete of any size is the repair and is not reported, and the harness's own `SEEDED_TABLES` truncate is the seam rather than an instance of it. `UNSCOPED_WIPES_BASELINE` is a **per-file two-way ratchet** over the 197 wipes standing when it landed — a new one fails, and so does a number left standing after the deletes under it were scoped. Never raise a number to make the build pass. |
| `check:singleton-identity` | `quality` | **A module package's process singletons exist once** (feature 080, T061). The platform composes a package through its published artefact — the generated composition imports `@endora-commerce/mod-<id>/backend`, whose `exports` map points at `dist` — so a file naming the *same* package's **source** by filesystem path evaluates it a second time, and `tsc` cannot see it: the two spellings have identical types. T040c measured that for the platform's five directories (59 runtime values, none shared; `instanceof HttpError` false across the boundary) and **D-160.6 wrote it down about entity classes**, where the failure is a lookup miss: loud, at a known moment. **The asymmetry is why this row exists.** A duplicated module-scope *value* fails **silently** — the second copy is simply empty — and it has now happened in two consecutive packaging batches: `paymentAdapterRegistry` in batch one, and in batch two a second, empty `ShippingAdapterRegistry` into which an off-state test registered its synthetic carrier. The adapter was never *found*, so the shipment path took its "no carrier configured" branch and reported success: a switched-off module read as **present**, which is the exact state that file exists to refuse. Neither was visible to `tsc`, to any other check, or to `test:unit:fast` — both live under the trees it skips. **The rule is a conjunction of two derived facts, and the conjunction is the whole design**: (1) the reaching file's own value-import closure also loads that package's published artefact — *both copies in one process* — and (2) the reached binding is one the platform composed, either handed to the container by the package's own `asValue` / `asFunction(() => x)` / `asClass`, or a member of the `entities` array the ORM registered. 328 value reaches into a package's source stand in this tree and the overwhelming majority are **correct**: a unit test that constructs its own service over a stubbed `EntityManager` has one copy in its process, so there is nothing for a second to disagree with (D-168). Conjunct 1 clears them by **derivation**, which is what keeps the ledger from being 328 entries of exceptions. Two findings — **`composed-singleton-reach`**, which has **no ledger deliberately** (the composed container and `test/helpers/package-singletons.ts` / `package-entities.ts` are always available, so an entry could only license re-opening the defect), and **`whole-file-reach`**, a namespace, dynamic, side-effect or `require` reach that names no binding and therefore takes the file's whole graph, with a two-way ledger. **A third signal was written, measured and removed**, and the measurement is worth more than the signal: `instanceof` / `toBeInstanceOf` against a source-reached binding fired on all three sites in the tree and all three were **correct**, because in each the compared object was built by the test from the same source copy. Which copy produced the left operand is not lexically decidable, so the signal would have been a ledger of nothing but exceptions. What it cannot see is in its header: a computed dynamic specifier, a module named as a string that is only read as text, a singleton reached transitively through a service class that closes over it, and `admin` / `storefront`, for which conjunct 1 is false by construction. Exit 2 five ways — an unresolvable layout, a walk that opened nothing, a registered module that contributed no source (#215, before every other refusal so a moved tree is named as one), a workspace declaring **no module package** (the rule has no subject), and module packages declaring **no composed singleton at all**. `sources=` reconciles the walk against the manifest index and against the packages the committed `entities-registry.generated.ts` imports an `entities` array from — a second author's answer to the same question. |
| `check:subscribe-seam` | `quality` | **A module's background consumers reach the module's seam** — both of them. (1) A bare `eventBus.on` in a module instead of `ctx.subscribe` (issue #107). (2) A BullMQ queue consumer outside `ctx.worker` / `defineModuleWorker`, which is the same rule and was added because *this check's own header* asserted the workers were already covered: it read *"routes have the `ctx.routes` seam; workers have `defineModuleWorker`; subscriptions had nothing"*, and `pwa` had constructed its push-delivery `Worker` and dropped the value — in no per-module registry, so `pauseWorkersFor('pwa')` reached nothing and an operator who switched `pwa` off went on having push notifications delivered to their customers' devices. Two findings, because the tree spells it two ways and only one of them names `Worker` where it matters: **`ungated-construction`** (a `new Worker` a module keeps, `Worker` being the binding the file imported from `bullmq`) and **`ungated-registration`** (a call to a worker **factory** whose value goes nowhere — not into a seam call, not `return`ed, not bound to a name the same file later registers). The factory set is **derived**, never a naming convention: a first pass records every function in the tree that returns a BullMQ `Worker`, so `createPushDeliveryWorker` is one because of what it returns — a `create*Worker` regex would have issue #244's defect, a population defined by the presence of the habit the rule is about. It cannot see a worker handed across files to a caller that forgets the seam (the binding rule is one file deep), a `Worker` subclass, a computed callee, or a `defineModuleWorker` called with the **wrong** module id. Both ledgers are empty and two-way. Its worker half exits **2** on zero worker sites read — the module-population floor stays satisfied by files carrying no queue at all, so a `Worker` import shape that stopped resolving would print a clean line over an unprotected tree. The script keeps its name for now, which is narrower than the rule; renaming it is one line in `.gitlab-ci.yml`. |
| `check:transaction-context` | `quality` | SQL written inside a transaction that does not run inside it (issue #200). `em.getKnex()` is `getConnection().getKnex()` and a connection is not a transaction: the statement takes its own pooled connection and commits immediately, so the enclosing rollback cannot reach it and a read cannot see the transaction's own writes. `PromotionUsageService.finalize` incremented usage counters that way — a cap hit rolled the order back and left a redemption row pointing at an order that never existed (D-94) — and the sweep found 65 more (51 of them writes), including a megamenu tree a refused save deleted outright. Two shapes: a `getKnex()` call, and a `getConnection().execute(sql, params)` with no transaction context as its fourth argument. The population is only what is **lexically** decidable — the body of a `transactional(` callback and a Command's `run`, which `CommandBus.run` executes inside a transaction — because whether an arbitrary method has one open is a question about its callers; the repair (`em.execute(sql, params)`) needs no such knowledge, being identical outside a transaction. `CONNECTION_LEVEL_SQL_IN_TRANSACTIONS` is an empty two-way ledger. |
| `i18n:hardcoded` | `quality` | A user-visible literal in the admin SPA — see the i18n checklist above. |
| `overlay:check` | `quality` | A generated artefact that is stale, missing, rendered empty — or **`foreign`**: the composer, the manifest index, both `db/` registries, **the admin contribution registry** (`admin/src/modules.generated.ts`, feature 091 — the fifth artefact and the first one that does not live under `backend/src`), and every override manifest — bare core plus one per deployment under `backend/src/apps/` (issue #120). The fourth verdict is containment (feature 080 T030a, D-155.6), and it exists because the other three cannot see it: the check renders the artefact twice and compares, so **two renders of a wrong generator agree** — measured, a vendor package symlinked under `src/modules/` and regenerated into the committed registry reported all six artefacts deterministic, exit 0. So every entry in every rendered artefact must land in the **core tree**, or in one of this repository's own **workspace** packages (D-149 commits a packaged module with a bare specifier), and **under no installed package** — an installed package is discovered at runtime (D-119/D-155) and baking it in registers it twice. The discriminator is the **real path**, never a `node_modules` segment: pnpm links a workspace member into `node_modules` too, so the segment test is wrong in both directions, while a member's realpath *is* its directory in this tree and an installed package's is under `node_modules/.pnpm/…`. Its floor is per artefact, not per run — an artefact that contributed no entry while the others contributed hundreds is #215's short walk — and it exits 2 on that, on a workspace derivation that named no package (the discrimination would be off, and every bare specifier would read foreign), and on an import line whose specifier the parser could not read. What it cannot see is in its header: a package vendored by hand into a workspace directory, a flow-style `pnpm-workspace.yaml` (refused, not passed), a computed specifier, and whether the file at the end of a relative specifier exists — containment is about where an entry lands. |
| `pnpm run check:naming` | `quality:static` | Principle VI, above. |
| `pnpm run check:language` | `quality:static` | Principle VIII, above. |
| `pnpm run check:pdfmake-footprint` | `quality` | A pdfmake font bundle over the single-VPS disk budget (Constitution IV). |
| `bash scripts/boot-gate.sh --with-negatives` | `boot-gate` | A **built image** that boots green while the platform inside it is not what the source says (feature 080, D-165 step F). Not a `check-*` script and it must not become one: `check-read-size.test.ts` spawns every one of those, and a docker build inside a unit run is not a test. It is the only gate in this pipeline whose subject is the *built* tree — `quality` type-checks the source tree, `test:backend` runs vitest against it, `test:backend:deployment` composes overlays from it — and both defects it exists for are properties of the built one, **reproduced** rather than predicted: 45 of 45 modules installing no translations while the boot reports `installed=0 skipped=21 failed=0`, and every overlay module vanishing with no error at all. It builds the image, migrates a throwaway database from a template, boots it with `DEPLOYMENT=example` and asks the running platform three questions — health 200; the boot's own reconcile line accounting for **every** module `/api/v1/storefront/module-presence` enumerates; and every overlay module the deployment declares among them. The translation assertion is **arithmetic and not `installed > 0`**, which the negative run is what proved: with the assets gone from `dist`, the module packages carry their bundles inside `node_modules` and still install, so `installed=6` is a cheerful non-zero over a platform whose other 39 modules serve raw keys. Expected overlay ids come off the deployment's own `modules/` directory and the module count off the platform's own enumeration, so neither is written down (D-100); a deployment declaring none is exit 2, as is a platform that enumerates no module. It also refuses an image whose `Cmd` is not `dist/index.js` — that image passes every other assertion while being the thing the ruling exists to stop. **`--with-negatives` runs the gate red in every pipeline**: **three** images are derived from the one under test, and the bundle case is two of them because the assertions are two. `drop-platform-bundles` removes only the platform package's bundles and proves the **arithmetic** assertion — the reconcile line accounting for every module the platform enumerates; `drop-every-bundle` proves the `installed == 0` one; and a third removes the deployment's overlay directory. The split arrived with D-160.11's second half (!1106): once `_lifecycle`'s bundles moved into the platform package, `backend/dist` held **no** runtime asset at all, so the single old negative — deleting `dist` JSON — stopped going red while the gate it guards was as sound as ever. A negative that has quietly stopped being negative is the failure this whole `--with-negatives` arrangement exists to refuse, arriving in the arrangement itself. The breakage lives in a derived image, never in a flag on the gate, so the negative runs take the same boot path and the same judgement as the positive one. The judgement is `scripts/lib/boot-gate-assert.sh`, which touches neither docker nor the network, and `test/unit/ci/boot-gate.test.ts` spawns each function over fixture text for one red proof per finding. Three boots plus two derived builds cost **74 s** measured; the image build dominates and is the one `build:backend` already runs. |
| `pnpm --filter docs run build` | `build:docs` | A documentation site whose navigation names a page that is not there, or whose prose links one that moved (feature 100, FR-014). Not a `check-*` script and it must not become one — `check-read-size.test.ts` spawns every one of those, and a Docusaurus build inside a unit run is not a test. It is the acceptance instrument for the two things nothing else in this pipeline can see: Docusaurus's own `checkSidebarsDocIds` (*"These sidebar document ids do not exist"*) and `onBrokenLinks: 'throw'`. **Measured before it existed**: the pipeline declared `build:backend`, `build:storefront` and `build:admin` and no docs job; `.backend-test-rules` rung 2 skips the backend suite for a documentation-only diff, deliberately and correctly; and `pnpm -r run typecheck` does not read `sidebars.js`, because `@docusaurus/tsconfig` sets no `allowJs`, so its `// @ts-check` header is inert and the file is in no program. The one direction Docusaurus does enforce was therefore enforced by a build that ran on a developer's machine and nowhere else, which is why a *generated* sidebar without this job would be a generated file nobody validates. It runs in `stage: test` rather than `build` — that stage runs only on the default branch, and a broken link has to fail the merge request that writes it. The `changes:` list is what the site is made of: its own tree, a module package's `docs/`, and the generator that writes the fragment. Roughly 40 s of build on a cold cache, plus the install and `build:packages` every job here pays. |
| `pnpm changeset:status --since=…` | `release:changeset` | A merge request that changes a package under `packages/` and carries no changeset (D-107). Not a `check-*` script and deliberately not one: `changeset status` is the changesets CLI's own command for the question, so there is nothing of ours to keep correct and nothing for `check-inventory` to name — its `script` field must resolve to a file in this tree, and a vendored CLI is not one. That holds for the *question* and not for the *configuration* it is asked under, which is `check:release-intent`'s row above. The job also recognises a **release branch** — one that deletes changeset files and adds none, read off the diff with `--no-renames`, never off a branch name — and asks it the inverted question: a release that consumed changesets and moved no `version` is `changeset version`'s no-op arriving through the other door. **And it decides which package a changed file belongs to by *directory*, which is wrong for a package whose sources are not its own** — the second command in the same job, `check:release-intent -- --since`, is what closes that edge (D-162; see the row above). See *Release intent — changesets* below. |

Two more run in the same job with no npm script of their own, through
`pnpm --filter backend exec tsx scripts/<name>.ts`: `check-entity-tenant-classification`
(every persisted entity carries exactly one tenant-scope decorator, feature 050 — and since
feature 080's T034 the population is the **platform**, not the tree: an installed extension
package's entity classes are read out of its `./backend` artefact and held to the same rule,
because a published package ships compiled output and a tree walk of `src/` would have let a
third party ship a persisted entity with no tenant-scope decorator while the check reported
every entity classified, which is Principle XI defeated by a silence. A package whose entities
cannot be enumerated is exit 2, never a package credited with none) and
`check-channel-resolution --enforce` (no re-resolution of the sales channel outside the
canonical resolver, and no settings read naming its channel with a string literal — feature
053 FR-011, feature 072 D-42).

## Release intent — changesets

Release tooling is **Changesets** (`@changesets/cli`, a root devDependency), adopted by owner
ruling **D-107**; **D-108** sets the versioning model. Both are in
`specs/080-f4-real-scope/rulings.md` and are settled — do not re-open them, and in particular
do not reach for Lerna, `semantic-release` or conventional-commit inference.

**The rule: a merge request that changes what a package publishes carries a changeset.**
For every package in this repository today that reads "a file under `packages/`", which is the
entire trigger; `backend`, `admin`, `storefront` and `docs` are in the config's `ignore` list
and never need one — they are applications, and nobody consumes them by version.

It is stated as *publishes* rather than as a directory because the two came apart (D-162).
`changeset status` asks the directory question, and `@endora-commerce/platform` (!891) keeps a
manifest, two tsconfigs and a README under `packages/platform` while compiling five directories
of `backend/src` — so the CLI waives a changeset for the code the package ships and demands one
for the README, which ships in nothing. **The honest question is "does this commit change what
a published package emits?"**, and the answer is a function of the package's
`tsconfig.build.json`, not of a path. `check:release-intent -- --since`, the second command in
`release:changeset`, asks it; nothing else in this repository can.

```bash
pnpm changeset             # write one (interactive)
pnpm changeset --empty     # record "this change carries no release meaning"
pnpm changeset:status      # what would be bumped
pnpm run version:packages  # cut a release branch: consume the changesets, bump, commit
```

`pnpm changeset:version` is the bare CLI underneath and is **not** the step to run by hand:
it exits 0 when it bumps nothing, which is exactly what a broken `.changeset/config.json`
produces. `version:packages` wraps it with the two refusals that turn that silence into a
failure.

Where a change genuinely has no release meaning — a comment, a test, a rename crossing no
export — write the empty changeset rather than looking for a way past the gate. It puts a
human's "I looked, there is nothing to release" in the diff, where a reviewer can disagree
with it.

A good changeset is written **for the consumer of the package**, not for the reviewer of the
branch: name the exported symbol, and for a `major` give the old call and the new one, because
nothing else in this repository will tell an upgrader what to do. One file per meaning, not
one per merge request. **The bump level is your judgement and cannot be delegated** — that is
why D-107 chose this tool: a change to `@endora-commerce/contracts` can be breaking for
`@endora-commerce/api-client` and inert for `@endora-commerce/cms-components`, and no commit
prefix knows which.

**Versioning is independent, with one `linked` group** (D-108):
`@endora-commerce/page-builder-core`, `@endora-commerce/cms-components` and
`@endora-commerce/email-components` take one version number whenever a release includes more
than one of them. `page-builder-core` is a **peer**
dependency of the other two and ships React contexts and hooks, so the consuming application
resolves exactly one copy; ranges that disagree resolve two, and a provider in one copy against
a consumer in the other is a `null` context at runtime, not a type error.
`@endora-commerce/contracts` and `@endora-commerce/api-client` version independently — Changesets patch-bumps a
dependent on its own (`updateInternalDependencies: "patch"`).

**Read `linked` precisely, because the sentence that used to stand here was measured wrong**
(feature 080, T043). It said *"a release of `page-builder-core` therefore always carries all
three"*, and that is true today for a reason nobody wrote down: `linked` **raises a package
that is already in a release** to the group's highest number, and it never *adds* one. What
puts `cms-components` and `email-components` into a `page-builder-core` release is their
`peerDependencies` range going **out of range** — and every package sits at `0.0.0`, where
`workspace:^` resolves to `^0.0.0` and any bump at all breaks it. Measured over the real
manifests: at `0.0.0` a minor on `page-builder-core` moves all three to `0.1.0`; seeded at
`1.4.2`, the same minor moves `page-builder-core` to `1.5.0` and leaves the other two where
they are, while a **major** takes them out of range and moves all three to `2.0.0`.

That divergence is correct, not a defect: the requirement is that the application resolve one
copy, and `^1.4.2` satisfied by `1.5.0` resolves one copy. The shared number was the
mechanism, never the requirement. It is asserted in both regimes by
`backend/test/unit/release/changeset-flow.test.ts`, so the first real release does not
discover it in a merge request. A patch on `cms-components` alone moves only itself, at every
version — it carries no runtime the app resolves once.

**The version step is `pnpm run version:packages`, and it runs locally.** It cuts a
`release/version-<date>` branch, runs `changeset version`, and refuses two things a bare
`pnpm changeset:version` cannot: a run with no changeset to consume, and a run that exited 0
having moved nothing it consumed. The second is the whole reason it exists — see the
`check:release-intent` row in the inventory. It runs locally rather than in CI because a
version bump changes `packages/`, every change to `packages/` lands through a merge request,
and a CI job that could open one needs a push credential that D-160.5 defers to the merge
request that makes a package public. The reasoning is in the script's own header, in full.
`release:changeset` recognises the resulting branch from the **diff** — it deletes changeset
files and adds none — and asks it the inverted question: did anything's `version` actually
move.

**Tags: there are none, and `privatePackages.tag` stays `false` until something publishes.**
While every package is private, a tag naming a package version anchors nothing a reader
cannot re-derive from the commit that wrote the `version` field — D-100's shape, written into
a ref every clone then fetches, 67 of them per release once the module packages land. What
would make a tag *anchor* something is publication: a tag is how you assert that this exact
tree is what a registry serves under that version, which git history alone cannot say about a
registry. So the answer is coupled rather than written down — `check:release-intent` requires
`tag: false` exactly while every versionable package is private, and reports the first package
that stops being private — which puts the tag decision in the merge request that creates the
need for it.

Two things about `.changeset/config.json` that are load-bearing and look like boilerplate:

- **`privatePackages: { "version": true, "tag": false }`.** Every package under `packages/`
  is `"private": true` and stays that way in this repository. `@changesets/config@4` defaults
  `privatePackages` to `false`, which makes every changesets command skip all five and report
  a cheerful nothing — including the CI gate. `version: true` is what makes the tooling see
  them; `tag: false` keeps it from tagging things nobody publishes.
- **`ignore` matches package *names*, not paths.** It is glob-matched against
  `backend` / `admin` / `storefront` / `docs`, the names in those manifests. The
  `pnpm-workspace.yaml` globs decide only what is discovered as a workspace; they do not reach
  `ignore`, and `packages/*` written there would match nothing. A typo fails safe — the app
  stops being ignored and starts demanding changesets, loudly. **An over-broad pattern does
  not**: one entry reading `@endora-commerce/*` would exempt all 66 module packages at once,
  silently, and that is what `check:release-intent` refuses as `ignored-family-member`.

Neither bullet is enforced by being written here — both are `check:release-intent` findings,
in the `quality` job, on every merge request. They were written here and read by nothing until
feature 080's T043.

Nothing is published yet: every package under `packages/` is `"private": true`, there is no
`release` script, and `access` is `restricted`. Making a package public is a separate merge request,
with the meta-package / supported-set question D-108 defers — and `check:release-intent` goes
red the moment `private` comes off one, so that merge request cannot be a drive-by. The longer
guide, for the moment you are writing the file, is `.changeset/README.md`.

## Overlay modules (per-deployment customization, feature 057)

A **client-only overlay module** lives under `backend/src/apps/<deployment>/modules/<id>/` and
is discovered without editing the shared core registry (`REGISTERED_MANIFESTS` stays
untouched — FR-004). It is an ordinary lifecycle participant, so every checklist above
applies, with one difference: its admin permissions must appear on `/admin-roles` and pass
the permission-inventory check **for that deployment** — run the inventory test with
`DEPLOYMENT=<name>` set. Overriding a core **service** is a **decoration**, not a file
shadowing it (feature 072), and there is exactly one way to write one: from the deployment's
own overlay module, `ctx.di.decorate('<registrationName>', (inner) => …)`, which receives the
core implementation and returns one that delegates to it, so core fixes keep flowing.
`backend/src/apps/example/modules/example_overlay/backend.ts` is the worked example. A
`services/` file under an overlay is an **unknown override target** and fails the build.

**There used to be a second way, and it is retired** — a file under
`backend/src/apps/<deployment>/decorations/`, named after the registration it wraps, exporting
`decorate(inner)`. It existed because feature 072 predated D-103: an overlay module was then a
`plugin.ts` over a frozen seven-field context that could not decorate anything, so a
deployment that wanted to wrap a service and did not want to write a module had nowhere else
to go. D-103 made an overlay module an ordinary composed participant with the whole
`ModuleContext`, which left the file seam redundant — and worse than redundant: it was
documented as the general service-override mechanism and wired for exactly **one** hard-coded
registration name, so any other file in that directory was imported, keyed, and discarded
without a warning. Do not reintroduce it; do not look for it in a client tree.
**One thing was genuinely given up with it.** The file imported the owner's
`*.interface.ts`, so `tsc` refused a wrapper that had stopped matching the interface —
feature 057's contract gate. `ctx.di.decorate<T>` asserts `T` at the call site and compares it
to nothing, so the wrapped shape is now declared **structurally** and interface drift is a
runtime surprise rather than a build failure. The cheap way to get the gate back, when a
deployment wants it, is for the owning module to publish its interface on its package's
`./ports` subpath and for the overlay to name it there — a type-only `./ports` reach is not a
boundary reach (D-171).
**Decorating across owners is the deployment's alone** (issue #203):
`ctx.di.decorate` refuses a module that wraps a registration it did not register — including
one a composition root registered, which no module owns — because decoration rewrites what
every consumer of that name resolves, and a core module wrapping `commandBus`,
`auditLogService` or another module's read port is a coupling nothing declares. Ask the owner
for a seam instead (a port, a contribution point, an event). An overlay module is exempt, and
the exemption is structural: `loadOverlayModuleEntries` marks an entry `overlay: true` from
the root it was discovered under, so core cannot assert it.
**An overlay module ships `backend.ts`, not `plugin.ts`** (D-103). It is composed by the
kernel container exactly as a core module is — appended to the core list in the one
`composeModules` call — and uses `ctx.routes` / `ctx.worker` / `ctx.subscribe` /
`ctx.interceptors` / `ctx.di.decorate`. The second path is gone: it could gate no route, and
the one reference overlay module in the tree shipped an ungated one for as long as it existed.
A deployment's modules are **discovered at runtime**, so `composition.generated.ts` and
`manifest-index.generated.ts` are bare core under every value of `DEPLOYMENT` (D-104).
**An overlay module contributes no schema** (D-106, narrowing D-105): a per-deployment overlay
module under `backend/src/apps/` contributes registrations, routes, decorations, interceptors,
permissions, i18n bundles and a manifest, and **no `@Entity()` class and no migration**. The
reason is **not** migration ordering. That argument — "the order is only meaningful over a fixed
set" — was measured false (`specs/080-f4-real-scope/README.md` §2: adding a leaf module's
migrations leaves the relative order of all 141 existing ones exactly unchanged) and is retired;
do not cite it and do not repeat it to an overlay author. The reason is that **an overlay lives
in the same repository and the same build as core**, so the remedy is always available and costs
nothing but a directory: own the table from a core module and read it from the overlay through
that module's port. A second schema-owning mechanism that buys no capability is not worth its
weight. The generator refuses both (`generate-composer.ts`), which is the same rule the
Migrations section above states.
**An extension package is the opposite case and may ship entities and migrations** (D-106.2, an
owner ruling). A third-party author has no core module, so for a package the same rule would not
be a constraint to design around but a prohibition on the entire extension-package programme,
every family of which persists state. The mechanism that lets it is Wave 3 of
`specs/080-f4-real-scope/tasks.md`; until it lands, the only schema a running platform executes
is core's. See `docs/docs/architecture/overlay-pattern.md` and
`specs/057-overlay-pattern-multideploy/`.

## Working agreement

- **Verify before reporting done**: `typecheck` + `lint` + the targeted tests for what you
  touched. Report failures with their output; never hide them.
- **Read before writing** — the module you are changing, the closest prior feature's spec
  directory, and the relevant contracts.
- **English only** in code, comments, identifiers, specs, docs and commit messages
  (Principle VIII).
- **Commits**: never add `Co-Authored-By: Claude` or any other AI/LLM trailer. Branch off
  `master` and deliver through a merge request — never commit straight to `master`.
- **Do not touch**: generated files, another module's migrations, or the auto-generated
  appendix at the bottom of this file.

Specs written before 2026-07-31 refer to the checklists above as "the CLAUDE.md new-module
rules" — same rules, they simply moved here.

## Feature workflow (speckit)

New features follow the speckit flow: `/speckit.specify` → `/speckit.plan` → `/speckit.tasks`
→ `/speckit.implement`, producing `specs/NNN-slug/`.

**A feature number is not unique, so cite the slug.** A payment gateway and a platform feature have
landed on the same number many times over, and nothing refuses it. **How many, and which, is not
written here** — this sentence named ten and listed ten while the tree held **eleven**, and the
missing one was `068`, whose two directories (`068-inpost-shipping`, `068-ergonode-pim-sync`) are
both named in this file's own generated appendix a few hundred lines below. A count of a derived fact,
written down, in the paragraph warning about exactly that (D-100). Derive it instead:

```bash
ls -d specs/[0-9]* | sed 's|specs/||; s/-.*//' | sort | uniq -d
``` So *"feature 075"* addresses
two things: it is cited **fourteen** times in this file, the F4 rulings and the check estate, and
**never once with a slug**. Context resolves all fourteen today; nothing guarantees the next one.
Write `specs/075-cross-module-decoupling-sweep/` where the reference has to survive a reader who
was not in the conversation, and keep the bare number only for prose that names the slug nearby.

**This is a rule about citing, not about numbering**, and deliberately so. Renumbering ten
directories would break every reference that currently resolves by context, to buy a uniqueness
nothing depends on. What *is* worth avoiding is a **new** collision on a number that active work
is citing — a second `087` landing while D-172, D-178 and the R-1 spike are being written makes
those citations ambiguous from their first day, which is a different and larger cost than the ten
historical ones that have settled. `/speckit.plan` regenerates the appendix
below through `.specify/scripts/bash/update-agent-context.sh`, which is pinned to write into
this file only (see the repo-local override near the top of that script) — that is what keeps
`CLAUDE.md`, `.cursor/rules/specify-rules.mdc` and this file from drifting apart again.

## Subagents

Role-specialised subagents are defined **once per tool**, with identical roles — Claude Code in
`.claude/agents/*.md`, Cursor in `.cursor/agents/*.md`, Codex in `.codex/agents/*.toml`. **How many
tools that is is not written here**: this sentence read *"defined twice"* until the Codex set landed,
which is a count of a derived fact going stale in the paragraph that has to stay true as tools are
added (D-100). `ls -d .claude/agents .cursor/agents .codex/agents` answers it. Their prompts stay
short on purpose — repository conventions live here, not in the agent files.

| Agent | Use for |
| --- | --- |
| `endora-commerce-architect` | Designing features: specs, plans, module boundaries, data models |
| `endora-commerce-dev` | Implementing plans and fixing bugs, with tests |
| `endora-commerce-designer` | Designing and auditing UI: commerce surfaces (cart, checkout, PDP, PLP), admin screens, UX/accessibility reviews |
| `endora-commerce-product-owner` | Verifying business ↔ implementation consistency, spec/task audits, `docs/` |

## UX laws

`.claude/skills/ux-laws/SKILL.md` is the **single source of truth** for the UX rules applied to
every UI change — the Laws of UX (<https://lawsofux.com/>) rewritten as actionable frontend
rules, plus the WCAG 2.2 AA floor, the repo's design tokens and primitives, and the required
component states. Unlike the subagent prompts it is **not duplicated per tool**: the Cursor
agent reads that path directly, and where a tool insists on finding a skill under its own root the
answer is a **relative symlink** to this path, never a copy — `.agents/skills/ux-laws/SKILL.md` is
one. Relative, so it travels with the checkout and resolves inside a `git worktree` rather than
pointing at whichever tree it was created from; the same property issue #255 depends on for
`node_modules`. Update it in place; never fork a second copy.

---

<!-- Everything below is appended automatically by speckit's update-agent-context.sh.
     Treat it as an append-only log; prune it when it stops being useful. -->

## Active Technologies
- TypeScript 5.x (strict) on Node.js LTS ≥ 22.17; Fastify + MikroORM + Zod + ioredis + BullMQ (existing); no new runtime deps. (068-inpost-shipping)
- PostgreSQL via MikroORM — orders.shipping_adapter_data JSONB; Settings for inpost.* credentials. (068-inpost-shipping)
- TypeScript 5.x `strict`, Node.js ≥ 22.17 (backend + admin), ESM. (067-product-feed)
- PostgreSQL for feed configuration, taxonomy reference data, run history and issue records; (067-product-feed)
- TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ — **no new runtime (068-ergonode-pim-sync)
- PostgreSQL — 10 new tables owned by `pim_ergonode`, 1 new column on `catalog.categories` (068-ergonode-pim-sync)
- TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ (backend); React 19 + Vite + react-router-dom 7 (admin); Next.js 15 App Router + React 19 (storefront). **No new runtime dependency** (Constitution IV, FR-062) (073-lifecycle-gating-completion)
- PostgreSQL. No new table. One new column-free path: activation values live in the existing `settings` rows (`global_value` / `default_value`); platform availability stays in `module_registrations` (073-lifecycle-gating-completion)
- TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ. **One new runtime dependency: `awilix`** — see Complexity Tracking (072-module-kernel-di)
- PostgreSQL. No schema change of its own. Three entity relocations follow D-32: `audit_logs`' service and entity, the settings store, and the `sales_channels` resolution machinery move into the kernel package (072-module-kernel-di)
- TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ — **no new runtime (089-unopim-pim-sync)
- PostgreSQL — ~12 tables owned by `pim_unopim`, 0–2 small tables owned by `pim_connector` (089-unopim-pim-sync)
- TypeScript 5.x strict on Node.js >= 22.17 for Endora; PHP 8.2+ package code in the sibling `pim-integrations` workspace + Existing Fastify, MikroORM, Zod, ioredis, BullMQ, React 19 and platform ports; PHP uses the existing Pimcore/Symfony/Composer stack; **no new runtime dependency** (089-pimcore-pim-sync)
- PostgreSQL for connection, delivery, complete-record inbox, source/media links, protection, run and issue state; Redis/BullMQ for durable asynchronous apply and stale-run recovery (089-pimcore-pim-sync)

- TypeScript 5.x strict on Node.js ≥ 22.17; Fastify + MikroORM (PostgreSQL) + Zod + ioredis + BullMQ + Meilisearch (backend)
- React 19 + Vite + react-router-dom 7 + Tailwind 4 (admin); Next.js 15 App Router + React 19 + Tailwind v4 (storefront)
- PostgreSQL via MikroORM, module-scoped timestamped migrations (feature 065)

## Project Structure

See "Repo map" above.

## Recent Changes
- 089-unopim-pim-sync: Added TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ — **no new runtime
- 089-pimcore-pim-sync: Added TypeScript 5.x strict on Node.js >= 22.17 for Endora; PHP 8.2+ package code in the sibling `pim-integrations` workspace + Existing Fastify, MikroORM, Zod, ioredis, BullMQ, React 19 and platform ports; PHP uses the existing Pimcore/Symfony/Composer stack; **no new runtime dependency**
- 068-inpost-shipping: InPost ShipX PL module (`inpost`) — dual shipping adapters, Geowidget v5, BullMQ poll, PDF labels; orders `shipping_adapter_data`.
- 072-module-kernel-di: Added TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ. **One new runtime dependency: `awilix`** — see Complexity Tracking
- 073-lifecycle-gating-completion: Added TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ (backend); React 19 + Vite + react-router-dom 7 (admin); Next.js 15 App Router + React 19 (storefront). **No new runtime dependency** (Constitution IV, FR-062)
