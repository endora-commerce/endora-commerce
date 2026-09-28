---
'@endora-commerce/cli': minor
---

Add `endora dev`, and a `dev:all` root script in every instance `endora new instance` and `endora install` write. From the instance root, `pnpm run dev:all` starts the API (`pnpm run start`), the admin preview (`pnpm run preview:admin`, when the instance has an admin) and the storefront beside the instance (its `pnpm run dev`, when there is one at `<dir>-storefront` or at `--storefront-dir <path>`), in one terminal with each line prefixed by its layer. Ctrl-C stops all of them and exits 0; any one layer ending stops the others, names which, and exits with that layer's code. `--no-storefront` starts the API and the admin preview only.

No per-layer script changes: `build`, `build:backend`, `build:admin`, `start` and `preview:admin` keep their values, and each layer is still built and deployed on its own. The instance README lists the new script, and the closing block `endora install` prints now names `pnpm run dev:all` first, followed by the per-layer commands it replaces for everyday use.

An instance scaffolded by an earlier version gains the script by adding `"dev:all": "endora dev"` to its root `package.json`; the `@endora-commerce/cli` devDependency it already declares provides the binary.
