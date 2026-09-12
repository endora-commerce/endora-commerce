---
'@endora-commerce/cli': minor
---

`endora new instance` writes a documentation member, and `endora generate` renders its
artefacts.

**New exports.** `@endora-commerce/cli/lib/docs-artefacts.js` carries the documentation
renderers — `docsRegistryOf`, `renderDocsSidebarFrom`, `renderModuleMapFrom`,
`renderModuleReferencesFrom`, `collectDocsIntoSiteFrom`, `installedDocsModules` and the
emitters underneath them. They were `backend/scripts/generate-composer.ts`', which no client
can reach; the population is now a parameter and one program serves both hosts, exactly as
`lib/admin-artefacts.js` does for the admin pair. `lib/module-packages.js` gains
`publishedManifestEntryOf`, and `new-instance/docs-toolchain.js` exports `DOCS_TOOLCHAIN`.

**Changed signature.** `runGenerate` is now `async` and returns
`Promise<GenerateResult>`; the result gains `omitted`, `collected` and `swept`. A caller
awaiting it needs no other change. An instance with an admin project but no documentation site
— or the other way round — is now an **omission** the command names rather than a refusal; only
a tree with neither member exits 1.

**New behaviour.** A scaffolded instance gains a `docs/` member (four files: the manifest, a
Docusaurus configuration, a sidebar and an intro page), the root `generate` script becomes
`endora generate` rather than a forward to the admin member, and `build` reaches every member.
`GENERATED_TREES` names the directories a client's `.gitignore` has to cover.
