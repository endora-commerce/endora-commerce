---
'@endora-commerce/platform': minor
'@endora-commerce/cli': minor
---

`composeApp` is the platform's, and it takes a deployment's contributions as a callback.

`@endora-commerce/platform/composition` gains `composeApp`, `ComposeAppOptions`,
`ComposeAppHandle` and `ComposedAppContext`. It performs the whole assembly a deployment used
to write out — refuse a boot with no `PUBLIC_API_BASE_URL`, open the ORM, build the container,
register the host values, load module presence, compose the settings and sales-channel kernels,
run `composeModules` once, open the contribution window once, install the request-scope hook,
reconcile the settings manifests, run the boot phase once, assemble the error envelope — and
returns a handle you pass straight to `buildServer`.

Everything a deployment cannot share reaches it through options, and every one of them is
optional:

```ts
const composition = await composeApp({ deploymentRoot });
```

is a complete composition of whatever module packages are installed. Supply
`composition.modules` / `composition.manifests` / `composition.orm` when your build has
compiled-in modules and committed registries, `contribute` for values only your deployment can
supply, `values` for host names no module defaults, `buildTenantContext` for the actor mapping,
`plugins` / `scopedPlugins` for route plugins on either side of the request scope, and
`decorationOrder` / `declaredOmissions` for what your deployment's `divergence.ts` declares.
Omitting `composition` entirely means "no compiled-in half", which is what an instance is: its
modules, entities and migrations are the packages it installed.

`contribute` runs **after** the twenty contributions the platform makes itself, so a deployment
can still overwrite one; it runs inside the single contribution window (D-45, issue #52), so a
contribution made after the boot phase has started still throws `ContributionWindowClosedError`.

`AppComposition` and `AppOrmLifecycle` are exported from the module but deliberately not from
the barrel: a caller builds those object literals without naming either type.

`endora new instance` renders `composeApp({ deploymentRoot })` in the backend member's
`index.ts` and `worker.ts`, with `deploymentRoot` derived from the entry point's own location —
and renders no contribute callback, because a client's tree holds no composition root.
