/**
 * Re-export shim — this file's sources now live in `@endora-commerce/cli`
 * (`specs/101-endora-check/`, Phase 2).
 *
 * `check:transaction-context` reads the direction of a statement through
 * {@link sqlTableAccesses} and a knex handle through {@link isGetKnexCall}, and
 * that rule now has two hosts: this repository's `check-transaction-context.ts`
 * and `endora check` over one module package. A predicate two hosts share has to
 * live where both can reach it, which is the package.
 *
 * The forwarding target is the **bare** specifier, not a path into `dist`: the
 * CLI carries a `tsconfig.base.json` `paths` entry, so `tsc` and `tsx` read the
 * package's source while `node` and `vitest` read its `exports` map — one
 * declared spelling in the tree, and therefore one copy in any one process.
 *
 * One signature changed on the way across, and deliberately:
 * `declaredTableNames` now takes the entity-class → table-name convention as a
 * **required** parameter. It used to import `PluralizingNamingStrategy`'s
 * pluralizer out of `backend/src/db/`, which the package cannot reach — the
 * application depends on the CLI as a development tool, never the other way
 * round — and a copy of the pluralizer in the package would make two authors of
 * one convention. The callers in this tree pass the strategy's own functions, so
 * it stays the single author.
 *
 * These shims are the bridge, not the destination: each is deleted as its
 * consumers become hosts over the relocated analyses (Phase 5).
 */
export * from '@endora-commerce/cli/lib/sql-tables.js';
