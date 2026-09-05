/**
 * Re-export shim — this file's sources live in `@endora-commerce/cli`
 * (`specs/089-endora-cli-module-scaffold/`, Phase 2).
 *
 * The shared library the static-check estate is built on lives in the package so
 * that a module author outside this checkout can be held to the same rules.
 * Every consumer in `backend/` names it at this path, and each of those
 * specifiers arrives here and is forwarded to the package.
 *
 * The forwarding target is the **bare** specifier, not a path into `dist`: the
 * CLI carries a `tsconfig.base.json` `paths` entry, so `tsc` and `tsx` read the
 * package's source while `node` and `vitest` read its `exports` map — one
 * declared spelling in the tree, and therefore one copy in any one process.
 */
export * from '@endora-commerce/cli/lib/delegated-composer.js';
