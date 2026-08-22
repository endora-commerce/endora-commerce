# `@endora-commerce/platform` — the host package

The surface an installed extension package compiles against. Five enumerated `exports`
subpaths, one per platform directory that has published API; no root export and no wildcard
(D-160.7). The design, the classification behind it and every rejected alternative are in
`specs/080-f4-real-scope/contracts/host-package.md`; this file records only what is peculiar
to the package directory itself.

## It has no `src/`, and that is the answer to the placement question

The contract's §2.1 points every subpath at `./dist/<dir>/index.js` and its §8 step 5 says
`rootDir`. Read together those two sentences imply the package's own `src/` holds `kernel/`,
`http/`, `tenancy/`, `commands/` and `events/` — which would mean **relocating five
directories out of `backend/src`**: 82 files, plus every relative specifier aimed at them from
the 1400-plus module files, plus both composition roots and the whole test tree. §9 records
that `tsc -p` over a host package with `rootDir` set was never run, so this was the part the
contract had not tested.

It is not required. `tsconfig.build.json` sets `rootDir` to `../../backend/src` and includes
exactly the five published directories. `tsc` emits paths relative to `rootDir`, so the layout
under `dist` is `kernel/`, `http/`, `tenancy/`, `commands/`, `events/` — byte-for-byte the
layout §2.1's `exports` map names, with the sources left where 1400 files already point at
them.

Two measurements make that safe rather than lucky:

- **The five directories are closed under relative imports.** 82 files, and **zero**
  specifiers escaping the set — nothing reaches `db/`, `overlay/`, `packages/`, `modules/` or
  `apps/`. So the `include` list is the whole compilation and no `db/index.js` (§1.4f: 219
  module-owned entity references) can be dragged in behind it.
- **`backend`'s own build is untouched.** `backend` type-checks with `--noEmit` and executes
  through `tsx`/`vitest`; it does not compile these files to `dist`. Nothing about this
  package changes what `backend` reads or emits, and the emitted output lands only under
  `packages/platform/dist`, which is git-ignored.

The relocation stays available and stays cheap in the direction that matters: moving the
sources here later changes `rootDir` and `include` and nothing else, because the `exports`
map already names the emitted layout rather than the source layout.

## Two tsconfigs, for the reason the other packages have two

`tsconfig.json` type-checks with `tsconfig.base.json`'s `paths` active — `@endora-commerce/*`
resolves at a sibling's source, which is what keeps a worktree honest (issue #255) — and
carries `noEmit`. `tsconfig.build.json` clears `paths`, sets `rootDir`, and emits with
`noEmitOnError`. Do not merge them: `rootDir` with an active `paths` block is TS6059, which
exits 2 **and** writes the sibling's output beside the sibling's source.

`rootDir` is deliberately absent from the type-check half. Here it would be a guaranteed
TS6059 — with `paths` active, `@endora-commerce/contracts` resolves into
`packages/contracts/src`, which no `rootDir` this package could name contains.

## No `lint` and no `test` script

The sources belong to the `backend` workspace, which lints them (`eslint src`) and tests them
(`backend/test`). A second `eslint` pass over the same files from here would be a second
author of the same verdict, and the package's own probes — the type probe, the runtime probe
and the distribution-shape assertions — live in `backend/test/unit/packages/`, where the rest
of the packaging evidence already is.
