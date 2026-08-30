/**
 * Re-export shim — this file's sources now live in `@endora-commerce/cli`
 * (`specs/089-endora-cli-module-scaffold/`, Phase 2).
 *
 * The shared library the static-check estate is built on moved into the package
 * so that a module author outside this checkout can be held to the same rules.
 * Every consumer in `backend/` still names it at the old path, and each of
 * those specifiers now arrives here and is forwarded to the package.
 *
 * The forwarding target is the **bare** specifier, not a path into `dist`: the
 * CLI carries a `tsconfig.base.json` `paths` entry, so `tsc` and `tsx` read the
 * package's source while `node` and `vitest` read its `exports` map — one
 * declared spelling in the tree, and therefore one copy in any one process. A
 * relative reach into `packages/cli/dist` would be a second spelling of the same
 * module, which is the duplication `check:singleton-identity` exists to refuse.
 *
 * These shims are the bridge, not the destination: each is deleted as its
 * consumers become hosts over the relocated analyses (Phase 5).
 */
export * from '@endora-commerce/cli/lib/repeating-timers.js';
