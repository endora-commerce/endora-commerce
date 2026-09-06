---
---

Two test fixtures stop asserting a tree state the owner's publication ruling of 2026-09-05
(D-208) removed. Neither changes what any package publishes.

`@endora-commerce/test-kit` — `test/manifest-names-no-module.test.ts` asserted
`private: true` on the kit's own manifest, and the field is gone: FR-001 of
`specs/109-backend-test-kit/` requires a **published** package, because the kit's value is
that a module package outside this checkout can install it. The assertion is dropped rather
than inverted — `check:release-intent` already judges every versionable member's publication
state, and a second derivation of one fact is two answers waiting to disagree. What the case
keeps is the half nothing else asserts: the name, the four declared subpaths and the absent
root export.

`backend/test/release/changeset-gate.test.ts` is the backend's and carries no release
meaning. Its two `privatePackages.version` cases borrowed a private package from the tree,
and there is none left; the fixture now marks one private itself, which is the shape
`changeset-flow.test.ts` took in the publication branch.

The kit's `test/` directory is not in its `files` list, so nothing this changes reaches a
consumer.
