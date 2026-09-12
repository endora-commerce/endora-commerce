# Module enable/disable — the two axes of presence (Principle XVII)

**Open this before gating anything on a module's presence** — routes, workers, EventBus
subscribers, timers, boot hooks, cross-module calls, admin or storefront surfaces — and before
writing a module's off-state test or its activation declaration. One of the bodies `AGENTS.md`
routes to; it is the single home for these rules, so never restate them in `AGENTS.md` or in a
tool-specific pointer file.

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
`_lifecycle` is the operator-facing half — the manifest, the permissions, the routes, the
Commands, the orchestrator and the five `module:*` commands — and **its sources are
`@endora-commerce/platform`'s**, at `packages/platform/src/lifecycle/`. This paragraph named
`backend/src/lifecycle/` as their home, and it was stale in five of its six nouns *before*
feature 115 touched anything (`specs/115-lifecycle-container-move/research.md` §1.2): D-160.11's
second half had already moved the first five and left twenty-line re-export shims at the old
paths, and D-207 moved the rest. What the application keeps at `backend/src/lifecycle/` is the
wiring an instance must own anyway — the manifest-registry **binding**, which supplies the
generated index and the overlay and package discoverers to the platform's deriver (D115-2), and
one twenty-line entry point per `module:*` command, which opens that instance's ORM and Redis
and calls the body (D115-1). Do not write the file list down anywhere: `ls backend/src/lifecycle`
answers it, and this paragraph is what happens when a derived fact is copied into prose (D-100).

It is still a **registered module that is not a package** (D-160.11): as one, the host would have
to publish twelve platform targets for its sole consumer, and a package that enumerates all of
its siblings is a cycle waiting to be declared. What D-207 changed is the *container*, not that
decision. The surface has an address — `@endora-commerce/platform/lifecycle`, a subpath the
`exports` map **declares** and no *published* barrel carries — so a module naming it is reported
as `host-internal-subpath` by `check:platform-surface` with no change to that check, and
`PUBLISHED_SUBPATHS` stays at five (D-160.14, D115-4). A module that could name this surface
could install, uninstall, enable or disable its siblings, which is `./composition`'s reason with
one noun changed. The generated manifest index stays under `backend/src/` (D-160.3) and the
platform never reaches it: it is **supplied** as a parameter, because an instance's index is a
different file and a relative specifier into this checkout resolves nowhere else.

Everything else about it is unchanged: it carries a manifest, permissions, an activation
declaration, i18n bundles and a palette action, and every check that judges a module judges it.
`scripts/lib/module-roots.ts` places it by the **same marker core discovery uses** — a directory
holding a `manifest.ts` that declares a registered id — and deliberately **not** from the index's
own `manifestPath`, which for a platform-resident module names the package's *built* manifest:
mapping that back to the sources would put a `dist`↔`src` convention inside a derivation, about a
build layout the package is free to change.

**You almost never call those wrappers yourself.** Every core module is composed through
the kernel container (feature 072), and `ctx.routes` / `ctx.worker` / `ctx.subscribe` apply
the wrappers for you — see `module-composition.md`. **A per-deployment overlay module
under `backend/src/apps/<deployment>/modules/` is composed the same way** (D-103): it ships
`backend.ts`, gets an ordinary `ModuleContext`, and calls the same seams. Call the wrappers
directly only where there is no `ModuleContext` — a CLI entry point. **No module in the tree wraps
a second time inside its `plugin.ts`**, and that is measured rather than asserted: the five files
that mention `defineModuleRoutes` or `defineModuleWorker` (`catalog`, `ksef`, `newsletter`,
`pim_ergonode`, `product_feeds`) name them **only in comments**, each saying the module
deliberately does *not* wrap because `ctx.routes` / `ctx.worker` already applies it.

**This paragraph is kept as a worked example of its own failure mode**, because it went wrong twice
in the same place. It first named four modules, and two of them had converted by the time anyone
read it while a fifth had joined unnamed — a list wrong in both directions, which is worse than no
list. The repair was to stop writing the set down and print a derivation instead. That derivation
then went stale in the way a list cannot: it read
`grep -ln '…' backend/src/modules/*/plugin.ts`, and F4 emptied that directory on 2026-08-28, so it
matches nothing and **returns a silence a reader takes for confirmation**. A derivation that
fails open is worse than the list it replaced. Derive it where the modules are, and read the hits
rather than counting them:
`grep -n 'defineModuleRoutes(\|defineModuleWorker(' packages/modules/*/src/backend/plugin.ts`.

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
   empty two-way ledgers — see its row in `check-inventory.md`. That second half exists because a
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
   080's T042b that call site is the **host**, not a module. Since
   `specs/110-instance-repository/` T117 it is the platform's own
   `cli/module-commands.ts`, published host-internally as
   `@endora-commerce/platform/cli` and reached by the application through a re-export shim at
   the old path; it asks
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
   reports clean. `pnpm --filter backend run cli --list` prints every command an instance
   offers — **without the `--`**, which pnpm forwards to the script as a literal argument
   (`tsx … src/cli.ts "--" "--list"`, measured). A flag parser ignores the stray token, which is
   why the `--` spelling elsewhere in this file is harmless; this dispatcher reads its first
   positional as a module name and answers `UnknownCommandError: no module '--' declares a
   command`, exit 1. The five `module:*` scripts are the **other** family and must not convert: they
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

