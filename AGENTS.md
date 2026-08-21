# Endora Commerce (b2b-platform) — Agent Instructions

Last updated: 2026-08-10

**This file is the single source of truth for every AI coding agent working in this
repository.** `CLAUDE.md` and `.cursor/rules/specify-rules.mdc` are thin pointers to it —
put shared knowledge here, never in a pointer. Cursor, Codex, Amp and other AGENTS.md-aware
tools read this file directly; Claude Code reaches it through the `@AGENTS.md` import in
`CLAUDE.md`.

## Stack

- **`backend/`** — TypeScript 5.x strict on Node.js ≥ 22.17. Fastify, MikroORM (PostgreSQL),
  Zod, ioredis, BullMQ, Meilisearch, `nodemailer`, `pdfmake`. Cross-cutting infrastructure:
  in-process `EventBus` (`src/events/bus.ts`), Command Bus (`src/commands/`), TenantContext
  (`src/tenancy/`), module lifecycle (`src/modules/_lifecycle/`), i18n (`src/modules/_i18n/`).
- **`admin/`** — React 19 + Vite + react-router-dom 7 + `@b2b/api-client` + `lucide-react` +
  Tailwind 4 + Radix/shadcn primitives; `@measured/puck` for the CMS/e-mail builders;
  `@dnd-kit` for drag-drop; charts through the `<EChart>` wrapper
  (`admin/src/components/charts/echart.tsx`).
- **`storefront/`** — Next.js 15 App Router + React 19 + Tailwind v4, Server Components and
  server actions.
- **`packages/`** — `contracts` (Zod schemas: the source of truth for every API shape),
  `api-client`, `cms-components`, `email-components`.

**A new runtime dependency needs written justification** in the feature plan's Complexity
Tracking section (Constitution IV). The default answer is "no new dependency" — reuse what
is already in the stack.

## Repo map

| Path | Contents |
| --- | --- |
| `backend/src/modules/<id>/` | A domain module: `backend.ts` (composition), `entities/`, `services/`, `routes.ts`, `manifest.ts`, `migrations/`, `i18n/`, optional `plugin.ts`, `actions/`, `workers/` |
| `backend/src/apps/<deployment>/modules/<id>/` | Per-deployment overlay modules (feature 057) |
| `backend/test/{unit,contract,integration,perf}/` | Backend tests, mirroring module names |
| `specs/NNN-slug/` | Feature artifacts: `spec.md`, `plan.md`, `research.md`, `data-model.md`, `contracts/`, `tasks.md` |
| `.specify/memory/constitution.md` | Binding principles — read before designing anything |
| `docs/` | Docusaurus site (end-user and engineer documentation, English only) |

## Commands

```bash
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

**Which backend test command to use.** `test:unit:fast` (config: `backend/vitest.unit.config.ts`)
is the one to run while you iterate and the one CI runs on every backend MR as `test:backend:unit`,
with no service containers: 324 files in 96 s, against 316 files in 252 s for `test/unit` alone
under the complete config. It skips the 16 unit files that genuinely talk to a live Postgres or Redis —
each named with a reason in `backend/test/service-dependent-unit-tests.ts`, each still run by the
complete suite, and `test/unit/harness/service-dependent-ledger.test.ts` fails if that list drifts
in either direction. Choosing that config **is** the run's declaration that it has no services
(`BACKEND_TEST_SERVICES=none`); the declaration is never inferred from a connection that failed,
and a test that needs a service stops the run with a sentence naming the ledger. The remaining
`test:unit` / `test:contract` / `test:integration` scripts, and `test` itself, are the complete
side and need the services; `test:backend` in CI shards them five ways and still takes the better
part of an hour.

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
  the global-filter guard in `backend/src/tenancy/`. A design with a "no-organization" path
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

**A module is composed by the kernel container, not by a composition root.** All 65 core
modules export `registerModule(ctx: ModuleContext): void` from `backend/src/modules/<id>/backend.ts`;
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
   before the first request. The classification is not CI bookkeeping: the same artefact is what
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

1. **`manifest.ts`** — `permissions: [{ code, label, module? }]` for every code this module owns.
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
4. **i18n** — `adminRoles.permission.<code>` in `_i18n/i18n/en.json` and `pl.json`.
5. **AppShell** — `requiredPermission` on nav entries where applicable.
6. **CI** — `pnpm --filter backend exec vitest run test/contract/admin_users/permission-inventory.test.ts`
   before opening the MR. It sweeps **both** directions — enforced ⇒ grantable and
   grantable ⇒ enforced — plus the label coverage, so a permission declared before its
   gate lands fails just as loudly as one gated before it is declared.

Do not duplicate shared codes from core `PERMISSION_CATALOGUE`
(`packages/contracts/src/admin.ts`). Contract:
`specs/026-admin-roles-permissions/contracts/module-manifest-permissions.md`.

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

The gating wrappers exist in `backend/src/kernel/lifecycle/` (`defineModuleRoutes`,
`defineModuleWorker`, `subscribeForModule`, `requireModuleEnabled`) — extend them to the
effective state rather than adding a parallel check. They live in the kernel, alongside the
registry cache, the activation resolver and the effective-state combiner, because the kernel
applies them to every module it composes and may not import from `src/modules/` (D-37).
`_lifecycle` keeps the operator-facing half: the manifest, the permissions, the routes, the
Commands, the orchestrator and the `module:*` CLI scripts.

**You almost never call those wrappers yourself.** All 65 core modules are composed through
the kernel container (feature 072), and `ctx.routes` / `ctx.worker` / `ctx.subscribe` apply
the wrappers for you — see the composition checklist above. **A per-deployment overlay module
under `backend/src/apps/<deployment>/modules/` is composed the same way** (D-103): it ships
`backend.ts`, gets an ordinary `ModuleContext`, and calls the same seams. Call the wrappers
directly only where there is no `ModuleContext` — a CLI entry point. Four core modules
(`newsletter`, `product_feeds`, `pim_ergonode`, `ksef`) still wrap a second time inside their
`plugin.ts`; that is conversion residue, not a pattern to copy.

1. **Routes** — wrap the module's route registration in `defineModuleRoutes('<id>', …)` so
   gating holds at the registration seam for every route the module owns, including later
   ones. Never gate per handler.
2. **Workers and subscribers** — register BullMQ workers through `defineModuleWorker` and
   EventBus subscriptions through `subscribeForModule`, so both stop when the module is off.
   In a composed module that means `ctx.worker` / `ctx.subscribe`, and the subscription is
   registered from `backend.ts` — a handler kept in a service is fine, a **registration**
   kept in a plugin body is what produced twenty-two ungated subscribers (issue #107).
   `pnpm --filter backend run check:subscribe-seam` fails the build on a bare `eventBus.on`
   in a module, against an empty two-way ledger.
3. **Cross-module calls** — the gate is the **port registration**, not a call you write.
   `ctx.di.providePort('<name>', …)` wraps the registration in a transient gate on the owner's
   effective state, so a consumer resolving it through `lazyPort` gets the 503 `MODULE_DISABLED`
   envelope at the call site instead of a half-executed operation. That is the whole instruction for
   an entry point another module can reach: **publish it as a port and declare the edge** (composition
   checklist items 2–4). A gate the registration applies cannot be forgotten in the one service
   somebody adds later, which a hand-placed call can and did.

   `requireModuleEnabled('<id>')` (`backend/src/kernel/lifecycle/plugin-helpers.ts:82`) is kept for
   the entry point that has **no port and no request** — a `module:*` CLI script, a one-off
   maintenance entry — and it has **zero call sites in `src/` today**; this item used to instruct
   every module author to call it, which is how it came to be cited far more often than used.
   `check-port-catches.ts` knows the spelling, so a `catch` around one is refused like a `catch`
   around a port.

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
   The file lands in `backend/src/modules/<id>/migrations/` (or `backend/src/db/migrations/`
   for `--module core`), named `<YYYYMMDDTHHmmss>_<module-segment>_<slug>.ts` with a UTC
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
5. **Renaming an applied migration class costs a database rebuild.** Since feature 072 there
   is no frozen name map and nothing in the repository forbids the rename — but
   `mikro_orm_migrations` stores the **class name**, so every database that already ran the
   migration under its old name will see the new name as pending and try to re-apply it.
   Rename only when moving a migration between groups is genuinely required (as feature 072
   T020 did), and ship the rename with a note telling every developer to rebuild:
   `DATABASE_URL=…/b2b_test_tpl pnpm --filter backend run db:fresh` plus
   `pnpm --filter backend run db:reset` for the dev database. The template is the database the
   test suite migrates since issue #189; dropping it is the other way to force the rebuild,
   since the next invocation recreates it.
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
module's `entities/`, run `composer:generate`, commit the artefact. Both registries are
core-only — an overlay module cannot ship a migration, so the generator refuses an entity or
a migration under `backend/src/apps/` rather than emitting schema nothing creates.

Full guide: `docs/docs/architecture/migrations.md`. Contracts:
`specs/081-per-module-migration-order/contracts/ordering-algorithm.md` (normative for the
order) and `migration-identity.md` (naming and uniqueness);
`specs/065-manifest-aware-migrations/contracts/naming-convention.md` §1–§2 (still the only
filename and class-name recognizers) and `fk-dependency-check.md`. The `065` ordering contract
is superseded.

### i18n

All user-facing strings ship in **both `en` and `pl`**; a static CI check rejects hard-coded
literals in the admin SPA (`pnpm --filter backend run i18n:hardcoded`, in the `quality` job since
issue #116 — before that it was cited here while running nowhere). It compares the tree to
`HARDCODED_STRINGS_BASELINE`, a **per-file two-way ratchet** over the 274 pre-existing findings: a
new hard-coded string fails, and so does a baseline number left standing after the strings under it
were translated. Never raise a number to make the build pass — add the key. Run
`pnpm --filter backend run i18n:hardcoded -- --strict` to see the whole remaining debt, or pass one
path while draining a screen.

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
`backend/test/unit/scripts/check-read-size.test.ts` spawns all twenty-seven checks and holds
each printed number to the band recorded in `backend/test/helpers/check-read-sizes.ts`
(−10% / +50%). Re-record a number when the population legitimately grows; never widen the
band to make a run pass.

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
`backend/scripts/lib/module-population.ts`, thirteen callers, and never a count written
down (D-100). `backend/test/unit/scripts/moved-module-tree.test.ts` spawns each of them
over a fixture backend whose modules are gone and whose registry still lists them; the
inventory's `residueGuard` field is the two-way link to it.

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

### The full inventory

Every check that runs in CI, so a rule cited nowhere here stops being a rule nobody knew about
(issue #137 — `check:harness-teardown` had run in every pipeline since issue #111 while this
file had never heard of it). Run with `pnpm --filter backend run <name>` unless the row says
otherwise. `backend/test/unit/scripts/check-inventory.test.ts` is the machine-checked version
of this table: it enumerates every `check-*` script and fails on one it does not name.

| Script | Job | What it refuses |
| --- | --- | --- |
| `check:action-route-permissions` | `quality` | A manifest action whose `requiredPermission` is not the code enforced on its own `targetRoute` (issue #232; Principle XVI item 2). The permission inventory sweeps two directions — enforced ⇒ grantable, grantable ⇒ enforced — and **both** defects that produced this check passed it: `settings`' palette entry declared no code at all against a `settings:read` route, and `inventory`'s declared `catalog:write` against an `orders:read` one. Real codes, enforced somewhere, on the wrong route: a set sweep cannot see either. Three findings — **missing**, **mismatched**, and **unresolvable**, which covers a `targetRoute` no registration matches, candidates that disagree, and a `preHandler` it cannot read (that last one matters most: an unreadable gate taken for "ungated" agrees with everything). Agreement is **sufficiency, not equality** — holding the declared code alone must open the screen — so either member of `requireAdminAny([…])` passes and a conjunction of two guards passes for nobody; the codes are opaque strings, so `catalog:write` does not satisfy a `catalog:read` gate. The SPA `targetRoute` is linked to an API path by nothing in the tree, so the check reconstructs the **entry route** in three levels (exact, subtree, then the owning module's own routes, for a screen whose placement is not its API path), and flips to the create route for a `/new` target. `ACTION_PERMISSION_DISAGREEMENTS` is two-way and holds the three verb-labelled actions whose screen needs a read code to open and a write code to use — one field cannot say both, and the choice is the owner's. |
| `check:command-coverage` | `quality` | A sensitive write that neither runs a Command nor records an audit row (Principle XIII). `--strict` in CI, so a finding in any module fails. The vocabulary is `persist*`, `nativeUpdate`, `nativeDelete`, `remove*`, `flush` and — since D-89 — **`create`**, the last two only off an EntityManager receiver, because both are ordinary service vocabulary. It reads **call** shapes: a field assignment on a managed entity (`order.status = ref`) is a write the unit of work will flush and this check **cannot see it**, refused in writing rather than deferred, so its green means "no unaudited write of a shape this check can see" and not "every sensitive write is audited". The staleness half reports a `command-coverage-ignore` guarding nothing, and since D-89(c) a downstream write that carries **its own** marker no longer keeps a caller's marker alive. |
| `check:container-imports` | `quality` | A module importing the container library — a module sees `ModuleContext` and nothing else (feature 072, FR-032). |
| `check:diacritic-folds` | `quality` | **Three signals over one population: this repository folds diacritics, and builds a slug, in exactly one place.** (1)+(2) A diacritic fold written outside `packages/contracts/src/text-normalization.ts` (issue #240). `normalize('NFD').replace(/\p{Diacritic}/gu, '')` reads as complete and is not: `ł` is a standalone code point with no canonical decomposition, so NFD leaves it where it was and the strip removes nothing. Four private copies had grown by !745 — typing `naglowek` found no block named `Nagłówek`, and `platnosci` found no `Metody płatności` in any picker. It refuses the **decomposition**, not "a decomposition followed by a strip": a proximity window is escaped by moving one line into a helper, and half a fold is still a second implementation. So a literal naming `NFD`/`NFKD` (`NFC`/`NFKC` compose and are outside the rule), and a combining-mark class in any of four spellings, including the U+0300–U+036F range written as raw characters, which a grep for `\u0300` cannot see. (3) **`slug-run`** — a `.replace()` collapsing a run of non-ASCII-alphanumerics to a separator, i.e. slug construction, which since issue #245 also has one owner (`slugify`, same file). It exists because signals 1 and 2 had **a population defined by the presence of the thing they check** (issue #244): a site that folds nothing writes no `NFD` and no `\p{Diacritic}`, so its absence was undetectable, and two slug builders shipped that way for a year — `Żółw` produced `w`, `KAT_ŁĄCZNIKI_01` produced `kat-czniki-01` — while the check printed `violations=0`. The third signal keys on the **builder**, which is present whether or not the site folds, so the rule is *"slug construction has one owner"* and **not** *"a slug builder must fold"*: the second would need dataflow the expression cannot carry, and the first caught `BlogPostEditor`, a ninth private copy that folded perfectly and was invisible to everything. The **run collapse** is what keeps that population honest, and it was measured rather than asserted: any negated ASCII-alphanumeric class matches 9 sites and 7 of them legitimately need no fold (a payment hash seed, an XML element name, a DOM `id`, a Meilisearch index name, a test database name), which would be a ledger that is mostly exceptions; requiring the collapse leaves 4, of which none is an exception. Two spellings — quantified in place (`[^a-z0-9]+`) and collapsed by a later `.replace` **in the same call chain** (`.replace(/[^a-z0-9_]/g, '_').replace(/_{2,}/g, '_')`); the window is one expression and stops there, in the idiom of `check-port-catches`. It cannot see a computed class, a builder written with `split`/`join`, a collapse split across two statements, or a bare `[^a-z0-9]` with no collapse at all — each stated in the header rather than discovered later. All three signals read literal **AST nodes**, so the files that quote the wrong one-liner or the wrong chain to say why they do not use them are out of the population by construction. **The population is the whole tree** — `admin`, `backend`, `storefront`, `packages` — since the fold was extracted as `foldDiacritics`: it had been correct and reachable all along, but it was named `normalizeOrganizationName`, so six authors wrote their own instead of finding it. Out: `backend/scripts` and `backend/test/unit/scripts`, whose job is to spell the shapes the rule refuses. The helper's exemption is one exact path, never a filename rule (issue #197) — there are two files called `text-normalization.ts` and only one is exempt — and that same path is the vacuous-pass guard: a helper that is gone, or that no longer parses as **all three** shapes, is exit 2, the third because `slugify` is the import every `slug-run` message tells the author to use. **Two ledgers, both per-file two-way count ratchets**, because they answer different questions and one count over both kinds would make "never raise a number" ambiguous. `DIACRITIC_FOLDS_ALLOWED` is **empty**: it opened with four slugifiers, !753 repaired the admin pair and issue #245 the backend pair, under one owner ruling — new values are to be correct, historical ones are not migrated. `SLUG_RUNS_ALLOWED` holds **two**, both `pim_ergonode` key derivations, and neither is an exception to the rule: both are the same defect deferred because they are **lookup** keys re-derived on every import run to find a row a previous run created, so a repaired derivation grows a second attribute beside every Polish-coded one rather than fixing it. That is what #245's ruling does not reach, and it is the retiring condition. An entry that ever says "this is not a slug and needs no fold" means the predicate has outgrown its population — narrow it, never add the entry. |
| `check:doc-snippets` | `quality` | A code block marked `<!-- verbatim-from: <path> -->` that no longer appears verbatim in that file. The quickstarts are copied by every module conversion, so a stale snippet is a defect scheduled for mass production. |
| `check:entry-presence` | `quality` | A module-owned `setInterval`, self-rescheduling `setTimeout`, `process.on` handler or **working `ctx.onBoot` hook** that does not decide presence before it works (issues #126, #146). A contribution hook passes silently; one that mixes work with a contribution is reported as `mixed-boot-hook`, and its remedy is "split it first", never "probe the top" — probing a mixed hook stops the contribution too. Non-deactivatable modules are out of the boot-hook population, derived from their manifests through `scripts/lib/switchable-modules.ts` (shared with `check:port-catches`). `TIMERS_WITHOUT_PRESENCE` and `BOOT_HOOKS_WITHOUT_PRESENCE` are two-way and are not expected to empty. |
| `check:entry-scope` | `quality` | A non-HTTP entry **site** that does not establish its scope explicitly (feature 072, FR-020). Six classes: a CLI script and a declared program (one site per file — the file's own top-level execution), and one site per `new Worker(...)`, per repeating timer, per `x.on('message', …)` and per `process.on/once(...)`. It classified **files** until issue #237, and a file reported `scoped` the moment one of its entry points was right: that is how `kernel/lifecycle/registry-cache.ts` hid a scope-less database read in a pub/sub handler behind a correctly wrapped `setInterval` 130 lines below (issue #235), and how `kernel/container.ts`'s shutdown handler stayed outside the population altogether — it is under no `scripts/` directory, is no declared program, constructs no `Worker` and starts no timer, so no file-level class contained it. A site is scoped when a sanctioned entry function is called in its own callback or **one hop** into a function bound in the same file; deeper, an imported delegate and a `this.<method>()` delegate all read as unscoped, which is the direction a blind spot has to fail in. The population's second source is issue #228's: every `src/**.ts` path a `backend/package.json` script runs, because the shape classes were written from what the tree held when FR-020 landed and `src/seeds/dev-catalog-seed.ts` was none of them. `NO_SCOPE_NEEDED` is keyed `<file>:<enclosing name>:<construct>` — line-independent, two-way — and it prints `sites=` and `files=` so a widening that moved no population size is visible as having moved nothing. Exits 2 on an empty declaration source, on a declaration that resolves to no walked file, on no site at all, and on no worker/timer/handler site at all — the file-level classes keep printing numbers while the syntax walk is blind. |
| `check:error-translations` | `quality` | An operator-visible error code with no sentence in both shipped languages. The envelope replaces the message wholesale, so a missing key renders the raw code and nothing reports it. Ledger may only shrink. |
| `check:fixture-substitution` | `quality` | A test that turns "the row is not there" into a value that looks like data (issue #159). Six files carried `(await em.findOne(SalesChannel, { systemDefault: true }))?.id ?? ''` and were green only because another file's `setupBackendServer` had created the channel first. Sees both shapes (two-step and inline) and the fabricating fallbacks — a string, a number, `randomUUID()`; `?? null`, `expect(x ?? null)` normalisation and a fallback that *creates* the fixture are outside the population, because each keeps the absence visible. Since issue #275 it also sees the **binding shape**, which is a third axis and was the blind one: `const [channel] = await em.execute(…)` bound no name, so the `??` under it was rooted in nothing and the file read clean — two live sites defaulted the system-default channel's language and currency that way, on a row D-47…D-51 says always exists. The dialect was never the gap (`execute` and `getConnection().execute` were in the vocabulary from the start, and the same destructuring hid an ORM `find` just as completely); the one dialect that was, a `getKnex()` builder chain naming no read at its tail, is closed with it. It follows receivers and callees and **not arguments**, so a read inside `Promise.all([…])` is invisible, and it does not follow a read through a helper into another file. `DEFAULTED_FIXTURE_READS` is two-way and is not expected to empty: an entry says why the fallback is right. |
| `check:harness-teardown` | `quality` | A test that releases a `setupBackendServer` resource itself instead of calling `teardownBackendServer` (issue #111). A hand-written teardown is a copy of the seam frozen when it was copied, so it cannot learn about the awilix container or the pub/sub Redis client, and both leak for the length of the single-fork run. `HAND_RELEASED_RESOURCES_TO_DRAIN` is an empty two-way ratchet. |
| `check:kernel-boundary` | `quality` | An ORM relation from a module into another module; a module may relate into the kernel, the kernel into neither (feature 072, D-32). |
| `check:lock-claims` | `quality` | A reason string asserting a lock the manifests contradict (issue #216). D-100 forbade the shape in acknowledged-edge reasons because a hand-written copy of a derived fact goes stale silently; it was found twice more within a day, once in a **ledger shard**, which D-100 does not cover — so the prohibition holds for **any reason string anywhere**, enforced by derivation. The locked set comes from `scripts/lib/switchable-modules.ts` on every run, never a list: un-lock a module and every sentence resting on the lock goes red in the same pipeline, with no ledger to edit. Two signals — a lock claimed over a module that has an activation control (the shape that withdrew a written port conversion, its load-bearing step spelled *"is always present"* without ever writing the word), and switchability claimed over a locked module (`catalog` carried one for `price_lists` across two features). The population is the artefacts whose job is to carry a reason: ledger shards, the ledgers that live inside a check, every module manifest — comments included, since that is where the #216 claim sat — and, since issue #279, **`packages/contracts/src/**`**, because a published port's doc block is where its "when the owner is switched off" paragraph belongs and it is written about another module: a hedged one got written on the author's own judgement, and the unhedged alternative would have passed silently. Nine named-subject claims stand across the widened population, none of them stale, so the widening cost no repair — what it removed was the dependence on an author being careful. A claim must **name its subject** as a backticked module id; a pronoun subject (*"this module is…"*) is out of the population by construction, and ordinary source comments are out by decision. **No ledger, deliberately**: a claim the manifests contradict is never right to stand, so an entry could only license re-opening it. Exit 2 six ways — no artefacts, an index that would not load, no module ids, an empty locked set, (issue #215's shared floor, since the manifests *are* a module walk) a walk that came back short of the modules the index registers, and a **contracts** walk that came back short of the files `packages/contracts/src/index.ts` re-exports. That last floor is derived the same way the module one is, from the package's own barrel rather than from a number, and is printed as `contracts-barrel:<covered>/<expected>`. |
| `check:module-boundary` | `quality` | **Two predicates, one ledger.** (1) A module naming an import specifier that resolves into another module's directory (Principle I; feature 075). Every specifier shape, `import type` included — it is 43% of the debt, and ESLint's `prefer: 'type-imports'` would otherwise launder value imports into it. (2) A module naming another module's **table** (feature 077, D-87) — 121 such reaches stand today, invisible to predicate 1 because SQL names no specifier, and a `violations=0` that cannot see them licenses a package split that is 121 couplings short of true. It reads a table identifier **two ways**: a SQL **statement** in a string or template literal, and a knex query **builder** (issue #187), which names its table as a call argument and so was invisible to the statement path too — ten reaches in six files, including the channel→warehouse join inside placement. The builder's method list (`from`, `into`, `table`, the join family, plus the knex callable itself, recognised by its `getKnex()` binding) is **enumerated**: `where`/`select`/`orderBy` take columns, and matching any string on any method would fill the ledger with them. The table→owner map has **two sources and needs both**: `@Entity()` table names (220) and `create table` DDL (21 more, every join table and every `sales_channel_*` bridge among them); a core-block table is attributed to the module that owns the table its name begins with. The predicate reads literal **nodes**, so a comment is out of the population by construction. The ledger is **sharded per consumer module** under `backend/scripts/ledgers/cross-module-imports/`, so a cut touches one file; it fails eight ways — unledgered reach, stale entry, empty shard, orphan shard, entry filed under another module's shard, a `permanent: true` entry with no retiring condition, an entry whose **recorded count** disagrees with the walk (issue #267), and a shard that **declares an entry type of its own** (issue #217). The last one is what makes the sixth reachable: 29 of the 33 shards were typed `Readonly<Record<string, string>>`, in which a permanent entry is a type error, so a co-transactional seam could claim permanence in prose only — it counted toward `ledger-size` as debt nothing would drain and the retiring-condition rule had no field to run on. The declared type is read from each shard's own source, since the imported value has already lost it. The key is `(file, target)`, which answers "is this file already known to reach that target" and not "how much", so an entry also carries a **count**: `{ sites, reason }` where the file reaches its target more than once, a plain string — meaning one — where it does not. It is **omittable** because 60 of the 68 keys covered exactly one reach when it landed, and the default fails closed; both directions fail, a count below the walk being the reach nobody was asked about and a count above it the stale entry one granularity down. A permanent entry carries it on the same terms, permanence answering why an edge stands and never why it stands twice. `ledger-size` is derived and printed, never written down, covers both kinds, still means **keys** (the cut that retires an entry removes every reach under it; the site total is printed beside it as `(sites=…)`), and excludes the permanent entries: an edge a foreign key holds co-transactional is not debt (D-77), so it is declared `{ permanent: true, reason, retiredBy }`, printed separately, and refused if `retiredBy` names the sweep. Exit 2 when **either** owner-map pass resolves zero tables — a half-blind map reports fewer findings rather than an error (issue #113). |
| `check:nul-bytes` | `quality` | A raw NUL byte in a source file (issues #182, #190). Git classifies a blob carrying one as binary, so every diff of that file renders as `Binary files differ` — the artefact that would reveal the byte is the one the byte switches off, which is how six files kept a raw NUL in a template literal through every review of every commit that touched them. The separator is right in all six; only its **spelling** is wrong, and `\0` compiles to the same byte, so no digest and no map key moves. Reads the **whole file**, not git's own first 8000 bytes: one of the six sat at byte 8032 and git itself still called it text. The population is everything under the repository root minus two *declared, reasoned* exclusions — `SKIPPED_DIRECTORIES` (trees that are not this repository's source) and `BINARY_EXTENSIONS` / `BINARY_FILENAMES` (file types that are bytes by definition). Deny-list on purpose: an allow-list of known-text extensions leaves the next `.sql` or extension-less script silently unscanned. `NUL_BYTES_ALLOWED` is an empty two-way ratchet, and hard to add to — a hostile-input fixture does not qualify, because `'\x00'` and a raw NUL build the same string. |
| `check:port-catches` | `quality` | A `catch` that swallows `ModuleDisabledError` — see composition checklist item 7. Since D-88 it also follows the gate **one hop backwards**: a method of the same class whose body reaches a port carries, for a `catch` around `this.<method>()`, transitively inside the class. That is not the propagation the header refuses — that one carries a call's *result* **forward** into every downstream and produced 39 false findings; this carries a callee's *body* **backward** to the call site, through `this` and nothing else. A free function in another file, a callback from outside the class and a method on a non-port collaborator are all outside it, deliberately; a class method also **shadows** a module-scoped alias of the same spelling. Since issue #278 an alias is visible **where its binding is**: a constructor or function parameter is scoped to the file that *declares* it rather than the module the call site sits in, and a bare identifier resolves lexically, so a nearer binding that *manifestly* holds no port — a literal, a `new` over those — hides a wider alias. The old module-wide scoping was not merely noisy: an author who names a parameter `transitionService` reds an unrelated local of that spelling two files away, and the rename that clears it hid a live fail-open (`orders/prompt-tools.ts`). "The analysis cannot follow this" is **not** "this is not a port", so a call-bound local shadows nothing; and the `OWNER LOCKED` gate merge stays deliberately over-approximating, because that argument is about which owners a site rests on, never about which sites exist. |
| `check:port-dependencies` | `quality` | A cross-module port edge the resolver's manifest does not declare, and an edge with no deactivation-consequence classification — see checklist items 4 and 4a. Also verifies `PLATFORM_OWNED_NAMES`, which grants both of those exemptions, against the three supply sources a composition really has — the two roots and `src/kernel/**` — for four findings: unsupplied, one-root divergence, owned-by-a-module and stale (issue #49). The list stays hand-written; every consequence of being on it is derived. |
| `check:port-shape` | `quality` | **Three signals on a published port, over one population.** (1) An **optional method** on a published port, or on an interface `extends`-ing one (D-97.3). Feature detection through a port is impossible by construction: `lazyPort`'s proxy answers every property with a function, so `if (port.maybe)` is always true and the forward throws when the provider has none — and the proxy cannot be repaired, because an honest property read on a gated name throws. Optional *parameters* and optional *data properties* are untouched. No ledger for it: the single occurrence (`catalog` widening the custom-field read port with `publishInvalidate?`) is deleted, so an entry could only license re-opening it. (2) A **container name** in a port's doc block that is not the name the port is registered under (issue #192) — §1.2 makes that name contract, it is the literal a consumer copies into `lazyPort`, and nothing read it: on the tree the signal landed against, eight of 98 were wrong. Two shapes, and they fail differently: a name nothing registers throws `is not registered in this composition` at first call, while a name that resolves to the **ungated** legacy twin does not fail at all — `AdminRolePort` documented `adminRoleService`, a plain `di.register` whose `list()` returns entities structurally assignable to the record type, so a consumer following the doc got no `MODULE_DISABLED` gate and no `tsc` error. The second shape needs the registration's type argument, so it sees only the `providePort<T>` calls that carry one. A doc block may name **more than one** container, because a published shape may have more than one provider (`OrderStatusRegistry`, registered by `payment_methods` and by `delivery_methods`); `PORTS_WITHOUT_A_REGISTRATION` answers for a port with *no* provider, is two-way, and is empty since D-98.5. (3) A module **resolving, cross-module, a container name no contract publishes** (issue #196, D-98.2) — signal 2's edge walked the other way. It has to be checked on the *name*, at the *resolution*: `lazyPort<T>` is `new Proxy({} as T, …)`, so `T` is asserted and nothing compares it to the registration, which is why branding the record types was rejected — a brand bites only where the compiler compares, and here it never does. !698 corrected the docs and three consumers went on resolving the class name, invisible to everything. 33 sites over 10 names when it was written; the two-way `RESOLUTIONS_OF_UNPUBLISHED_NAMES` ledger keeps 3, and issue #209 drained the last that were repairs rather than rulings. One of them was **two answers under one key**: `catalog` named `customFieldDefinitionService` four times because both roots had handed the owner's one service to two different options, so the definition *read* and the transactional *apply* seam were indistinguishable from the container's side. The read half re-points to the published `customFieldDefinitionReadPort`; the apply half stays, because every method of `CustomFieldDefinitionApplyApi` takes the caller's `EntityManager` (D-77, FR-034). The three that remain are all of that shape — a seam a foreign key holds co-transactional — and retire with F4 package entry points, not with a doc fix. Self-resolutions and **cradle** reads are out of the population and both are proven by a discrimination fixture, the second because a cradle name is a contribution seam a root supplies. Exit 2 five ways, one per input a signal could be silently missing: no sources, no port type, no registration, no published container name, no `lazyPort` resolution. |
| `check:shared-table-wipes` | `quality` | A test that empties a shared table instead of scoping its fixtures (issue #166). Eight comparison files ran `nativeDelete(Comparison, {})` in a `beforeEach`, which is what let four of them assert `toHaveLength(1)` over the whole table — a claim about the platform, not about the row the test created. Sees all three spellings: the ORM filter left empty, a `truncate`, and a `delete from` with no `where`; a filtered delete of any size is the repair and is not reported, and the harness's own `SEEDED_TABLES` truncate is the seam rather than an instance of it. `UNSCOPED_WIPES_BASELINE` is a **per-file two-way ratchet** over the 197 wipes standing when it landed — a new one fails, and so does a number left standing after the deletes under it were scoped. Never raise a number to make the build pass. |
| `check:subscribe-seam` | `quality` | A bare `eventBus.on` in a module instead of `ctx.subscribe` (issue #107). Empty two-way ledger. |
| `check:transaction-context` | `quality` | SQL written inside a transaction that does not run inside it (issue #200). `em.getKnex()` is `getConnection().getKnex()` and a connection is not a transaction: the statement takes its own pooled connection and commits immediately, so the enclosing rollback cannot reach it and a read cannot see the transaction's own writes. `PromotionUsageService.finalize` incremented usage counters that way — a cap hit rolled the order back and left a redemption row pointing at an order that never existed (D-94) — and the sweep found 65 more (51 of them writes), including a megamenu tree a refused save deleted outright. Two shapes: a `getKnex()` call, and a `getConnection().execute(sql, params)` with no transaction context as its fourth argument. The population is only what is **lexically** decidable — the body of a `transactional(` callback and a Command's `run`, which `CommandBus.run` executes inside a transaction — because whether an arbitrary method has one open is a question about its callers; the repair (`em.execute(sql, params)`) needs no such knowledge, being identical outside a transaction. `CONNECTION_LEVEL_SQL_IN_TRANSACTIONS` is an empty two-way ledger. |
| `i18n:hardcoded` | `quality` | A user-visible literal in the admin SPA — see the i18n checklist above. |
| `overlay:check` | `quality` | A generated artefact that is stale, missing, or rendered empty: the composer, the manifest index, both `db/` registries, and every override manifest — bare core plus one per deployment under `backend/src/apps/` (issue #120). |
| `pnpm run check:naming` | `quality:static` | Principle VI, above. |
| `pnpm run check:language` | `quality:static` | Principle VIII, above. |
| `pnpm run check:pdfmake-footprint` | `quality` | A pdfmake font bundle over the single-VPS disk budget (Constitution IV). |
| `pnpm changeset:status --since=…` | `release:changeset` | A merge request that changes a package under `packages/` and carries no changeset (D-107). Not a `check-*` script and deliberately not one: `changeset status` is the changesets CLI's own command for the question, so there is nothing of ours to keep correct and nothing for `check-inventory` to name — its `script` field must resolve to a file in this tree, and a vendored CLI is not one. See *Release intent — changesets* below. |

Two more run in the same job with no npm script of their own, through
`pnpm --filter backend exec tsx scripts/<name>.ts`: `check-entity-tenant-classification`
(every persisted entity carries exactly one tenant-scope decorator, feature 050) and
`check-channel-resolution --enforce` (no re-resolution of the sales channel outside the
canonical resolver, and no settings read naming its channel with a string literal — feature
053 FR-011, feature 072 D-42).

## Release intent — changesets

Release tooling is **Changesets** (`@changesets/cli`, a root devDependency), adopted by owner
ruling **D-107**; **D-108** sets the versioning model. Both are in
`specs/080-f4-real-scope/rulings.md` and are settled — do not re-open them, and in particular
do not reach for Lerna, `semantic-release` or conventional-commit inference.

**The rule: a merge request that changes a file under `packages/` carries a changeset.**
That is the entire trigger. `backend`, `admin`, `storefront` and `docs` are in the config's
`ignore` list and never need one — they are applications, and nobody consumes them by version.

```bash
pnpm changeset             # write one (interactive)
pnpm changeset --empty     # record "this change carries no release meaning"
pnpm changeset:status      # what would be bumped
pnpm changeset:version     # consume the changesets: bump versions, write CHANGELOG.md
```

Where a change genuinely has no release meaning — a comment, a test, a rename crossing no
export — write the empty changeset rather than looking for a way past the gate. It puts a
human's "I looked, there is nothing to release" in the diff, where a reviewer can disagree
with it.

A good changeset is written **for the consumer of the package**, not for the reviewer of the
branch: name the exported symbol, and for a `major` give the old call and the new one, because
nothing else in this repository will tell an upgrader what to do. One file per meaning, not
one per merge request. **The bump level is your judgement and cannot be delegated** — that is
why D-107 chose this tool: a change to `@b2b/contracts` can be breaking for `@b2b/api-client`
and inert for `@b2b/cms-components`, and no commit prefix knows which.

**Versioning is independent, with one `linked` group** (D-108):
`@b2b/page-builder-core`, `@b2b/cms-components` and `@b2b/email-components` take one version
number whenever a release includes more than one of them. `page-builder-core` is a **peer**
dependency of the other two and ships React contexts and hooks, so the consuming application
resolves exactly one copy; ranges that disagree resolve two, and a provider in one copy against
a consumer in the other is a `null` context at runtime, not a type error. A release of
`page-builder-core` therefore always carries all three; a patch on `cms-components` alone moves
only itself, which is correct — it carries no runtime the app resolves once.
`@b2b/contracts` and `@b2b/api-client` version independently — Changesets patch-bumps a
dependent on its own (`updateInternalDependencies: "patch"`).

Two things about `.changeset/config.json` that are load-bearing and look like boilerplate:

- **`privatePackages: { "version": true, "tag": false }`.** All five packages are
  `"private": true` and stay that way in this repository. `@changesets/config@4` defaults
  `privatePackages` to `false`, which makes every changesets command skip all five and report
  a cheerful nothing — including the CI gate. `version: true` is what makes the tooling see
  them; `tag: false` keeps it from tagging things nobody publishes.
- **`ignore` matches package *names*, not paths.** It is glob-matched against
  `backend` / `admin` / `storefront` / `docs`, the names in those manifests. The
  `pnpm-workspace.yaml` globs decide only what is discovered as a workspace; they do not reach
  `ignore`, and `packages/*` written there would match nothing. A typo fails safe — the app
  stops being ignored and starts demanding changesets, loudly.

Nothing is published yet: the five packages are `"private": true`, there is no `release`
script, and `access` is `restricted`. Making a package public is a separate merge request,
with the meta-package / supported-set question D-108 defers. The longer guide, for the moment
you are writing the file, is `.changeset/README.md`.

## Overlay modules (per-deployment customization, feature 057)

A **client-only overlay module** lives under `backend/src/apps/<deployment>/modules/<id>/` and
is discovered without editing the shared core registry (`REGISTERED_MANIFESTS` stays
untouched — FR-004). It is an ordinary lifecycle participant, so every checklist above
applies, with one difference: its admin permissions must appear on `/admin-roles` and pass
the permission-inventory check **for that deployment** — run the inventory test with
`DEPLOYMENT=<name>` set. Overriding a core **service** is a **decoration**, not a file
shadowing it (feature 072): a file under `backend/src/apps/<deployment>/decorations/`, named
after the registration it wraps, exporting `decorate(inner)` — it receives the core
implementation and returns one that delegates to it, so core fixes keep flowing. `tsc` is the
contract gate: the decoration is written against the core service's `*.interface.ts` and
stops being assignable when that interface changes. A `services/` file under an overlay is
now an **unknown override target** and fails the build.
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
**Out-of-core code contributes no schema** (D-105): a per-deployment overlay module or an
extension package contributes registrations, routes, decorations, interceptors, permissions,
i18n bundles and a manifest, and **no `@Entity()` class and no migration**. That is not a v1
limitation — the migration registry is a committed, ordered artefact whose execution order is
corrected by the module dependency graph, and that correction is only meaningful over a fixed
set; a set that varies per deployment has no single correct order to commit. Ship new schema
from a core module. The generator refuses both (`generate-composer.ts`), which is the same
rule the Migrations section above states.
**Superseded in part — do not cite the rationale above.** D-106
(`specs/080-f4-real-scope/README.md` §2) keeps the rule for **overlay modules** on a different
ground and **overrules it for extension packages**, by an owner ruling: a package may ship its
own entities and migrations. The "fixed set" reasoning was measured false. This paragraph is
rewritten by task T001 of `specs/080-f4-real-scope/tasks.md`; until then, read it as applying to
`backend/src/apps/` only. See
`docs/docs/architecture/overlay-pattern.md` and `specs/057-overlay-pattern-multideploy/`.

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
→ `/speckit.implement`, producing `specs/NNN-slug/`. `/speckit.plan` regenerates the appendix
below through `.specify/scripts/bash/update-agent-context.sh`, which is pinned to write into
this file only (see the repo-local override near the top of that script) — that is what keeps
`CLAUDE.md`, `.cursor/rules/specify-rules.mdc` and this file from drifting apart again.

## Subagents

Role-specialised subagents are defined twice, once per tool, with identical roles:
`.claude/agents/*.md` (Claude Code) and `.cursor/agents/*.md` (Cursor). Their prompts stay
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
agent reads that path directly. Update it in place; never fork a second copy.

---

<!-- Everything below is appended automatically by speckit's update-agent-context.sh.
     Treat it as an append-only log; prune it when it stops being useful. -->

## Active Technologies
- TypeScript 5.x `strict`, Node.js ≥ 22.17 (backend + admin), ESM. (067-product-feed)
- PostgreSQL for feed configuration, taxonomy reference data, run history and issue records; (067-product-feed)
- TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ — **no new runtime (068-ergonode-pim-sync)
- PostgreSQL — 10 new tables owned by `pim_ergonode`, 1 new column on `catalog.categories` (068-ergonode-pim-sync)
- TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ (backend); React 19 + Vite + react-router-dom 7 (admin); Next.js 15 App Router + React 19 (storefront). **No new runtime dependency** (Constitution IV, FR-062) (073-lifecycle-gating-completion)
- PostgreSQL. No new table. One new column-free path: activation values live in the existing `settings` rows (`global_value` / `default_value`); platform availability stays in `module_registrations` (073-lifecycle-gating-completion)
- TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ. **One new runtime dependency: `awilix`** — see Complexity Tracking (072-module-kernel-di)
- PostgreSQL. No schema change of its own. Three entity relocations follow D-32: `audit_logs`' service and entity, the settings store, and the `sales_channels` resolution machinery move into the kernel package (072-module-kernel-di)

- TypeScript 5.x strict on Node.js ≥ 22.17; Fastify + MikroORM (PostgreSQL) + Zod + ioredis + BullMQ + Meilisearch (backend)
- React 19 + Vite + react-router-dom 7 + Tailwind 4 (admin); Next.js 15 App Router + React 19 + Tailwind v4 (storefront)
- PostgreSQL via MikroORM, module-scoped timestamped migrations (feature 065)

## Project Structure

See "Repo map" above.

## Recent Changes
- 072-module-kernel-di: Added TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ. **One new runtime dependency: `awilix`** — see Complexity Tracking
- 073-lifecycle-gating-completion: Added TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ (backend); React 19 + Vite + react-router-dom 7 (admin); Next.js 15 App Router + React 19 (storefront). **No new runtime dependency** (Constitution IV, FR-062)
- 068-ergonode-pim-sync: Added TypeScript 5.x `strict`, Node.js ≥ 22.17, ESM + Fastify, MikroORM (PostgreSQL), Zod, ioredis, BullMQ — **no new runtime

