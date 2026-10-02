---
'@endora-commerce/cli': patch
---

The temporary host `endora install` provisions is now installed with `--ignore-scripts`. It is read and deleted, so nothing in it needs building, and under pnpm 10 the step used to end with an *Ignored build scripts … run pnpm approve-builds* box about a directory the operator never sees again. The step's description now says what it counts: the `@endora-commerce/*` packages of the release, which is one fewer than the release publishes because the unscoped `create-endora-commerce` is not installed there.
