# Composition — a module's `backend.ts`

**Open this before composing a module** — registering its services, publishing or resolving a
port, declaring a lifecycle edge, wiring routes/workers/subscribers, or writing an install
hook. One of the bodies `AGENTS.md` routes to; it is the single home for these rules, so never
restate them in `AGENTS.md` or in a tool-specific pointer file.

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
   serialisation is the case nobody expects.** `module-activation.md` already says presence is
   *decided* before the work at an entry point with no caller to answer (a timer, a boot hook, a
   signal handler).
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
10. **The platform may not import a module (D-52/D-53), and the subject is the whole
   package.** D-52 named `src/kernel`, `src/http`, `src/events` and `src/tenancy` as one rule
   rather than one plus three peers: the kernel does not compile without them (five kernel
   entities take `@GlobalEntity()` from `src/tenancy`, four kernel files take `HttpError` from
   `src/http` as a value), so a peer allowed to name a module is a kernel importing modules
   with **one extra hop**. That argument counted hops between source directories that might
   become different packages; they did not, and the hop is now **zero** — every directory of
   `@endora-commerce/platform` compiles into one artefact behind one `dependencies` block, and
   every module package depends on it, so a module named anywhere under `packages/platform/src`
   closes the cycle. A platform file that needs something a module owns takes it **by injection
   from a composition root** — the pattern `ErrorEnvelopeOptions` uses.
   **This paragraph read *"`src/db`, `src/overlay` and `src/commands` are not platform
   roots"*, and it is the worked example of a sentence that kept its words while its subject
   moved.** Those were D-57's three carve-outs about directories of the **application**, each
   with a premise that the relocation retired: `src/db` "imports every module by construction"
   (`packages/platform/src/db/` imports none — the generated registries stayed in
   `backend/src`), `src/overlay` is "per-deployment resolution" (the platform's is the loader,
   and the overlay root and the id claims are parameters), and `src/commands` was left open in
   as many words — *"a real open item F4 must close"*. F4 is closed and all three are in the
   package. **Do not write the roots down**: `check:kernel-boundary` derives them from the
   platform member's own directories (`specs/110-instance-repository/` T118a), so the next one
   is judged by existing.
11. **CI** — `pnpm --filter backend run check:port-dependencies`, `check:port-catches`,
   `check:kernel-boundary`, `check:module-boundary`, `check:container-imports`,
   `check:subscribe-seam`, `check:entry-presence`, and
   `pnpm --filter backend exec vitest run test/contract/kernel/harness-parity.test.ts`
   (drift between the two composition roots, as an explicit draining ledger).

Full guide, including the contribution-point rules and the request scope:
`docs/docs/architecture/kernel.md`.

