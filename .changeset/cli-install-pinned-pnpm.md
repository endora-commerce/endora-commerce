---
'@endora-commerce/cli': patch
---

`endora install` on a machine without `pnpm` on `PATH` now runs the pnpm this release pins, instead of `corepack pnpm@latest`. The `latest` tag had moved to a pnpm (12.8.1) whose `bin/pnpm.mjs` the corepack bundled with Node 22.18 cannot start, so the install died with `Cannot find module '…/pnpm/12.8.1/bin/pnpm.cjs'` before installing anything. The CLI now declares `packageManager` (`pnpm@9.15.0`, the repository's own), runs exactly that through corepack, and the instance it scaffolds declares the same value, so the CLI and the instance agree on one pnpm.
