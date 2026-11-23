# Contract — Overlay type-check, build and freshness (FR-010 – FR-017, R-2, R-3, R-9, R-14)

## §1 Type-check (#1847 — stands alone, may precede the MikroORM 7 switch)

**Instance.** The template writes `backend/tsconfig.apps.json`:

```jsonc
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": "../apps",
    "outDir": "dist/apps",
    "erasableSyntaxOnly": true,
    "noEmit": true            // flipped to false by §2 (#1848)
  },
  // `apps/<deployment>/*.ts` too: `divergence.ts` (and its generated twin) is read at
  // runtime (decorationOrder, commandHookOrder are checked at composition), so a compiled
  // root without it would read every deployment as declaring nothing — silently.
  "include": ["../apps/*/modules/**/*.ts", "../apps/*/*.ts"],
  "exclude": ["../apps/*/modules/*/admin/**", "../apps/**/*.test.ts"]
}
```

`backend/package.json` gains `typecheck: "tsc -p tsconfig.json --noEmit && tsc -p tsconfig.apps.json
--noEmit"`; the root `setup` sequence runs it before `migrate`. Bare specifiers resolve through the
instance root's `node_modules` to the installed packages' `dist` declarations — the same types the
runtime loads.

**This repository.** `backend/tsconfig.json`'s program holds `src/**/*` today. `src/apps/**` moves to
a third program `backend/tsconfig.apps.json` (`erasableSyntaxOnly: true`), excluded from
`tsconfig.json`; `backend/package.json`'s `typecheck` names all three; the
`workspace-resolution.test.ts` "exactly one program per file" rule is widened from two programs to
three. `tsconfig.build.json` (the image build) keeps emitting `src/apps` → `dist/apps` as today.

## §2 Build (#1848 — after §1; may precede the MikroORM 7 switch)

`endora build overlays [--watch]` (new CLI subcommand, `packages/cli/src/build/`):

1. **Layout refusals** (`overlay-module-layout.md` §1) over every deployment on disk.
2. **Compile**: spawn the instance's own `tsc -p backend/tsconfig.apps.json` (`noEmit: false`,
   `declaration: false`, `sourceMap: true`). `--watch` passes through.
3. **Assets**: mirror every runtime asset of every overlay module into `backend/dist/apps/…`, using
   the runtime-asset classification lifted from `backend/scripts/lib/runtime-assets.ts` into
   `packages/cli/src/lib/runtime-assets.ts` (this repository's `copy-runtime-assets.ts` then imports
   it). An unclassified extension is refused, as today. In watch mode assets are re-mirrored on change.
4. Exit codes per `cli-surface.md` §2: 0 done, 1 refusal / compile error, 2 unreadable input.

Instance scripts (template `backendScripts`):

| Script | Before | After |
| --- | --- | --- |
| `build` | `tsc -p tsconfig.json` | `tsc -p tsconfig.json && endora build overlays` |
| `dev` | `tsc --watch & node --watch dist/index.js` | `tsc --watch & endora build overlays --watch & node --watch dist/index.js` |

`node --watch` restarts on an emitted `.js` change because it watches every loaded module; an i18n
edit needs a dev restart (the `_i18n` reconciler reads bundles at boot) — stated in the docs.

## §3 Deployment roots (FR-016)

Every compiled entry point of an instance (`index.ts`, `worker.ts`, `migrate.ts`, `cli.ts`,
`module-commands/*.ts`, `mikro-orm.config.ts`) passes:

- `deploymentRoot` = `backend/dist` (holds `apps/` compiled);
- `deploymentSourceRoot` = the instance root (holds `apps/` sources).

The CLI's tree readers (`endora generate`, `endora new …`) keep reading sources at the instance root.
This repository's binding (`backend/src/overlay/overlay-roots.ts`) passes `backend/src` under `tsx`
and, when compiled, `backend/dist` with source root `backend/src` if it exists.

## §4 Freshness guard (FR-015)

Runs inside overlay resolution (`overlayModulesUnder`), before any overlay import, whenever
`deploymentSourceRoot` is given and differs from `deploymentRoot`. Pairing and verdicts:
`data-model.md` §5. A refusal lists every non-fresh pair (not the first), then
`Rebuild: pnpm run build` (instance) or `pnpm --filter backend run build` (here). No source root: one
`info` line `[overlay] no source root; build freshness not compared`.

## §5 Upgrade (FR-017)

`endora upgrade` rewrites the wiring files of §3, writes `backend/tsconfig.apps.json`, updates the
`build` / `dev` / `typecheck` / `setup` scripts, and prints the one-line note of OQ-190-1. A wiring
file whose content differs from the previous release's rendering is reported, not overwritten (the
existing wiring rule).

## §6 Tests

- Instance acceptance (`scripts/acceptance/instance.ts`): type error, `enum`, stale edit, unbuilt
  module, orphan unit, `package.json` under `apps/` — each refused by the named command; a clean
  overlay builds and boots.
- Platform unit: pairing over a temp tree (all four verdicts; admin and test files excluded).
- CLI unit: asset mirroring; unclassified extension refused.
