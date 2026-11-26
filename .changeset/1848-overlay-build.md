---
'@endora-commerce/cli': minor
'@endora-commerce/platform': minor
---

**Breaking change** (issue #1848): an instance's overlay code is compiled, and a compiled tree that no
longer matches `apps/` refuses to start.

Overlay modules under `apps/<deployment>/modules/` used to be loaded as TypeScript with the types
stripped, which strips decorators with them. They are now compiled like the rest of the backend:

- `endora build overlays [--watch]` (new) refuses a broken layout, compiles `apps/` with the
  instance's own `tsc -p backend/tsconfig.apps.json` into `backend/dist/apps`, and copies each
  module's `i18n/` beside the code. The backend member's `build` is
  `tsc -p tsconfig.json && endora build overlays`, and `dev` runs `endora build overlays --watch`.
- The compiled entry points (`index`, `worker`, `cli`, `module-commands/runtime`) compose from
  `backend/dist` and pass the instance root as `deploymentSourceRoot`. Before importing any overlay
  code, the platform compares every compiled unit with its source. An edit that was not rebuilt
  (`stale`), a module that was never built (`unbuilt`) or a compiled file whose source is gone
  (`orphan`) is refused with both paths and `Rebuild: pnpm run build`.
- An overlay module is flat and is not a package. A `manifest.ts` below a module's root
  (`nested-module`) and a `package.json`, `tsconfig*.json` or bundler or test configuration inside
  a module (`package-in-disguise`) are refused by the build and by every process that resolves
  overlay modules.
- `ComposeAppOptions`, `RunCliOptions` and `InstanceOperatorRuntimeOptions` take an optional
  `deploymentSourceRoot`. Without it, one line at boot says that freshness was not compared.
- `@endora-commerce/cli` is declared in every new instance, because `build` runs it.

**Upgrading an instance from 0.112.0 takes two runs of `pnpm run upgrade`.** The first run is made
by the 0.112.0 CLI. It moves every release package to 0.113.0 and runs `setup`, and the instance
keeps starting on its old wiring: overlay code is not compiled, and one line at boot says nothing
was compared. The second run is made by the 0.113.0 CLI. It finds the instance at 0.113.0 and
brings the wiring to the new rendering:

- `backend/src/index.ts`, `backend/src/worker.ts`, `backend/src/cli.ts` and
  `backend/src/module-commands/runtime.ts` are rewritten;
- `backend/tsconfig.apps.json` is written if it is absent;
- the backend member's `build`, `dev` and `typecheck` scripts, the root `typecheck`, and the
  `typecheck` term of `setup` are moved.

A file is rewritten only while it is exactly what 0.112.0 wrote. A file you edited is reported and
left as it is. Re-apply your edit to the new rendering, which `endora new instance` shows, and run
`pnpm run build`. From 0.113.0 on, one run of `pnpm run upgrade` does both halves: it hands the
rest to the CLI it just installed (`endora upgrade --finish`).
