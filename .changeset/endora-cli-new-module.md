---
'@endora-commerce/cli': minor
---

New package: `@endora-commerce/cli`, one binary named `endora`, with its first command — `endora new module`.

`endora new module <id> --name <text> --description <text> [options]` writes a module package that the platform composes, that the operator can switch off, that is discoverable in the command palette, and that type-checks and passes the platform's static-check estate with no hand edits. The layers are opt-in — `--entities`, `--ports`, `--worker`, `--subscriber` — and each one decides which of the platform's required checklists the emitted module has to satisfy, so the compliant shape is the default rather than something an author reconstructs from four checklists and 66 examples.

It does **not** author the package's `package.json`. That file is derived from the sources — `exports` from which layers exist, `peerDependencies` from the bare specifiers the sources actually import, the ranges from the application that composes the modules — and it has an author already: the platform's manifest generator. The command writes the sources and then invokes that generator, so the two cannot disagree.

Programmatic surface, for a caller that wants the scaffold without the argv layer: `runNewModule`, `buildScaffoldSpec`, `emitModuleFiles`, and the derivations around them (`npmNameFor`, `migrationStampFor`, `pascalOf`, …).

`endora check` is not in this build and the program says so by name rather than pretending to run.
