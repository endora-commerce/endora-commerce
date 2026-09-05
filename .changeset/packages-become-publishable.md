---
---

No release meaning, and the reason is D-210 rather than the change being small.

This branch makes all 79 `@endora-commerce` packages publishable — 75 of them
stop being `"private": true`, and every one gains the `repository` and
`publishConfig.access` a published package owes a consumer. Not one line of
what any package *emits* moves: the tarballs a consumer would receive carry
byte-identical `dist` trees, and `pnpm --filter backend run pack-gate` proves
all 79 pack clean at `0.7.0`.

The version they publish at is not this file's to decide either. D-210 sets the
first published version by hand at `0.7.0`, **before** `changeset version`
consumes anything, precisely because the accumulated changesets describe
migration work done while every package was private at `0.0.0` — they are not a
breaking change *from* `0.0.0`, they are the first release. A bump here would be
consumed by a later release and would name a change no consumer can observe.

Written rather than skipped so that a reviewer can disagree with it in the diff,
which is what the empty changeset is for.
