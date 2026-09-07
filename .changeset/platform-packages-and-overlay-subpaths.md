---
'@endora-commerce/platform': minor
---

Two new host-internal subpaths, `./packages` and `./overlay`
(`specs/110-instance-repository/` T113 and T114).

`./packages` carries installed extension-package discovery: `nodeModulesRootsFor`,
`scanNodeModulesRoots`, `discoverPackageModuleManifests`, `loadPackageModuleEntries`,
`packageModuleEntriesUnder`, `packageModuleManifestsUnder`, `discoverPackageSchema`,
`packageSchemaContributionsUnder`, `installedPackageModuleIdClaims` and `entityNamed`, with
`InstalledPackage`, `InstalledPackageScan`, `SkippedPackage`, `PackageModuleManifest`,
`PackageSchemaContribution`, `EntityClassLike`, `MigrationRegistryEntry` and
`EntityRowTypeIsRequired`. `./overlay` carries the overlay loader:
`listOverlayModuleDirs`, `resolveOverlay`, `resolveOverlayUnit`, `overlayModuleIdsUnder`,
`overlayModuleManifestsUnder` and `overlayModuleEntriesUnder`, with `OverlayResolution` and
`OverlayModuleManifest`.

Both are **host-internal** (D-160.14): declared by the `exports` map, carried by no
published barrel, and named by no module. `check:platform-surface` answers a module's reach
into either with `host-internal-subpath`.

Two behavioural notes for a composition root. `nodeModulesRootsFor` derives its search chain
from its own location, so the chain now starts at `@endora-commerce/platform` rather than at
the application — which is where the platform actually runs from in an instance, and is what
`ENDORA_INSTANCE_ROOT` exists to override. And the overlay loader derives **no** path: the
overlay root and the claims already made on a module id are parameters, because both are
facts about the application and R7.4 says a relocated platform file receives such a thing
rather than reaching for it. The two entry points that used to answer "the active
deployment's" — `discoverOverlayModuleManifests(env)` and `loadOverlayModuleEntries(env)` —
are the application's binding and are not on this subpath.
