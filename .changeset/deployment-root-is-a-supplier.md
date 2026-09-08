---
'@endora-commerce/platform': minor
---

`@endora-commerce/platform/overlay` gains four functions that take the deployment root as a
parameter: `selectedDeployment`, `overlayModulesRootFor`, `deploymentsOnDisk` and
`activeOverlayModulesRoot`.

The deployment root is the directory that holds `apps/`. It is now **supplied** rather than
derived: nothing under `packages/platform/` works it out from its own `import.meta.url`, because
in an instance the platform came out of `node_modules` and `apps/` is a sibling of the backend
member, so any root the package could derive names a directory holding no deployment at all.

```diff
-// The application computed all four itself, from one `import.meta.url`.
-const root = activeOverlayModulesRoot(process.env);
+import { activeOverlayModulesRoot } from '@endora-commerce/platform/overlay';
+
+// One expression the application still owns, handed in.
+const deploymentRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
+const root = activeOverlayModulesRoot(deploymentRoot, process.env);
```

`selectedDeployment(env)` reads `DEPLOYMENT` and names no path, so its signature is unchanged.
The other three take the root **first**, before their existing arguments.

`./overlay` is host-internal (D-160.14): declared by the `exports` map, carried by no published
barrel, and named by no module. A module reaching for it is a `host-internal-subpath` finding.
