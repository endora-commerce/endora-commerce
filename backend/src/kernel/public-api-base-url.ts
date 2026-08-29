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
 * This file has **no published subpath** — it is reach into the host's
 * internals that `check:platform-surface` already ledgers — so the shim names
 * the built file directly. That is the debt made visible: a specifier a packaged
 * module could not write.
 *
 * These shims are the bridge, not the destination: each is deleted as the module
 * that reaches through it becomes a package and rewrites its specifier to the
 * published subpath (T040b).
 */
export * from '../../../packages/platform/dist/kernel/public-api-base-url.js';
