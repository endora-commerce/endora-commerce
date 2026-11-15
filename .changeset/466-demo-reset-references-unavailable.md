---
---

`demo reset` and references in another organization's records to the demo's documents (issue #466): no code change. An Opportunity or a Project of another organization whose text names a demo Order or Quote Request keeps that text, and the reference rows derived from it, after a reset; the mention renders as unavailable. The reset never edits another organization's records. Pinned by the demo reset integration test and by unit tests of both reference services; documented in the getting-started guide (EN + PL).
