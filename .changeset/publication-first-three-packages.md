---
'@endora-commerce/page-builder-core': minor
'@endora-commerce/cms-components': minor
'@endora-commerce/contracts': minor
---

These three packages stop being `"private": true` and can be published.

They are the set a scaffolded storefront resolves (D-195), derived rather than chosen:
`storefront/package.json` declares exactly these three `@endora-commerce/*` ranges, and their
closure over `dependencies` and `peerDependencies` adds nothing.

Each now declares `repository` — a consumer's path back to the code, and npm's prerequisite for
provenance — and `publishConfig.access: "public"`, which is a property of the package rather than
of the registry it happens to reach. **No `publishConfig.registry` in any of them**: the registry
is CI configuration and the client's `.npmrc`, so moving from the private rehearsal to npmjs is
one variable rather than three manifest edits.

Nothing about the packages' own API changes in this release. What changes is that there is one:
a consumer can install them by version instead of by tarball path.

Two consequences worth knowing before the first `changeset version` run. `page-builder-core` and
`cms-components` are in the `linked` group with `email-components` and `page-builder-admin`
(D-108), and at `0.0.0` a `workspace:^` peer range is out of range after any bump — so those two
will have their `version` fields advanced while staying private and unpublished. That is correct
and needs no repair. And the private registry's version history is independent of npmjs': a
version a deployment consumes privately is not thereby taken on the public registry, and
`changeset publish` replays no history — it publishes the current version of each package or
nothing.
