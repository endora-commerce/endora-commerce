---
'@endora-commerce/cli': minor
---

Add `@endora-commerce/cli/lib/emitted-freshness.js`: "is the artefact this run read still the one
its source says it is?"

A package resolves through its own `exports` map at its build output, so a conformance check that
imports a module's manifest by bare specifier reads `dist/manifest.js` and never opens
`src/manifest.ts` — an author who edits the source and runs the check is answered about the previous
build, in green. The new module derives, from a package's own `pnpm-workspace.yaml` membership,
`exports` map and `tsconfig.build.json`, which file a run actually read and whether its source has
outrun it.

New exports: `emittingPackages`, `checkEmittedFreshness`, `freshnessRefusal`,
`refuseStaleEmittedArtefacts`, `readArtefactOf`, `rootExportOf`, `sourceOfEmitted`, `originOf`,
`packageHolding`, `nodeFreshnessFs`, and the types `EmittingPackage`, `FreshnessFs`,
`FreshnessInput`, `FreshnessResult`, `FreshnessFinding`, `FreshnessFindingKind`, `ArtefactOrigin`.

A consumer that wants the refusal calls `refuseStaleEmittedArtefacts(prefix, result, displayOf)`,
which prints and exits **2** — the input could not be read, which is neither "clean" nor "found
something".
