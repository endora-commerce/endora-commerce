---
---

D-218: `pim_akeneo`'s HMAC canonical-vector test and its `.json` vectors move from
`backend/test/unit/pim_akeneo/` into `packages/modules/pim_akeneo/src/backend/services/`,
beside the `hmac.ts` they cover. No package's published output changes, so this carries no
release meaning.

Asked as `specs/conventions/release-intent.md` asks it — *"does this commit change what a
published package emits?"*, which it calls a function of the package's
`tsconfig.build.json` rather than of a path — and answered for **both halves of the move**,
because they are answered by different mechanisms and only one of them is the `tsconfig`.

**The `.ts` half, by configuration.** `@endora-commerce/mod-pim-akeneo`'s
`tsconfig.build.json` carries no `exclude` of its own and `extends` the package's
`tsconfig.json`, whose `exclude` is
`["src/admin/**/*", "src/**/*.test.ts", "src/**/*.spec.ts"]`. A co-located test is outside
the emit by name.

**The `.json` half, by the asset classifier, and this is the half `tsconfig` says nothing
about.** `RUNTIME_ASSET_EXTENSIONS` holds `.json`, so before D-218 `manifests:generate` read
a `.json` under `src/` as a runtime asset, added `copy-package-assets.mjs` to the package's
`build`, and `dist` is in `files` — the fixture would have shipped.
`scripts/lib/runtime-assets.mjs` now answers `'fixture'` for a shippable file with a sibling
test, which this one has. Verified rather than reasoned: `pnpm --filter backend run
manifests:generate` after the move leaves `packages/modules/pim_akeneo/package.json`
byte-identical, its `build` still
`tsc -p tsconfig.build.json && tsc -p tsconfig.ui.json` with no copy step, so nothing
carries the vectors into the tarball.

The rest of the branch is `backend/`, which the changesets `ignore` list covers: one
`test-ownership` shard deleted outright with its last entry drained, and the recorded read
sizes.
