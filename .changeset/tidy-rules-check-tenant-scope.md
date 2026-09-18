---
'@endora-commerce/cli': minor
---

`endora check` gains package-scope hosts for two rules that until now had none, and publishes
their analyses on two new `./rules/*` subpaths.

- **`check-entity-tenant-classification`** — every persisted entity class carries exactly one
  tenant-scope decorator (`@OrgScoped`, `@CustomerScoped`, `@GlobalEntity`,
  `@TransitivelyScoped`, `@RuleScoped`). It reads the **emitted** artefact, because that is what
  the platform loads: `@Entity(` does not survive compilation, and the class-level
  `__decorate([Entity({…}), OrgScoped()], C)` call does. A package that was never built, or whose
  source is newer than its `dist`, is reported `unreadable` with the build command — never
  answered from source. `@endora-commerce/cli/rules/entity-tenant-classification.js` exports
  `analyzeSource`, `analyzeEmitted`, `analyzeEmittedFiles`, `classifyFindings`,
  `declaredEntityClasses`, `packageEntityFindings`, `walk`, `walkEmitted` and `remedyFor`.
- **`check:entry-presence`** — a timer, a process-lifecycle handler or a `ctx.onBoot` hook that
  nothing can catch a throw from must decide the module's presence before it works. The rule is
  unconditional; a `nonDeactivatable` manifest exempts the boot hooks and not the timers.
  `@endora-commerce/cli/rules/entry-presence.js` exports `checkEntryPresence`,
  `findUngatedEntries`, `collectPresenceFiles`, `keyOf`, `remedyFor`, `bootHookDoesWork`,
  `bootHookContributes`, `EXPLANATION` and the finding types.

`checkEntryPresence(input, ledger)`'s second argument is **required**: a host states which
exemptions it is judging against rather than inheriting whichever ledger the library carried.
