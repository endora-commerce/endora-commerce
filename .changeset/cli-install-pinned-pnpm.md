---
'@endora-commerce/cli': patch
---

`endora install` on a machine without `pnpm` on `PATH` now runs the pnpm this release pins, instead of `corepack pnpm@latest`. The `latest` tag had moved to a pnpm (12.8.1) whose `bin/pnpm.mjs` the corepack bundled with Node 22.18 cannot start, so the install died with `Cannot find module '…/pnpm/12.8.1/bin/pnpm.cjs'` before installing anything. The CLI's build now records the repository's own `packageManager` (`pnpm@9.15.0`) in its release index, `endora install` runs exactly that through corepack, and the instance it scaffolds declares the same `packageManager`, so the CLI and the instance agree on one pnpm.

With that pnpm reached through corepack, the instance's own scripts — `setup` chains `pnpm run generate && pnpm run build && …` — still found no `pnpm` and failed with `sh: 1: pnpm: not found`. The pipeline's steps now run with a `pnpm` shim for the pinned version first on their `PATH`, in a temporary directory the run removes on exit (never `corepack enable`), and the closing block tells you to put that pnpm on your own `PATH` before the commands it prints.
