---
'@endora-commerce/cli': patch
---

`endora install` on a machine without `pnpm` on `PATH` now runs the pnpm this release pins, instead of `corepack pnpm@latest`. The `latest` tag had moved to a pnpm (12.8.1) whose `bin/pnpm.mjs` the corepack bundled with Node 22.18 cannot start, so the install died with `Cannot find module '…/pnpm/12.8.1/bin/pnpm.cjs'` before installing anything. The CLI's build now records the repository's own `packageManager` (`pnpm@9.15.0`) in its release index, `endora install` runs exactly that through corepack, and the instance it scaffolds declares the same `packageManager`, so the CLI and the instance agree on one pnpm.
