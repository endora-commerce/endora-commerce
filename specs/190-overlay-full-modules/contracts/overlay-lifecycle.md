# Contract — Lifecycle of overlay-owned tables (FR-045 – FR-047, R-13, #1851)

After `overlay-schema-discovery.md`.

## §1 The rule

An overlay module with tables has **the lifecycle of a module this build ships** — the one a core
module has in this repository — not the one an installed package has. It stays in
`deploymentShippedEntries` (`lifecycle/services/module-origin.ts`).

| Operation | Behaviour for an overlay with tables |
| --- | --- |
| first boot | `module_registrations` row converged with `bootConvergedAt`; activation Setting reconciled (unchanged) |
| `migrate` | its pending migrations apply in its topological position (global linear log) |
| `module:install <id>` / `--all` | pending migrations apply; settings reconcile; install hook runs; `bootConvergedAt` cleared — the existing repair path |
| `module:status` | lists the module's applied and pending migrations by name, origin `overlay` |
| deactivate (operator axis) | routes `MODULE_DISABLED`, workers / subscribers / hooks / middleware not run, admin surfaces absent; tables and rows untouched |
| `module:disable` / soft `module:uninstall` | tables and rows untouched |
| `module:uninstall --hard --force` | reverts every migration the ownership answer lists for the id, newest first; deletes the registry row; its `x_*` columns stay, `orphaned` |

## §2 Removal

Hard-uninstall first, then ship a tree without the directory (or list the id in `divergence.ts`
`omittedModules`). A tree that still ships the directory converges the module back at the next boot
and recreates its tables empty at the next `migrate` — the same as a core module here; stated in the
docs, not guarded.

## §3 Divergence report

- An overlay's own tables: `DivergenceBoundary.notRecorded` (own surface).
- `column-extension` (new `DivergenceKind`): one entry per overlay `schemaExtensions` declaration,
  `subject` = host table, `owner` = host's module, rung = data ladder D2, key
  `column-extension:<module>:<host>`; needs a sentence in `divergence.ts`.
- Side-table declarations: the kind `specs/187-side-table-extensions/` defines (coordination C-2).
- The per-package grant `policyParticipantGrants` in `divergence.ts` and its report kind `policy-participant-grant` are `specs/188-policy-points/`'s (owner answer 5), not this feature's.

## §4 Off-state and coverage

- Every overlay with tables ships an off-state test: API rejects, admin surface absent, configuration
  not editable, rows intact, switching on restores (Principle XVII).
- `check:off-state-coverage` counts overlay modules of every deployment on disk.

## §5 Tests

Integration lifecycle over a fixture overlay with one table: install → status → deactivate → activate
→ soft uninstall → install → hard uninstall (table gone, `x_*` column orphaned) → boot (converged
back) → migrate (table recreated empty).
