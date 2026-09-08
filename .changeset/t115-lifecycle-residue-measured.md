---
---

No release meaning: this change edits `specs/` only, plus the read-size record the spec-file
count moves.

`specs/110-instance-repository/` T115 asked for `backend/src/lifecycle/`'s seven
application-resident files to move into `@endora-commerce/platform`. Re-measured on this tree,
the movable population is **0**: `specs/115-lifecycle-container-move/` Phases 3–7 moved the
manifest-registry derivation, the divergence shape and the five `module:*` command bodies, and
deleted the twelve shims. The six files left — 513 lines — are the manifest-registry **binding**
and the five ~20-line command **entry points**, which `specs/115-…/contracts/operator-half.md`
§1.1 rules stay in the tree that installs the platform.

No package's `exports` map, published surface or emitted `dist` changes. `@endora-commerce/platform`
gains no subpath and loses none; every symbol keeps its address. There is nothing for a consumer
to do.
