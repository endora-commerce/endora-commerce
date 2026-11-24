# Contract — Overlay admin layer (FR-080 – FR-086, R-8, #1855)

After the ruling (this spec); parallel to schema discovery; may precede the MikroORM 7 switch.

## §1 The layer

`apps/<deployment>/modules/<id>/admin/index.tsx` exports `contributions: AdminContributions`
(`@endora-commerce/admin-kit/contributions`) — the same export a package's `./admin` layer has. Every
route and zone component is a `() => import('…')` factory, as for packages, so the registry costs the
declarations and none of the screens.

## §2 Registries

| File | Contents |
| --- | --- |
| `admin/src/modules.generated.ts` | unchanged — packages only, bare core |
| `admin/src/deployments/<deployment>.generated.ts` | `export const DEPLOYMENT_ADMIN_CONTRIBUTIONS: readonly AdminRegistryEntry[]` — that deployment's overlay layers, sorted by module id, imported by relative path |
| `admin/src/deployments/none.generated.ts` | the same export, `[]` |

Rendered by `packages/cli/src/lib/admin-artefacts.ts` (`emitDeploymentAdminRegistry`, one renderer for
both trees). This repository: rendered by `composer:generate` for **every** deployment on disk and
committed; `overlay:check` byte-compares each. Instance: rendered by `endora generate`, not committed.

## §3 Build selection (wiring)

- `admin/vite.config.ts`: alias `@endora-commerce-deployment/admin` →
  `src/deployments/${DEPLOYMENT}.generated.ts`, or `none.generated.ts` when `DEPLOYMENT` is unset;
  a named deployment with no file **refuses the build** naming the regenerate command. `DEPLOYMENT` is
  read from the process environment, then the instance root's `.env` (the backend's source).
  `resolve.dedupe: ['react', 'react-dom', '@endora-commerce/admin-kit', '@endora-commerce/admin-shell']`.
- `admin/src/main.tsx`:
  `<AdminRoot contributions={[...MODULE_ADMIN_CONTRIBUTIONS, ...DEPLOYMENT_ADMIN_CONTRIBUTIONS]} />`.
  No admin-shell change: id uniqueness is guaranteed by the backend's id claims.
- `admin/tsconfig.json` `include` gains the overlay admin layers (`../apps/*/modules/*/admin/**/*` in
  an instance, `../backend/src/apps/*/modules/*/admin/**/*` here); the backend overlay project excludes
  them (`overlay-build.md` §1).
- Instance admin image: `ARG DEPLOYMENT` passed to `build:admin` (`deploy.ts` `adminDockerfile`).
- `admin/src/tailwind.generated.css`: one `@source` per overlay admin layer of every deployment on
  disk.

## §4 Palette (Principle XVI) per deployment

- Overlay manifests' `actions` are reconciled at boot through the resolved registry (unchanged
  mechanism); the requirement is the test that proves it for an overlay.
- Coverage analysis (landing covered, sidebar covered, `module-without-action`, `PALETTE_EXEMPTIONS`)
  is lifted from `admin/test/unit/palette-coverage.test.ts` into `packages/cli/src/lib/palette-coverage.ts`.
  Readers: that test, iterating **every deployment on disk** (population: core registry + that
  deployment's registry + its manifests); and `endora generate` in an instance.
- `registered-bundles-shape.test.ts`, `check:action-route-permissions` and the permission inventory
  (`DEPLOYMENT=<name>`) cover overlay layers of every deployment.
- The `module-admin-surfaces.md` sentence "Overlay modules discovered at runtime are outside it" is
  replaced in the same merge request.

## §5 Off state

The admin renders an overlay's surfaces only when `isSurfaceVisible` says the module is effectively
present — the same predicate as for packages. A bundle built for a deployment whose backend does not
compose the module shows nothing of it.

## §6 Tests

- Renderer unit: two deployments → two registries, bare → empty; the bundle-content test of SC-004
  (build for A contains no import of B's layer).
- Admin unit: palette coverage per deployment, red on a landing route with no action.
- Off-state e2e for the reference overlay (US8).
