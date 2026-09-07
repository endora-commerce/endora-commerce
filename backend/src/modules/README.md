# `backend/src/modules` — empty, and deliberately still here

**No module lives here.** Every one of them is a workspace package under
`packages/modules/<id>/`, discovered through its own `endora: { type: 'module', id }`
block and composed through `@endora-commerce/mod-<id>/backend`. The packaging sweep
(feature `080`, F4) finished on 2026-08-28 and this directory has held no module since.

The one module whose sources the host owns is the lifecycle subsystem, and it is not here
either: it is `backend/src/lifecycle/`, by ruling D-160.11.

## Why the directory is kept

This file used to instruct a reader on folder naming, entity ownership and cross-module
imports for modules that have not lived here for months, and pointed at a 2025 data model
for "the module inventory". That is what feature `103` removed.

The **directory** stays because it is still a derived root, and five test files resolve it
by path rather than through the generated manifest index:

- `test/helpers/fk-graph.ts` refuses a root that does not resolve — issue #215's own rule,
  correctly applied — which reds `test/unit/db/fk-dependency-drift.test.ts` and
  `test/unit/db/kernel-migration-ownership.test.ts`;
- `test/unit/db/migrations-registry.test.ts`, `test/unit/commands/check-command-coverage.test.ts`
  and `test/unit/payments/published-refund-registry-surface.test.ts` each `readdirSync` it.

Every `check-*` script resolves its module roots from the generated manifest index instead
(`backend/scripts/lib/module-roots.ts`, `scripts/lib/module-root.sh`) and is unaffected —
measured, with the directory gone: `check:naming`, `check:language`, `overlay:check`,
`check:module-boundary`, `check:module-docs`, `check:entry-scope`, `check:entry-presence`,
`check:kernel-boundary`, `check:port-dependencies`, `check:subscribe-seam` and
`test/unit/scripts/moved-module-tree.test.ts` all pass.

**One of the five is worth a second look before the directory goes.**
`published-refund-registry-surface.test.ts`' last case walks this directory and asserts the
result is empty. It has therefore been passing over **zero files** since the sweep finished:
a green that means "not looking", which is the issue #215 family. Deleting the directory
turns that silence into an `ENOENT`, which is an improvement and not a repair.

## Where to look instead

- A module's own layout: `specs/080-f4-real-scope/contracts/module-package-layout.md`.
- What a module owns and how it is composed: `AGENTS.md` § *Required checklists for a new
  backend module*, and `docs/docs/architecture/kernel.md`.
- Per-deployment modules: `backend/src/apps/<deployment>/modules/<id>/`, and
  `docs/docs/architecture/overlay-pattern.md`.
