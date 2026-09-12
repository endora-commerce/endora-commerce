# Building the packages — why `build:packages` is a precondition, and the build shape

**Open this before touching a package's build configuration, and when a type-check and a test
run disagree about what a file contains.** It carries why every package under `packages/`
ships a compiled `dist`, why `tsc` is the one exception, the two-tsconfig rule, why the
application itself compiles, and the one third-party package this repository may not default-
import. One of the bodies `AGENTS.md` routes to; it is the single home for these rules, so
never restate them in `AGENTS.md` or in a tool-specific pointer file.

```

**Building the packages** (feature 080, T042). Every package under `packages/` ships a
compiled `dist` and its `exports` map points at it, with a `types` condition on every
subpath. A **module** package does so for a second reason of its own (D-164): `tsx` applies one
tsconfig per process, so a decorated file outside it is lowered with standard decorator
semantics while MikroORM's are legacy, and a source-shipping module's entities die at load. So `pnpm run build:packages` is not an optional step — until it has run in a fresh
checkout, every `@endora-commerce/*` specifier is unresolvable at **runtime**, which is
`vitest`, `tsx`, `vite` and `next` alike. Its filter is `./packages/**`, not `./packages/*`:
the single star does not cross a directory separator, so a module package — which sits a
directory deeper — would silently not be built and every specifier naming it would be
unresolvable. Every CI job that executes repository code runs it after the install;
`release:changeset` is the one that does not, because it imports nothing of ours. **`tsc` is
the exception and deliberately so**: `tsconfig.base.json`'s `paths` keeps it on the packages'
*source*, which is what makes a type error land on the line that caused it and what keeps the
#255 worktree guard working. The consequence is a real one and worth stating: a stale `dist`
means the type-check and the test run are reading different files. Rebuild after touching a
package.

**That now includes the platform**, which is the case most likely to catch someone out:
`kernel`, `http`, `tenancy`, `commands` and `events` are `@endora-commerce/platform`'s sources,
so editing one and re-running a test without
`pnpm --filter @endora-commerce/platform run build` runs the previous build. `@endora-commerce/platform`
is also the one package `tsc` does **not** read at source — it has no `paths` entry, deliberately;
see `backend-test-suite.md` § *The workspace-resolution guard*. And `pnpm run dev` does not watch those files either: since feature
080's T047a it is one esbuild context over `backend/src` plus a restart driven by that build
(`backend/scripts/dev.mjs`), and the platform is not under `backend/`. That last sentence used
to name `tsx watch src/index.ts`; the loop changed and the consequence did not, but the loop
also **stopped** picking up the five packages that have a `paths` entry, which `tsx` did read at
source. So the rule is now uniform and worth stating once: **edit a package, build that package,
restart the loop** — for `@endora-commerce/contracts` exactly as for the platform. Measured, that
is 5.4 s of `tsc` and a 5.9 s boot, against the 24.9 s restart `tsx watch` took to do it
automatically for `contracts` alone while running its *source* against a `dist` everything else
in the repository reads.

**And the application itself compiles** (feature 080, D-165). Production runs
`node dist/index.js`, not `tsx src/index.ts`: the image builds
`pnpm --filter backend run build` and `deploy/compose.prod.yml` migrates with
`node dist/db/migrate.js up`. That build is `tsc` **plus** `copy-runtime-assets`, and the second
half is not a convenience — `tsc` compiles `.ts` and copies nothing else, so a tree without it
holds every module's code and none of its data, which is a *silent* defect and not a crash:
`loadModuleBundles` reads an absent bundles directory as "this module ships no translatable
strings". Measured on one machine, three runs each: boot to first request 11.9 s -> 5.3 s,
resident 838–851 MB over five processes -> 480–486 MB in one. **Nothing in a source-tree check
can see whether any of this is true**, which is why the `boot-gate` job exists and why it is the
condition of the ruling rather than a follow-up — see its row in `check-inventory.md`.

Two things about the build shape that look like detail and are not. Each package has **two**
tsconfigs — `tsconfig.json` type-checks with `paths` active and cannot emit (`noEmit: true`),
`tsconfig.build.json` clears `paths`, sets `rootDir` and emits. Do not merge them: `rootDir`
with an active `paths` block is TS6059, which exits 2 **and emits the sibling package's
output beside that sibling's source** — 432 untracked files in `packages/contracts/src` and
`packages/page-builder-core/src`, in the measurement that produced this rule. And every build
sets **`noEmitOnError: true`**, because `dist/` is git-ignored: a compile that failed would
otherwise ship its artefacts and leave nothing for anybody to notice.


## One package may not be default-imported

**A published `@endora-commerce/*` package compiles under `moduleResolution: NodeNext` *and*
under `Bundler`** (D-162). This repository is on `Bundler`, which is the lenient of the two;
`tsc --init` on TypeScript 5.9 writes `"module": "nodenext"`, so a third-party author's
default toolchain is the strict one. The whole difference is **one package**: `ioredis` is
imported **by name** — `import { Redis } from 'ioredis'`, never `import Redis from 'ioredis'`
— because `built/index.js` reassigns `module.exports` to the class while `built/index.d.ts`
writes `export { default }`, so NodeNext models the default binding as the module namespace:
`TS2709` as a type, `TS2351` as a constructor. The named export is the identical class at
runtime (`default === Redis`). It is a rule about *this* package and not a prohibition on
default imports — the other eight default-imported bare specifiers in the tree (`stripe`,
`exceljs`, `sharp`, `nodemailer`, …) are clean under both modes, measured. Two ratchets, and
neither is a `check-*` script, deliberately: a `no-restricted-imports` entry in
`eslint.config.js` refuses both bad spellings, and
`test/unit/packages/package-dist-build.test.ts` compiles every package's **emitted `dist`** in
a NodeNext consumer with `skipLibCheck: false` — the only thing that can see the error once it
is inside a published `.d.ts`, where the author who hits it cannot fix it.
