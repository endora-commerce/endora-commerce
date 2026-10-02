---
'@endora-commerce/cli': patch
---

A storefront written by `endora new storefront` or `endora install` no longer reports an unmet `eslint` peer on its first install. `eslint-plugin-jsx-a11y`'s newest release still declares a peer that stops at eslint 9, while the storefront — like the platform repository it is copied from — lints with eslint 10. The repository now states that combination at its root (`pnpm.peerDependencyRules.allowedVersions`), and the scaffold carries the root's rules into the storefront's own manifest, because pnpm reads them from a root manifest and the scaffolded storefront is one.
