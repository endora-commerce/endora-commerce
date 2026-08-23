/**
 * Re-export shim — this file's sources now live in `@endora-commerce/platform`
 * (feature 080, the platform relocation; D-160, D-164, D-165).
 *
 * The five platform directories moved to `packages/platform/src/` so that the
 * application and an installed extension package resolve **one** copy of the
 * platform. Everything in `backend/` still names them at their old paths — 2632
 * relative specifiers in 1347 files — and each of those specifiers now arrives
 * here and is forwarded to the package. The forwarding target is the package's
 * build output, which is what its `exports` map serves, so a bare specifier and
 * a relative one land on the same file and therefore on the same module record.
 *
 * This file is a published subpath's own entry point, so the shim names the
 * subpath: `@endora-commerce/platform/kernel`, exactly as a packaged module does.
 *
 * These shims are the bridge, not the destination: each is deleted as the module
 * that reaches through it becomes a package and rewrites its specifier to the
 * published subpath (T040b).
 */
export * from '@endora-commerce/platform/kernel';
