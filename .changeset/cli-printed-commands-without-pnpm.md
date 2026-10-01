---
'@endora-commerce/cli': patch
---

`endora install` on a machine without `pnpm` on `PATH` now prints commands that run as printed. It used to tell you to install pnpm globally first and then print `pnpm run dev:all`, which fails with "command not found" when that line is skipped — as the public acceptance run against `0.100.1` showed. Every command it hands over (`dev:all`, `start`, `preview:admin`, the storefront's build and start, the demo seed/reset hint, `dev:services:down`, and the remaining steps after a failure) now runs this release's pinned pnpm through `npx --yes pnpm@<version>`, which needs only Node and npm and puts that pnpm on `PATH` for the instance's own nested scripts. With `pnpm` on `PATH` the commands stay `pnpm …`.
