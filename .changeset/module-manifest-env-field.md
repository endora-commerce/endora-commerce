---
'@endora-commerce/contracts': minor
---

`ModuleManifestSchema` gains `env?: EnvironmentInput[]` — the environment inputs a
module owns, declared beside `permissions`, `actions`, `errorCodes` and
`cliCommands`, so the same tree walk carries them into the generated manifest index.

This is the only way a module's requirements can reach a client. A module package
ships `dist`, `i18n` and `docs`; `.env.example` is a file in the platform's own
repository, so a client who installs thirty modules and copies the example gets a
file that does not mention what those modules read.

`defineModuleManifest` now throws on an entry whose `owner` is not
`{ kind: 'module', moduleId: <this module> }`. A module declares only what it
**owns**: its read of a platform-owned name — `NODE_ENV`, `STOREFRONT_BASE_URL`,
`REVALIDATE_SECRET` and the rest — is satisfied by the platform's own declaration,
and declaring it again would be one fact with thirty homes.

The field is optional and additive: a manifest that declares nothing is unchanged.
