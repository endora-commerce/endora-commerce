---
'@endora-commerce/contracts': minor
'@endora-commerce/cli': minor
'@endora-commerce/platform': minor
---

An overlay module that owns tables now has a visible lifecycle and a place in the divergence
report (issue #1851, `specs/190-overlay-full-modules/` FR-045 – FR-047).

- **`module:status` lists a module's migrations.** `module:status <id>` prints the migrations the
  module owns under its row. Each one shows its class name, its origin (`core`, `external` for an
  installed package, `overlay`, `generated`) and whether the database has applied it or it is
  still pending. With `--json`, every row carries the same list as `migrations`. The listing comes
  from the order `migrate` runs and the ownership `module:uninstall --hard` reverts by, so it shows
  exactly what a hard uninstall would revert. A host passes that order through the new optional
  `OperatorRuntime.migrations`. `instanceOperatorRuntime` passes the instance's own order, so an
  instance's `module:status` lists its overlay modules' migrations with no change to its wiring.
  A runtime without it lists no migrations, as before.
- **`column-extension` divergence kind.** `DivergenceKind` in `@endora-commerce/contracts` gains
  `'column-extension'`. `DivergenceDetail` gains its detail, which carries `dataRung: 'D2'` and
  the physical `x_*` columns. `endora generate` records one entry for each
  `defineColumnExtension(…)` call in an overlay module, keyed
  `column-extension:<module>:<host>`. The entry's subject is the host table and its owner is the
  module that owns the host. Like every other kind, it needs a sentence in the deployment's
  `divergence.ts` `reasons`. A host it cannot read as a literal is reported as `computed-subject`,
  and a table that is not an extensible host as `unowned-subject`. An exhaustive `switch` over
  `DivergenceKind` needs one more case.
- **An overlay module's own tables are not a divergence.** The report's `notRecorded` boundary
  now names "an overlay module's own entities and migrations". After upgrading, run
  `endora generate` to re-render `divergence.generated.md` and `.json`. The re-rendered files
  carry the new boundary line and the new kind in `recorded`.
