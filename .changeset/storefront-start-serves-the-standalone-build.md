---
'@endora-commerce/cli': patch
---

A scaffolded storefront's `pnpm run start` now serves the build `pnpm run build` produced, without the warning. The storefront builds with `output: 'standalone'`, and its `start` script ran `next start`, which prints `"next start" does not work with "output: standalone" configuration`. `start` is now `node --env-file-if-exists=.env scripts/start-standalone.mjs`: it finds the standalone server under the directory's own name, puts `.next/static` and `public/` beside it on every start, and listens on every interface on the `PORT` in `.env`. If the tree was not built it says to run `pnpm run build`. `dev` and `dev:all` are unchanged — they run `next dev`. A storefront written by an earlier release keeps its old script; copy `scripts/start-standalone.mjs` and the `start` line from a new one to get this.
