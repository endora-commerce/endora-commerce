---
'@endora-commerce/platform': minor
---

Narrowed `@endora-commerce/platform/lifecycle` to the names its consumers import, which is
what the last nine `_lifecycle` re-export shims stopped being able to hide.

`backend/src/lifecycle/` held nine 20-line shims — `routes.admin.ts` and eight under
`services/` — each spelling `export * from '../../../../packages/platform/dist/lifecycle/…'`.
A relative path into this package's build output resolves in the monorepo and in no tree
that installs the platform, so the application was not a consumer of the package it ships.
112 reaches across 50 files in `backend/test/**` were the only thing still holding them
open; they now name this subpath and the shims are deleted, which empties
`backend/src/lifecycle/services/` entirely.

That changes what decides the barrel's contents. A shim holds its target's **whole
namespace**, so while one existed the barrel had to carry every name the file exported or
the reach could not retire onto it. With none left, the only rule is the one
`./composition` has had all along — *a name here is one a consumer outside the platform
actually imports* — and 28 names fell to it:

```diff
 export {
-  registerApiInterceptorAdminRoutes,
   registerLifecycleAdminRoutes,
-  registerModulePresenceRoutes,
-  type ApiInterceptorAdminDeps,
-  type LifecycleAdminDeps,
-  type ModulePresenceAdminDeps,
 } from './routes.admin.js';
 export {
   LifecycleError,
   ModuleLifecycleOrchestrator,
-  type DisableResult,
-  type EnableResult,
-  type InstallResult,
-  type OrchestratorDeps,
-  type UninstallResult,
 } from './services/orchestrator.js';
```

and the same for `LOCK_TTL_SECONDS`, `LOCK_REFRESH_INTERVAL_MS`, `LifecycleLeaseHandle`,
`orderModulesByDependencies`, `AcknowledgedPortEdge`, `PresencePredicate`, `ConsequenceRow`,
`DeactivationOutcome`, `UnassignedShape`, `collectLifecycleParticipants`, `isLoadError`,
`loadProjectManifests`, `resolveFromFile`, `DiscoverOptions`, `LoadedModuleEntry`,
`NeededBy`, `ReducedDeploymentFinding` and `StaticRegistryEntry`. Each is still exported
from its own file inside the package; what it no longer has is an address outside it.

**If you named one of the 28**, you were naming a host-internal subpath no module may name
at all — `check:platform-surface` reports that as `host-internal-subpath`. There is no
replacement address, deliberately: this surface drives the platform's own presence axis,
and a module that could name it could install, uninstall, enable or disable its siblings.
