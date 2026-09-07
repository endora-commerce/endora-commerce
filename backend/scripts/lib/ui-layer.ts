/**
 * Re-export shim — this file's sources now live in `@endora-commerce/cli`
 * (`specs/101-endora-check/`, Phase 2).
 *
 * `check:action-route-permissions` skips a module's UI layer, and that rule now
 * has two hosts: this repository's `check-action-route-permissions.ts` and
 * `endora check` over one module package. The name a rule skips a directory by
 * has to live where both hosts can reach it, which is the package.
 *
 * The forwarding target is the **bare** specifier, not a path into `dist`: the
 * CLI carries a `tsconfig.base.json` `paths` entry, so `tsc` and `tsx` read the
 * package's source while `node` and `vitest` read its `exports` map — one
 * declared spelling in the tree, and therefore one copy in any one process.
 *
 * These shims are the bridge, not the destination: each is deleted as its
 * consumers become hosts over the relocated analyses (Phase 5).
 */
export * from '@endora-commerce/cli/lib/ui-layer.js';
