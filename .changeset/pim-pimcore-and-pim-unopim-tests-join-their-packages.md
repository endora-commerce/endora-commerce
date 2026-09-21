---
---

Feature 134 W2: nine of `pim_pimcore`'s and `pim_unopim`'s harness-free single-owner tests
move from `backend/test/{unit,contract}/` into their own packages, beside their subjects. No
package's published output changes, so this carries no release meaning.

Asked as `specs/conventions/release-intent.md` asks it — *"does this commit change what a
published package emits?"*, a function of the package's `tsconfig.build.json` rather than of
a path — and asked separately for each of the two mechanisms a moved file can reach the
tarball through, because only one of them is the `tsconfig`.

**The `.ts` half, by configuration.** Both `@endora-commerce/mod-pim-pimcore` and
`@endora-commerce/mod-pim-unopim` have a `tsconfig.build.json` with no `exclude` of its own
that `extends` the package's `tsconfig.json`, whose `exclude` is
`["src/admin/**/*", "src/**/*.test.ts", "src/**/*.spec.ts"]`. Every file moved here is a
`src/**/*.test.ts`, so all nine are outside the emit by name. Verified rather than reasoned:
`pnpm run build:packages` after the move leaves no `*.test.*` under either package's `dist`.

**The asset half, which `tsconfig` says nothing about — and this branch has none.** D-218's
hazard is a non-`.ts` fixture beside a test, which `RUNTIME_ASSET_EXTENSIONS` would classify
as a runtime asset and `copy-package-assets.mjs` would carry into `dist`. No `.json`, `.txt`
or other asset moves in this branch: the nine files are `.ts` and nothing else. Neither
package's `package.json` changed, so neither `build` grew a copy step and the lockfile is
untouched.

`files` is `["dist", "i18n", "docs", "tailwind.css"]` for both packages, so `src/` is not in
the tarball at all — the moved tests are outside the published set twice over.

The rest of the branch is `backend/`, which the changesets `ignore` list covers: the
`test-ownership` shard for `pim_pimcore` deleted outright with all four of its entries
drained, and one host test reduced to the `pim_unopim` ↔ `catalog` seam that is the only
assertion in it with two owners.
