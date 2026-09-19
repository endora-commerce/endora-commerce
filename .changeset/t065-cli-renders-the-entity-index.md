---
'@endora-commerce/cli': minor
---

`endora generate` renders a host's test entity index, and `./lib` publishes the renderer

A server-bound test needs the entity class **the ORM registered**, and a module package publishes
one `entities` array and no entity class by name (D-168). *Which* modules a host installed is the
one fact `@endora-commerce/test-kit` may not know (feature 109 R2.2, FR-001), so the index is a
generated per-host artefact: `backend/test/entities.generated.ts`, every installed module keyed by
its own `endora.id`, with the `entities` array off its published `./backend`.

`./lib/entity-index-artefact.js` is the renderer, one derivation over two populations
(`instance-repository.md` R3.5) exactly as `./lib/admin-artefacts.js` is: `endora generate` runs it
over an instance's installed packages and `composer:generate` runs it over this repository's
workspace members. A module package publishing no `./backend` is refused rather than skipped — a
skip reports an installed module as one nobody installed, which sends its operator to look at
their install rather than at the artefact.

It is the fifth artefact family and the first that belongs to **no member**, which narrows two
things rather than weakening them. The `generate` script and the `@endora-commerce/cli`
devDependency are now written for a headless instance that installed a module, because such an
instance does have something to render. And `endora generate`'s exit-1 refusal — *a run that wrote
nothing and said it succeeded* — now fires on a workspace with no member, no deployment **and no
installed module**, and its message names the third condition.
