---
'@endora-commerce/platform': major
---

Narrowed `@endora-commerce/platform/lifecycle` by six names, and made it the address the
generated composition and manifest index use for `_lifecycle`.

The two generated artefacts named `_lifecycle`'s `backend.ts` and `manifest.ts` through
`../../packages/platform/dist/lifecycle/…` — a relative path into this package's build
output, which resolves in the monorepo and in no tree that installs the platform. So the
artefact whose whole job is to register the modules a build ships could not register
`_lifecycle` anywhere else. They now name this subpath, which is what it was added for.

That made `backend.ts`, `manifest.ts`, `plugin.ts` and `services/module-origin.ts` reached
by nothing relative, so the barrel's second rule applies to them alone — *a name here is
one a consumer outside the platform actually imports* — and six names fell to it:

```diff
-export { registerModule, type LifecycleCradle } from './backend.js';
-export {
-  lifecycleModule,
-  lifecycleModuleFromStaticEntries,
-  type LifecycleModule,
-  type LifecycleModuleDeps,
-  type LifecycleModuleHandle,
-} from './plugin.js';
+export { registerModule } from './backend.js';
+export { lifecycleModuleFromStaticEntries } from './plugin.js';
```

`OriginatedManifestEntry` leaves `./lifecycle` on the same reasoning;
`deploymentShippedEntries` and `ModuleIdClaimOrigin` stay.

**If you named one of the six**, you were naming a host-internal subpath no module may
name at all — `check:platform-surface` reports that as `host-internal-subpath`. There is
no replacement address, deliberately: this surface drives the platform's own presence axis
and a module that could name it could install, uninstall, enable or disable its siblings.
