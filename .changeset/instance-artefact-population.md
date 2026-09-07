---
'@endora-commerce/cli': minor
---

Two derivations for an instance's build-time artefacts (`specs/110-instance-repository/`
Phase 1).

`installedModulePackages(instanceRoot)` and `scanInstalledModulePackages(instanceRoot)` answer
"which module packages did this instance install" over a `node_modules` tree, alongside the
existing `discoverModulePackages(repoRoot)`, which answers it over workspace members. Both
produce the same `ModulePackage` shape and share one `exports`-map derivation of how an
artefact names a file inside a package, so a generator can render the admin contribution
registry and the documentation navigation over either population without a second
implementation. A candidate whose real path leaves the `node_modules` it was reached through —
a `pnpm link`, a `link:` dependency, a workspace member — is excluded and **reported**, which
is the rule the running platform already applies.

`INSTANCE_BUILD_INPUTS` (`@endora-commerce/cli/lib/instance-build-inputs.js`) declares the four
per-instance build inputs — `DEPLOYMENT`, `API_DOMAIN`, `SALES_CHANNEL_CODE`, `DEFAULT_LOCALE` —
with each input's meaning, example, default and the build argument each image reads.
`buildArgFlags(target)` emits the `--build-arg` flags one image build takes.
