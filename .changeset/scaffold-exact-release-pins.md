---
'@endora-commerce/cli': patch
---

A scaffold of release X now names every package of release X at exactly X.

`endora install`, `endora new instance` and `endora new storefront` — and so
`npx create-endora-commerce@X` — used to write `^X` for the platform, every module, the admin
shell, the design system, the page-builder and component packages and the CLI, and `X` exactly
only for `@endora-commerce/contracts`. Run after a newer patch was published, the install
resolved the carets to the newer patch and kept `contracts` at X: two copies of `contracts` and
one unmet-peer warning per module, in a tree nobody had edited. Every package of the release is
now written exactly, in the root, `admin/` and `docs/` manifests and in the storefront, so a
scaffold of X installs X on any day and moves forward only through `pnpm run upgrade`, which
keeps an exact pin exact. A package of the scope at another version than the release keeps its
caret, and third-party ranges are unchanged.

An instance already scaffolded with carets needs nothing: `pnpm run upgrade` (or, on `0.101.x`
or earlier, `pnpm add -D -w @endora-commerce/cli@<version>` then `pnpm exec endora upgrade
<version>`) puts it on one version.
