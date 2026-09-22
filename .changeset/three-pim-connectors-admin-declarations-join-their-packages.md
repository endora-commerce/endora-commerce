---
---

Feature 134 **W2.2**: `pim_akeneo`, `pim_pimcore` and `pim_unopim` each gain a co-located
`src/admin/index.test.ts` — `pim_pimcore` also `src/admin/issue-reasons.test.ts` — carrying
the two subjects of their admin tests that are the module's own: what the module *declares*
(routes, gates, nav, zones, and that each lazy page resolves) and whether its own screens
reach outside the package. No package's published output changes, so this carries no release
meaning.

Asked as `specs/conventions/release-intent.md` asks it — *"does this commit change what a
published package emits?"*, a function of the package's build configuration rather than of a
path — and asked **per package and per mechanism**, because a file under `src/admin/` is
compiled by a *different* program from the rest of `src/` and the two answer separately.

**The backend `.ts` program, by inheritance.** All three packages' `tsconfig.build.json`
carry no `exclude` of their own and `extends` the package's `tsconfig.json`, whose `exclude`
is `["src/admin/**/*", "src/**/*.test.ts", "src/**/*.spec.ts"]`. Every file added here is
both a `src/admin/**/*` and a `src/**/*.test.ts`, so it is outside that emit twice over.

**The `src/admin/` program, which is the question the sentence above does not answer.**
`tsconfig.ui.json` is the only program that compiles `src/admin/`, and it **replaces** the
inherited `exclude` rather than adding to it — it has to, or `tsc` reports TS18003 over the
one directory it exists to compile. What it replaces it with is
`["src/**/*.test.ts", "src/**/*.test.tsx", "src/**/*.spec.ts", "src/**/*.spec.tsx"]`,
identical in all three packages, and the config's own comment says why the test patterns are
kept: *"a co-located test compiled into `dist` imports `vitest`, an unresolvable specifier in
every consumer's install."* So the four files are outside this emit by name as well.

**Verified rather than reasoned.** `pnpm run build:packages` after deleting all three
packages' `dist` leaves no `*.test.*` under any of them — the only `test`-named path in each
is the pre-existing `dist/test-support/`, which is a published subpath and untouched here.

**The asset half, which no `tsconfig` speaks to, and this branch has none.** D-218's hazard is
a non-`.ts` fixture beside a test, which `RUNTIME_ASSET_EXTENSIONS` would classify as a
runtime asset and `copy-package-assets.mjs` would carry into `dist`. All four added files are
`.ts`. No `package.json` changed, so no `build` grew a copy step, `manifests:check` is clean
and the lockfile is untouched.

`files` is `["dist", "i18n", "docs", "tailwind.css"]` for all three packages, so `src/` is
not in the tarball at all.

The rest of the branch is `admin/`, `backend/` and `specs/`, which the changesets `ignore`
list covers: four `admin/test/**` files deleted and four narrowed under W2.2/W2.3, two stale
prose pointers repaired, and one recorded read size re-recorded.
