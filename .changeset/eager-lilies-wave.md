---
---

D-257: six module-owned tenancy tests move from `backend/test/unit/<id>/` into
`packages/modules/<id>/src/backend/entities/`, beside the entity sources they read.
No package's published output changes, so this carries no release meaning.

Asked as `specs/conventions/release-intent.md` asks it — *"does this commit change what a
published package emits?"*, which it calls a function of the package's
`tsconfig.build.json` rather than of a path — and answered per package rather than reused
from a previous wave. Each of `@endora-commerce/mod-pim-akeneo`,
`mod-pim-pimcore`, `mod-pim-ergonode`, `mod-pim-unopim`, `mod-comarch-xl` and
`mod-product-feeds` has a `tsconfig.build.json` that carries no `exclude` of its own and
`extends` the package's `tsconfig.json`, whose `exclude` is
`["src/admin/**/*", "src/**/*.test.ts", "src/**/*.spec.ts"]`. A co-located test is
therefore outside the emit by name, which is also why the pattern is there at all — that
`exclude`'s own comment says a compiled test would import `vitest`, a devDependency, and
be an unresolvable specifier in every consumer's install.

Verified rather than reasoned: both pristine worktrees, base and tip, were built with
`pnpm run build:packages` and their six `dist` trees compared by path and by content hash.
All six are **byte-identical** across the move — 280, 300, 272, 344, 312 and 500 files
respectively, the same on each side — and none contains a `*.test.*` file.

The rest of the branch is `backend/`, which the changesets `ignore` list covers: two check
ledgers, five `test-ownership` shards (one deleted outright, its last entry drained), the
recorded read sizes, and two prose corrections where a comment cited a moved path.
