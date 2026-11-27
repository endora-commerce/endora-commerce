---
'@endora-commerce/cli': minor
---

**Breaking change** (issue #1855): an overlay module can ship an admin screen, and an instance's
admin is built for one deployment.

An overlay module under `apps/<deployment>/modules/<id>/` may now ship `admin/index.tsx`, exporting
`contributions` like a package's `./admin` layer.

- **`endora generate`** writes one registry per deployment under `apps/`, plus bare core's:
  `admin/src/deployments/<deployment>.generated.ts` and `admin/src/deployments/none.generated.ts`.
  They are not committed. The stylesheet enumeration gets one `@source` per overlay admin layer.
  The command also checks palette coverage per deployment. If an overlay admin page has no
  command-palette action of its own, or a landing route or sidebar entry no action targets, it
  writes everything and then exits 1, naming the manifest to fix. An admin layer saved as
  `admin/index.ts` rather than `admin/index.tsx` is refused before anything is written.
- **The admin build selects one registry.** `admin/vite.config.ts` reads `DEPLOYMENT` from the
  environment, then from the root `.env`. Unset or blank builds bare core (`none`). A deployment
  with no registry stops the build with the file and `pnpm run generate`. React, React DOM, the
  admin kit and the admin shell resolve to the admin member's single copies, from overlay code too.
  `admin/src/main.tsx` renders the installed packages' screens, then that deployment's.
  `admin/tsconfig.json` type-checks `../apps/*/modules/*/admin/**/*`. `backend/tsconfig.apps.json`
  already left these files out.
- **`endora new module --admin <section>` and `--action <id>=<route>`** now work inside an instance.
  `--admin` writes `admin/index.tsx` and `admin/pages/<Module>Page.tsx`. `--action` adds the
  manifest's palette action, gated by the module's first permission, with its keys in both
  bundles. `backend.ts` registers one gated admin route per action target.
- **API.** `@endora-commerce/cli/lib/admin-artefacts.js` adds `emitDeploymentAdminRegistry`,
  `renderDeploymentAdminRegistriesInto`, `collectDeploymentAdminLayers`,
  `collectOverlayAdminSources`, `adminSourceRootIn`, `deploymentRegistryFileName` and
  `DeploymentAdminLayerError`. `emitTailwindRegistry` takes a fourth argument, the overlay
  `@source` paths. `@endora-commerce/cli/lib/admin-deployment.js` (`selectDeploymentAdminRegistry`,
  `adminSingletons`, `DEPLOYMENT_ADMIN_ALIAS`) and `@endora-commerce/cli/lib/palette-coverage.js`
  are new. `GenerateResult` gains `palette`, and `generatePaletteRefusal` is new.

**Upgrading an instance from 0.112.0.** The second run of `pnpm run upgrade`, the one made by the
0.113.0 CLI, also brings the admin member to the new rendering:

- `admin/src/main.tsx`, `admin/vite.config.ts` and `admin/tsconfig.json` are rewritten. The new
  `vite.config.ts` imports `@endora-commerce/cli/lib/admin-deployment.js`, which the admin member
  already declares;
- `admin/src/deployments/*.generated.ts` is added to `.gitignore`. Nothing else in that file
  changes.

A file is rewritten only while it is exactly what 0.112.0 wrote. A file you edited is reported
and left as it is. Re-apply your edit to the new rendering, which `endora new instance` shows,
and run `pnpm run generate`. An instance with no admin member is not changed.

**The admin image takes the deployment too.** `deploy/Dockerfile.admin` is an example the upgrade
does not touch. A new instance's copy declares `ARG DEPLOYMENT=<deployment>` and
`ENV DEPLOYMENT=$DEPLOYMENT` before `RUN pnpm run build:admin`. Add both lines to your copy, and
pass `--build-arg DEPLOYMENT=<deployment>` where you build the image. Without them the image is
bare core, and none of the deployment's overlay screens is in it.
