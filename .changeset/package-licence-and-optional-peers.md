---
---

No package changes anything it emits in this branch, so nothing is released by it — and the
second half of that claim is the one worth a reviewer's attention, because a `peerDependencies`
map *is* something a consumer resolves.

**What moves.** All 79 `@endora-commerce` packages gain a `license` (`MIT`), 70 of them from the
generator and 9 by hand. 56 module packages lose their `vitest` peer and 8 lose
`@fastify/type-provider-zod`; 55 gain a `peerDependenciesMeta` marking React, the admin kit,
`react-router-dom`, `lucide-react` and their neighbours optional. Not one `dist` tree moves:
`pnpm --filter backend run manifests:check` and `pack-gate` both pass, and `pnpm-lock.yaml` is
unchanged, because pnpm records peers per *installed* package rather than per importer and every
name here is either a workspace link or already a `devDependency` of the same package.

**Why that is not release-meaningful, in the direction that could be.** Both changes **relax**
what a consumer must provide. Nothing that was resolvable stops being resolvable: a peer removed
is a peer nobody has to install, and a peer marked optional is one npm stops providing
automatically for a consumer who never imports the layer that needs it. The consumer who *does*
import `./admin` declares React itself — an admin application is where React comes from, not a
module package — so the case where an optional peer would bite is one that cannot arise from this
tree.

**And the version they publish at is not this file's to decide.** D-210 sets the first published
version by hand at `0.7.0`, before `changeset version` consumes anything, precisely because the
accumulated changesets describe migration work done while every package was private at `0.0.0`.
A bump here would be consumed by that first release and would name a change no consumer can
observe — which is the argument `packages-become-publishable.md` made for exactly this shape of
branch, and the same one applies.

Written rather than skipped so that a reviewer can disagree with it in the diff. A reviewer who
thinks a relaxed peer set is release-meaningful should say so here.
