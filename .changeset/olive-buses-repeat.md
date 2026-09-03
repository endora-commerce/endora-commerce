---
'@endora-commerce/cli': minor
---

`endora check` runs eight more of the estate's rules against one module package,
and ten more analyses now have one implementation and two hosts.

**New on `@endora-commerce/cli/rules/*`** — each is the same function
`backend/scripts/check-<name>.ts` calls, relocated rather than copied:
`action-route-permissions`, `channel-resolution`, `default-language-prose`,
`diacritic-folds`, `entry-scope`, `kernel-boundary`, `platform-surface`,
`port-shape`, `singleton-identity`, `transaction-context`. Three shared readers
move with them: `lib/sql-tables.js`, `lib/ui-layer.js` and a new
`lib/port-registrations.js` (the container-registration and port-resolution
readers, extracted from `check-port-dependencies.ts`).

**Eight of them reach a package verdict.** `endora check` now evaluates
`channel:resolution`, `check:default-language-prose`, `check:diacritic-folds`,
`check:entry-scope`, `check:kernel-boundary`, `check:platform-surface`,
`check:port-shape` and `check:transaction-context` over a package's own declared
layers, taking `pending` from twenty-two to fourteen.

**Breaking, for a consumer that called these analyses directly.** A ledger is a
statement about one tree's debt and does not travel, so it is an argument now
rather than a value the analysis reads:

- `checkTransactionContext(input, ledger)` — the second argument is required.
- `checkDiacriticFolds(files, ledger, slugLedger, roots?)` — the two ledgers are
  required; `roots` defaults to this repository's population roots.
- `checkSingletonIdentity(input, allowed)` — required.
- `checkPlatformSurface(input, ledger)` — required.
- `analyse(input, ledger)` and `checkActionRoutePermissions(input, ledger)` —
  required.
- `violationsOf(sites, allowed)` and `staleAllowances(sites, allowed)` from
  `rules/entry-scope.js` — the second argument is required.
- `declaredTableNames(source, file, tableNameOf)` from `lib/sql-tables.js` takes
  the entity-class → table-name convention as a **required** parameter. The
  convention is the platform's own naming strategy, which lives in the
  application's runtime sources and cannot be reached from this package; writing
  a copy of the pluralizer here would make two authors of one convention.
- `isScannablePath(path, roots?)` from `rules/diacritic-folds.js` takes the
  population roots, so a package can supply its own.

`checkPortShape` gains four optional inputs — `platformOwnedNames`,
`hostRegisteredPorts` and the two ledgers — and reads none of them from a
constant of its own.
