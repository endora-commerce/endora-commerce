/**
 * Re-export shim — this file's sources live in `@endora-commerce/cli`
 * (`specs/109-backend-test-kit/` T065), for the reason
 * `lib/admin-artefacts.ts`' do.
 *
 * The entity index has **two hosts**: `composer:generate` here, over this
 * repository's workspace members, and `endora generate` inside a client's
 * instance, over the packages that instance installed.
 * `contracts/instance-repository.md` R3.5 is that the population is a parameter
 * and the renderer is one program — so the renderer lives in the package both
 * hosts can reach, and this path keeps working for every consumer in `backend/`
 * that names it.
 *
 * The forwarding target is the **bare** specifier, not a path into `dist`: the
 * CLI carries a `tsconfig.base.json` `paths` entry, so `tsc` and `tsx` read the
 * package's source while `node` and `vitest` read its `exports` map — one
 * declared spelling in the tree, and therefore one copy in any one process.
 */
export * from '@endora-commerce/cli/lib/entity-index-artefact.js';
