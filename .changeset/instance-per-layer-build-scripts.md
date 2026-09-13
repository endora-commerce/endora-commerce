---
'@endora-commerce/cli': minor
---

`endora new instance` names the per-layer builds in the tree it writes. The root manifest gains
`build:backend`, plus `build:admin` and `build:docs` for the members that were written, and the
composite `build` is now the conjunction of exactly those entries — same value as before, in the
same `backend, admin, docs` order, derived from one list rather than spelled a second time.

Under D-230 the backend, the admin and the storefront are deployed to hosts of their own, on
schedules of their own; a CI job on the admin host could not cite a command it had never been
told, because the per-member commands existed only inside the composite's value.

The emitted `README.md`'s command block is now rendered from the root manifest's own `scripts`,
so it names every command the tree declares and no command it does not — `dev`, `module:status`
and the three per-layer builds were all absent from it before.

Normative: `specs/122-layer-deployment-independence/contracts/layer-independence.md` §2 R2.1.
