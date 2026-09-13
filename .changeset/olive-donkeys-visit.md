---
'@endora-commerce/cli': minor
---

The divergence report can be rendered for an instance.

`@endora-commerce/cli/lib/divergence.js` and `@endora-commerce/cli/lib/divergence-artefacts.js`
are new subpaths carrying the derivation, the two renders and the assembly between them; they
were `backend/scripts/lib/divergence.ts` and `backend/src/overlay/divergence-report.ts`, which
no consumer outside this repository could reach.
`@endora-commerce/cli/lib/registration-owners.js` moved with them.

`endora generate` now renders `apps/<deployment>/divergence.generated.md` and `.json` beside
the three artefacts it already wrote — one per deployment the instance holds. **Unlike the
other three it is committed**: it is derived from the deployment's own overlay tree and its
`divergence.ts`, so it is a fact about the client's repository rather than about their install,
and the diff is where an upgrade that changes behaviour they depended on shows up.

New exports on `lib/divergence-artefacts.js`: `renderDivergenceArtefacts`, `instanceComposition`,
`readDivergenceDeclaration`, `seamsFromKernel`, `overlaySourcesUnder`, `walkAnalysableSources`,
`overlayTreeSpellsASeamCall`, `INSTANCE_BOUNDARY_NOTES`, `unreadableCompositionReason`, and the
two default artefact headers. `lib/port-registrations.js` gains `rootRegisteredNames`, the
composition root's own registration spelling — `registerValues(container, { … })`,
`container.register({ … })`, `composedModules.contribute({ … })` — which is a different
predicate from `registeredNames` and is what tells *a root registers it* from *nobody
registers it*. `DivergenceInput` gains two optional fields, `hostNotRecorded` and
`declarationPath`, both defaulting to what the derivation did before. `serializeDivergenceModule` and `renderDivergenceMarkdown` each
take an optional trailing `header` argument; both default to what they emitted before, so no
existing call changes what it produces. `lib/module-packages.js` gains
`scanInstalledPlatformPackage`.

An instance's report records all nine kinds exactly as this repository's does. What it cannot
derive — the module behind a container name a composition root registers on that module's
behalf — is written into the report's own `boundary.notRecorded` rather than left silent.
