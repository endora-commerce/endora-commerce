---
---

The vitest 2 → 4 upgrade, for every published package other than `@endora-commerce/test-kit`
(which has its own changeset, because its `peerDependencies` moved). Nothing here carries release
meaning for a consumer.

Asked the way `specs/conventions/release-intent.md` asks it — *"does this commit change what a
published package emits?"* — per mechanism:

- **`package.json`.** Every change is to `devDependencies.vitest` (`^2.1.4` → `^4.1.11`): in
  `@endora-commerce/cli`, `cms-components`, `contracts`, `email-components`, `page-builder-core`,
  `platform`, `create-endora-commerce`, and — through `manifests:generate`, which takes the
  backend's range — every `@endora-commerce/mod-*` package that declares a `vitest.config.ts`. A
  consumer's install never reads `devDependencies`; no `dependencies`, `peerDependencies`,
  `exports` or `files` key moves.
- **Emitted code.** The source files this branch edits are tests or test harness
  (`packages/contracts/test/payment-return-url.unit.test.ts`,
  `packages/page-builder-core/src/migration/frozen-block-renames.test.ts`,
  `packages/platform/src/kernel/scope-retention.test.ts`) and each package's `vitest.config.ts`.
  Every one is outside its package's `tsconfig.build.json` emit, so no `dist` file changes.
