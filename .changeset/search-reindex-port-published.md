---
'@endora-commerce/contracts': minor
'@endora-commerce/mod-search': patch
---

`SearchReindexPort` is published: the container name `searchReindexPort`, owned
by `search`, with the `Container name:` doc block its consumers read.

It had a registration and no contract, which was invisible while the only
consumer was a composition root — `check:port-shape`'s population is a module's
own resolutions, and a root's read is outside it. `catalog` resolves the name
directly since `specs/117-instance-bring-up/` Phase 6, and the check reported
it on the first run.
