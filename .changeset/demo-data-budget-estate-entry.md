---
'@endora-commerce/cli': patch
---

The static-check estate manifest gains `check:demo-data-budget` —
`specs/113-module-owned-demo-data/` FR-016, a per-module budget on shipped non-`.ts` demo
assets.

`scope: 'package'`, tier `A`: a module's demo layer is located from that module's own
manifest artefact and measured in that module's own source tree, so nothing about the
answer needs a sibling, an owner map or an application.

Its `host` is `pending`, and the phase is named rather than numbered because what a
package-scope host waits for is neither of tier B's two halves. It is a **relocation**:
*"does this file ship"* has exactly one owner since D-218 —
`scripts/lib/runtime-assets.mjs`' `classifyAssetFile`, the same function
`copy-package-assets.mjs` and the manifest generator ask — and that file sits at the
repository root, outside every package. A host here cannot reach it without a second copy
of the classification, which is precisely the defect D-218 closed.

Two `partial` signals are declared: the accepted per-module floors are this repository's
ledger, and `undeclared-demo-assets` probes layer paths derived from *other* modules'
declarations, neither of which a lone package supplies.
