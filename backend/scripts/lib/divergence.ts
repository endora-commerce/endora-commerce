/**
 * Re-export shim — this file's sources live in `@endora-commerce/cli`
 * (`specs/110-instance-repository/` T138a).
 *
 * The divergence report has **two hosts**: `overlay:divergence` here, over this
 * repository's own module layout, platform sources and composition roots, and
 * `endora generate` inside a client's instance, over the packages that instance
 * installed and the platform it resolved out of `node_modules`.
 * `contracts/instance-repository.md` R3.5 is that the population is a parameter
 * and the renderer is one program — so the derivation lives in the package both
 * hosts can reach, and this path keeps working for every consumer in `backend/`
 * that already names it.
 *
 * The derivation was already pure over its input (`deriveDivergence` takes the
 * deployment's sources, the route table, the owner map, the declaration and
 * `ModuleContext`'s members), which is what made the move a relocation rather
 * than a rewrite: the two hosts differ only in how each of those five is
 * assembled.
 *
 * The forwarding target is the **bare** specifier, not a path into `dist`: the
 * CLI carries a `tsconfig.base.json` `paths` entry, so `tsc` and `tsx` read the
 * package's source while `node` and `vitest` read its `exports` map — one
 * declared spelling in the tree, and therefore one copy in any one process.
 */
export * from '@endora-commerce/cli/lib/divergence.js';
