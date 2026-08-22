---
---

No release meaning, and the judgement is worth writing down because it will not
hold for long.

D-162 rewrites 114 `ioredis` imports from the default spelling to the named one,
across `backend/src` and `backend/test`. Five of them sit in
`backend/src/kernel`, which `@endora-commerce/platform` compiles into its
published `dist` — so once that package is on `master`, a change to those five
files is a change to a published surface and carries a real changeset. It is not
on `master` today: no versionable package here compiles `backend/src`, and both
gates agree — `changeset status --since=master` and
`check:release-intent --since master` each report nothing.

Nothing to release even then, as it happens: 66 of the 72 repaired imports in
`src` are `import type` and are erased, and the six value imports resolve to the
identical class (`default === Redis` at runtime). The emitted `.js` does not
move. What *would* move for a consumer is the emitted `.d.ts`, which stops
carrying `import type Redis from 'ioredis'` and stops being a `TS2709` under
`moduleResolution: NodeNext` with `skipLibCheck: false` — a repair to a
declaration, in a package nobody can install yet.
