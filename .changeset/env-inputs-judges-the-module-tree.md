---
'@endora-commerce/cli': minor
---

`check:env-inputs` judges the module tree. Its population was the three trees a
running Endora is made of — the backend's sources plus the platform's, the
storefront's, the admin's — and every run printed the bound it could not reach:
`not judged: 74 module packages`. That line is gone, because the walk now answers
for them.

A read resolves against the platform's declaration, the application tree's, and
**the reading module's own** — never another module's. Two findings for the two
ways that goes wrong: `undeclared-module-input`, a module read nothing declares,
and `module-declares-a-platform-input`, a module restating a fact the platform
already owns.

Two more for the Settings-debt ledger (FR-004):
`module-input-without-a-settings-verdict` and `stale-settings-verdict`, over
`backend/scripts/ledgers/module-environment-inputs/`.

`evaluateManifestEnvDeclaration` and `loadModuleVerdictShards` are new exports of
`@endora-commerce/cli/rules/env-inputs.js`; `EnvironmentRead` and `EnvSourceFile`
gain an optional `module`, and `EnvInputsInput` an optional `settingsVerdicts`.
Every addition is optional, so an existing caller compiles unchanged.
