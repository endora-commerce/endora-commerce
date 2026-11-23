# Contract: narrowing D-156.4 (D-296.5, D-296.6)

## 1. The rule, before and after

| Decorator | Owner of the decorated name | Until 0.112.x | 0.113.0 | 0.114.0 |
| --- | --- | --- | --- | --- |
| any module | itself | allowed | allowed | allowed |
| core or package module | anyone else, or a root | `ForeignDecorationError` | unchanged | unchanged |
| any module | an installed package | `PackageDecorationNotOfferedError` | unchanged | unchanged |
| overlay | another overlay module of the same deployment | allowed | allowed | allowed |
| overlay | a workspace module of this repository | allowed | allowed | allowed |
| overlay | **a composition root** (owner `undefined`) | allowed (D-156.4) | **allowed, warned** | **`RootSuppliedDecorationError`** |

"Composition root" is derived from the ownership ledger, not listed: `ownerOf(name) === undefined`.
That is the same test `decorate` already applies (`module-context.ts`, the `owner !== module.id`
branch). The four guard seams are root-supplied, so they fall under the last row. They differ only
in the replacement the message names (§2). Spec OQ-3 asks the owner to confirm that the row
covers every root-supplied name and not only the four. If the owner narrows it, the predicate
becomes `owner === undefined && GUARD_SEAM_REGISTRATIONS.includes(name)`, and nothing else in this
contract changes.

The check order inside `apply` becomes:

1. nothing registered under the name (unchanged);
2. the owner is an installed package → `PackageDecorationNotOfferedError` (unchanged);
3. the owner is foreign and the decorator is not an overlay → `ForeignDecorationError` (unchanged);
4. **new**: the decorator is an overlay and the owner is `undefined` → 0.113.0: record the
   decoration, log the warning once per (module, name), and mark the ledger entry
   `deprecated: true`; 0.114.0: throw `RootSuppliedDecorationError` before anything is recorded;
5. record the decoration and wrap it (unchanged).

## 2. The replacement text

```ts
// @endora-commerce/contracts, src/modules.ts
export const GUARD_SEAM_REGISTRATIONS = ['commandBus', 'auditLogService', 'eventBus', 'emFactory'] as const;
```

| Name | Replacement named in the warning, finding and error |
| --- | --- |
| `commandBus` | command middleware: `admit` to refuse, `observe` to measure; a command hook for one declared action |
| `auditLogService` | `observe` middleware for an extra sink, or a read of `audit_log_entries` for a durable one; the audit writer itself is not replaceable |
| `eventBus` | `ctx.subscribe` for a reaction; an `afterCommit` hook for durable delivery |
| `emFactory` | none. Tenant scoping is not overridable (Principle XI). Ask the owning module for a port |
| any other root-supplied name | a port from the module whose behaviour should change (rung 3), or a declared extension point |

The table lives once, in `@endora-commerce/contracts` beside `GUARD_SEAM_REGISTRATIONS`, as
`decorationReplacementFor(name)`. Both the platform (warning and error) and the CLI derivation
(finding) read it from there, because the CLI reads an instance without loading the platform.

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
  root-supplied name), with `severity: 'warning'`. `where` is the overlay module's `backend.ts`.
  `detail` names the overlay, the registration and the §2 replacement.
- `DIVERGENCE_REMEDIES['deprecated-decoration']` states the rule, the release that refuses it, and
  points to `docs/docs/architecture/customisation-ladder.md` (updated by 190).
- `backend/scripts/check-divergence.ts`, `endora generate` and `endora check` print warnings under
  `warnings:` and exit non-zero only when an error finding exists. The summary line becomes
  `findings=<errors> warnings=<warnings>`.

## 4. 0.114.0: the refusal

```ts
export class RootSuppliedDecorationError extends Error {
  constructor(readonly registrationName: string, readonly moduleId: string);
  // message: "[kernel] overlay module '<id>' cannot decorate '<name>': a composition root
  // registers it, and since 0.114.0 (D-296, narrowing D-156.4) an overlay decorates only its
  // own deployment's overlay registrations and this repository's workspace modules. <§2 text>.
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
  and any case in `backend/test/integration/kernel/decoration.test.ts` that wraps a root name. Grep
  for `decorate(` with each root-supplied name before finishing, and read AGENTS.md's trap on
  `test:unit:fast` skipping the integration tree.
- `backend/acceptance/instance-expected-state.json`: the A8 reason's sentence that the
  "`commandBus` family D-156.4 sanctions by name" is a target the fixture "could take" becomes
  false. Rewrite that sentence in the refusal merge request.

## 5. Text that changes with the behaviour (FR-054)

Each edit lands in the merge request that changes the behaviour it describes: the 0.113.0 warning
or the 0.114.0 refusal.

| Location | 0.113.0 | 0.114.0 |
| --- | --- | --- |
| `ForeignDecorationError` doc block (`module-context.ts`), *"That is deliberate and it stays"* | add: deprecated by D-296, refused from 0.114.0 | rewrite: the exemption covers overlay and workspace owners only |
| `decorate` comment on `isDeploymentOverlay` | same | same |
| `ModuleEntry.overlay` doc (`compose.ts`) | note D-296 | rewrite |
| `decorationOrder` doc in `contracts/modules.ts` (*"may not decorate a name they do not own (D-156.4)"*) | cite D-296 | unchanged |
| `packages/cli/src/lib/divergence.ts` `foreign-order-member` remedy | cite D-296 | unchanged |
| `specs/conventions/overlay-modules.md`, *Decorating across owners* | add the deprecation sentence and the replacements | rewrite the exemption to D-296.6 |

Published pages (`docs/docs/architecture/overlay-pattern.md`, `customisation-ladder.md`, the
upgrade page, EN and PL) are `specs/190-overlay-full-modules/`'s (#1857). The 0.114.0 refusal merge
request does not merge before 190's ladder text names the replacement, so the error's link resolves
to a page that says what to do.

## 6. Constitution delta (owner question OQ-2 decides who applies it)

XV, *Overlays are ordinary participants, under the same guards*: append to the last sentence:

> … — an override swaps an **implementation**, never a guard seam: an overlay module does not
> decorate a registration a composition root supplies (`commandBus`, `auditLogService`, `eventBus`,
> `emFactory` among them); cross-cutting behaviour on Commands is contributed as declared command
> middleware.

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

> **Overlay modules can no longer decorate root-supplied registrations** (D-296, narrowing D-156.4;
> deprecated in 0.113.0). An overlay's `ctx.di.decorate('commandBus' | 'auditLogService' |
> 'eventBus' | 'emFactory' | <any root-supplied name>, …)` now fails composition with
> `RootSuppliedDecorationError`.
> - A wrap that measures or logs writes → an `observe` command middleware.
> - A wrap that refuses writes (rate limit, freeze, maintenance) → an `admit` command middleware.
> - A wrap that adds a write to one action → a `beforeCommit` command hook, if the owner declares
>   the action hookable.
> - A wrap of `eventBus` → `ctx.subscribe`, or an `afterCommit` hook.
> Decorating another overlay module's registration, or a workspace module's in this repository,
> is unchanged. The 0.113.0 divergence report lists every affected decoration as a
> `deprecated-decoration` warning.
