/**
 * Re-export shim — this file's sources now live in `@endora-commerce/cli`
 * (`specs/110-instance-repository/` T138).
 *
 * Which packages ship scannable UI is a question with **two hosts** now: this
 * repository's `composer:generate`, over its workspace members, and `endora
 * generate` inside a client's instance, over the packages that instance
 * installed (`contracts/instance-repository.md` R3.5). The derivation has to
 * live where both hosts can reach it, which is the package — and a second copy
 * of it would be two answers to one population, which is the state
 * `admin-stylesheet-composition.md` R2.2 already refuses between the renderer
 * and the guard.
 *
 * The forwarding target is the **bare** specifier, not a path into `dist`: the
 * CLI carries a `tsconfig.base.json` `paths` entry, so `tsc` and `tsx` read the
 * package's source while `node` and `vitest` read its `exports` map — one
 * declared spelling in the tree, and therefore one copy in any one process.
 */
export * from '@endora-commerce/cli/lib/tailwind-sources.js';
