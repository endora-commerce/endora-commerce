/**
 * Re-export shim — this file's sources now live in `@endora-commerce/platform`
 * (feature 080, D-160.11: `_lifecycle` merges into the host package).
 *
 * The lifecycle subsystem is the platform's operator half, so its
 * platform-safe files moved to `packages/platform/src/lifecycle/`. What stayed
 * behind is the host half — the manifest registry, the reduced-deployment
 * reader and the five `module:*` commands — and everything in `backend/` that
 * named a moved file at its old path arrives here and is forwarded.
 *
 * The forwarding target is the package's **build output**, which is what its
 * `exports` map serves, so a relative specifier and a bare one land on the same
 * file and therefore on the same module record: one `LifecycleError`, one
 * `registryCache`, one orchestrator class. This file names the built file
 * directly because the host publishes no subpath for it — D-160.7 keeps the
 * `exports` map at five, and a public API with one consumer forever is what
 * D-160.11 refused. That is the debt made visible, exactly as the five
 * platform directories' shims make theirs.
 */
export * from '../../../packages/platform/dist/lifecycle/plugin.js';
