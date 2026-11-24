# Contract: narrowing D-156.4 (D-296.5, D-296.6)

## 1. The rule, before and after

Owner ruling of 2026-11-23 (D-296.5 as amended, spec OQ-3 closed): the narrowing covers **the four
guard seams only**, as #1841 items 1 and 2 name them. Every other root-supplied registration stays
decoratable by an overlay, as D-156.4 has it.

| Decorator | Owner of the decorated name | Until 0.112.x | 0.113.0 | 0.114.0 |
| --- | --- | --- | --- | --- |
| any module | itself | allowed | allowed | allowed |
| core or package module | anyone else, or a root | `ForeignDecorationError` | unchanged | unchanged |
| any module | an installed package | `PackageDecorationNotOfferedError` | unchanged | unchanged |
| overlay | another overlay module of the same deployment | allowed | allowed | allowed |
| overlay | a workspace module of this repository | allowed | allowed | allowed |
| overlay | a composition root, a name **other than** the four guard seams (`redis`, `orm`, `requireAdmin`, …) | allowed (D-156.4) | allowed, no warning | allowed, no warning |
| overlay | a composition root, **a guard seam** (`commandBus`, `auditLogService`, `eventBus`, `emFactory`) | allowed (D-156.4) | **allowed, warned** | **`GuardSeamDecorationError`** |

The four names are a **list**, not a derivation, because no ledger fact tells a guard seam from
other root plumbing. The list lives once:

```ts
// @endora-commerce/contracts, src/modules.ts
export const GUARD_SEAM_REGISTRATIONS = ['commandBus', 'auditLogService', 'eventBus', 'emFactory'] as const;
export type GuardSeamRegistration = (typeof GUARD_SEAM_REGISTRATIONS)[number];
export const isGuardSeamRegistration = (name: string): name is GuardSeamRegistration => …;
```

Two tests hold the list (tasks T068, T069):

- `packages/contracts/src/modules.test.ts` pins its exact content. A change to it fails until the
  test changes too, and the test's comment says that adding a guard seam is a ruling that amends
  D-296.
- `backend/test/contract/kernel/harness-parity.test.ts`, which already compares the two roots,
  asserts that `composeApp` and the test-kit server each register all four as root-supplied
  (`ownerOf(name) === undefined`). Without it, a rename at the root would leave the list naming
  nothing.

The predicate in `decorate`'s `apply` is therefore
`isDeploymentOverlay && ownerOf(name) === undefined && isGuardSeamRegistration(name)`. The
`owner === undefined` half is the existing root-supplied test (`module-context.ts`, the
`owner !== module.id` branch). With the second test above, it never decides the answer by itself,
but it keeps the rule stated as "a root's guard seam" rather than "a string".

The check order inside `apply` becomes:

1. nothing registered under the name (unchanged);
2. the owner is an installed package → `PackageDecorationNotOfferedError` (unchanged);
3. the owner is foreign and the decorator is not an overlay → `ForeignDecorationError` (unchanged);
4. **new**: the decorator is an overlay and the predicate holds → 0.113.0: record the decoration,
   log the warning once per (module, name), and mark the ledger entry `deprecated: true`; 0.114.0:
   throw `GuardSeamDecorationError` before anything is recorded;
5. record the decoration and wrap it (unchanged). A root-supplied name outside the list reaches this
   step exactly as it does on `origin/master`.

## 2. The replacement text

| Name | Replacement named in the warning, finding and error |
| --- | --- |
| `commandBus` | command middleware: `admit` to refuse, `observe` to measure; a command hook for one declared action |
| `auditLogService` | `observe` middleware for an extra sink, or a read of `audit_log_entries` for a durable one; the audit writer itself is not replaceable |
| `eventBus` | `ctx.subscribe` for a reaction; an `afterCommit` hook for durable delivery |
| `emFactory` | none. Tenant scoping is not overridable (Principle XI). Ask the owning module for a port |

The table lives once, in `@endora-commerce/contracts` beside `GUARD_SEAM_REGISTRATIONS`, as
`guardSeamReplacementFor(name: GuardSeamRegistration): string`. It is total over the four names
and typed so that it takes nothing else. Both the platform (warning and error) and the CLI
derivation (finding) read it from there, because the CLI reads an instance without loading the
platform.

## 3. 0.113.0: the warning

Runtime, once per (module, name), at `warn`:

```json
{
  "msg": "kernel.decoration.deprecated",
  "overlay": "<module id>",
  "registration": "commandBus",
  "replacement": "<§2 text>",
  "refusedFrom": "0.114.0",
  "ruling": "D-296"
}
```

The existing `kernel.decorations` info line gains `deprecated: true` on those entries.

Divergence report (`packages/cli/src/lib/divergence.ts`):

- `DivergenceFinding` gains `readonly severity?: 'error' | 'warning'`. Absent means `'error'`, so
  every existing finding keeps failing.
- New kind `deprecated-decoration`, raised for each `decoration` entry whose owner is `null` (a
  root-supplied name) **and** whose name is in `GUARD_SEAM_REGISTRATIONS`, with
  `severity: 'warning'`. A decoration of any other root-supplied name raises nothing new.
  `where` is the overlay module's `backend.ts`. `detail` names the overlay, the registration and the §2 replacement.
- `DIVERGENCE_REMEDIES['deprecated-decoration']` states the rule, the release that refuses it, and
  points to `docs/docs/architecture/customisation-ladder.md` (updated by 190).
- `backend/scripts/check-divergence.ts`, `endora generate` and `endora check` print warnings under
  `warnings:` and exit non-zero only when an error finding exists. The summary line becomes
  `findings=<errors> warnings=<warnings>`.

## 4. 0.114.0: the refusal

```ts
export class GuardSeamDecorationError extends Error {
  constructor(readonly registrationName: GuardSeamRegistration, readonly moduleId: string);
  // message: "[kernel] overlay module '<id>' cannot decorate '<name>': it is a guard seam through
  // which Principles XI and XIII are enforced, and since 0.114.0 (D-296, narrowing D-156.4) no
  // module decorates a guard seam. <§2 text>.
  // See docs/docs/architecture/customisation-ladder.md."
}
```

- `alreadyNamesTheModule` in `compose.ts` includes it, so it propagates unwrapped.
- The `deprecated-decoration` finding's severity becomes `'error'`.
- These tests flip from asserting the wrap to asserting the refusal: the overlay `commandBus` case
  in `packages/platform/src/kernel/module-context.test.ts` (the `client.di.decorate('commandBus', …)`
  case and its comment block); the root-supplied cases in
  `packages/platform/src/kernel/decoration-drain.test.ts` (`commandBus`, `auditLogService`);
  `packages/cli/test/divergence.test.ts` (the `ctx.di.decorate<Bus>('commandBus', …)` fixture);
  and any case in `backend/test/integration/kernel/decoration.test.ts` that wraps a guard seam.
  Grep for `decorate(` with each of the four names before finishing, and read AGENTS.md's trap on
  `test:unit:fast` skipping the integration tree. A case that wraps another root-supplied name
  (for example `redis`) does **not** flip; it stays green and unchanged, and P3 adds one such case
  if none exists, so the scope of the refusal is held from both sides.
- `backend/acceptance/instance-expected-state.json`: the A8 reason's sentence that the
  "`commandBus` family D-156.4 sanctions by name" is a target the fixture "could take" becomes
  false. Rewrite that sentence in the refusal merge request.

## 5. Text that changes with the behaviour (FR-054)

Each edit lands in the merge request that changes the behaviour it describes: the 0.113.0 warning
or the 0.114.0 refusal.

| Location | 0.113.0 | 0.114.0 |
| --- | --- | --- |
| `ForeignDecorationError` doc block (`module-context.ts`), *"That is deliberate and it stays"* | add: for the four guard seams, deprecated by D-296 and refused from 0.114.0 | rewrite: the exemption covers every owner except an installed package and the four guard seams |
| `decorate` comment on `isDeploymentOverlay` | same | same |
| `ModuleEntry.overlay` doc (`compose.ts`) | note D-296 | rewrite |
| `decorationOrder` doc in `contracts/modules.ts` (*"may not decorate a name they do not own (D-156.4)"*) | cite D-296 | unchanged |
| `packages/cli/src/lib/divergence.ts` `foreign-order-member` remedy | cite D-296 | unchanged |
| `specs/conventions/overlay-modules.md`, *Decorating across owners* | add the deprecation sentence for the four guard seams and their replacements | rewrite the exemption to D-296.6 |

Published pages (`docs/docs/architecture/overlay-pattern.md`, `customisation-ladder.md`, the
upgrade page, EN and PL) are `specs/190-overlay-full-modules/`'s (#1857). The 0.114.0 refusal merge
request does not merge before 190's ladder text names the replacement, so the error's link resolves
to a page that says what to do.

## 6. Constitution delta (applied by this feature's P2; owner ruling of 2026-11-23, D-296.9)

This feature's P2 merge request applies the text below. `specs/190-overlay-full-modules/` then
rewrites XV around these sentences and keeps their substance. If 188's XV amendment lands in the
same release, the two are one MINOR bump or two sequential ones, and the second rebases on the
first (`specs/188-policy-points/plan.md`, XV row).

XV, *Overlays are ordinary participants, under the same guards*: append to the last sentence:

> … — an override swaps an **implementation**, never a guard seam: no module, an overlay module
> included, decorates the guard seams a composition root supplies (`commandBus`,
> `auditLogService`, `eventBus`, `emFactory`), and cross-cutting behaviour on Commands is
> contributed as declared command middleware.

XV, *Bounded overridable surface*: replace "services, routes, config, declared command hooks, and
whole new modules" with "services, routes, config, declared command hooks, declared command
middleware, and whole new modules", and add after the command-hook sentence:

> Command middleware runs on every Command whose action matches its declared filter: `admit` before
> the Command does anything, which may only pass or refuse; `observe` after the run, read-only. It
> never transforms a Command's input.

XIII, *Thin layer*, append:

> Declared command middleware (`admit`, `observe`) is part of this layer, not a wrapper around it:
> a refused Command writes nothing and records no audit entry, and an observer cannot change a
> write.

This is a MINOR amendment. The version line and the Sync Impact Report follow the constitution's
own Governance section.

## 7. Upgrade note (0.114.0 changeset body, `breaking change`)

> **Overlay modules can no longer decorate the guard seams** (D-296, narrowing D-156.4;
> deprecated in 0.113.0). An overlay's `ctx.di.decorate('commandBus' | 'auditLogService' |
> 'eventBus' | 'emFactory', …)` now fails composition with `GuardSeamDecorationError`.
> - A wrap that measures or logs writes → an `observe` command middleware.
> - A wrap that refuses writes (rate limit, freeze, maintenance) → an `admit` command middleware.
> - A wrap that adds a write to one action → a `beforeCommit` command hook, if the owner declares
>   the action hookable.
> - A wrap of `eventBus` → `ctx.subscribe`, or an `afterCommit` hook.
> - A wrap of `emFactory` → no replacement; ask the owning module for a port.
> Decorating another overlay module's registration, a workspace module's in this repository, or
> any other root-supplied registration (`redis`, `orm`, …) is unchanged. The 0.113.0 divergence
> report lists every affected decoration as a `deprecated-decoration` warning.
