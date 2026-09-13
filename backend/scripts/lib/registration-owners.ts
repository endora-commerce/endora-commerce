/**
 * Re-export shim — this file's sources live in `@endora-commerce/cli`
 * (`specs/110-instance-repository/` T138a).
 *
 * The port→owner merge is shared by `check:port-dependencies` and by the
 * divergence report, and the report now has two hosts — this repository and a
 * client's instance — so the merge rule went where both can reach it. Its three
 * sources and their precedence are unchanged; what differs between the hosts is
 * only which of the three has anything in it.
 *
 * The forwarding target is the **bare** specifier, not a path into `dist`: the
 * CLI carries a `tsconfig.base.json` `paths` entry, so `tsc` and `tsx` read the
 * package's source while `node` and `vitest` read its `exports` map — one
 * declared spelling in the tree, and therefore one copy in any one process.
 */
export * from '@endora-commerce/cli/lib/registration-owners.js';
