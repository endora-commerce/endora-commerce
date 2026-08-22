---
'@b2b/contracts': minor
---

Publish `ModuleLifecycleParticipant` — a third lifecycle export a module's
`manifest.ts` may declare, beside `installHook` and `uninstallHook`, carried on
`ModuleManifestExports.lifecycleParticipant`.

An install hook fires for **its own** module. A participant fires for **every**
module: `onModuleInstalled(event)` runs on any module's install, after that
module's settings are reconciled and before its own install hook, and
`onModuleHardUninstalled(event)` runs on any module's `uninstall --hard` and
never on a soft one. It is for a module whose table is a projection of what the
manifest set declares — the platform's own two are the translation bundles and
the command-palette actions — and it exists because such a module could reach
the lifecycle no other way: the orchestrator also serves the `module:*` CLI, and
a platform command composes no container, so a port could not be resolved.

`ModuleInstalledEvent` carries `{ moduleId, manifest, modulePath, em, log }` and
`ModuleHardUninstalledEvent` carries `{ moduleId, manifest, em, log }` — with
`manifest` nullable on the second, for a registration row whose module the
instance no longer has. Write through the supplied `em`; a participant that
forks its own commits beside the operation rather than inside it. Both methods
are required, deliberately: feature detection through an optional method is what
D-97.3 refuses on a published port, and a participant with nothing to do on one
edge writes an empty body, which a reader can see.

Additive: no existing export changed shape, and a `manifest.ts` that declares no
participant is unaffected.
