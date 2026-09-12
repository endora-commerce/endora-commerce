---
'@endora-commerce/cli': minor
---

`relativeLinksIn` now reports whether a link left the modules category.

`RelativeLink` gains `leavesCategory: boolean`. `docId === null` alone did not
say this: a link that climbs above the category (`../architecture/x.md`) and a
link that resolves to the category root both came back with no doc id, and a
consumer could not tell them apart. The first names a page only the host
repository's own site tree has and is broken in every instance; the second names
a page the generator writes into every instance.

Consumers reading the field: none is required to. Existing code that reads
`target` and `docId` is unaffected; code that constructs a `RelativeLink`
literal must add the field.
