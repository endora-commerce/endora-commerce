// Overlay resolution layer (feature 057-overlay-pattern-multideploy).
//
// A first-party CORE layer (peer of `events/`, `http/`, `db/`) — not a
// lifecycle module. It resolves a per-deployment source set (core modules PLUS
// a deployment's overlay modules) deterministically at build/composition time,
// so a client deployment can replace or extend core services/routes/config and
// add client-only modules WITHOUT editing core or forking. See
// specs/057-overlay-pattern-multideploy/.

export * from './types.js';
export * from './errors.js';
export * from './overlay-roots.js';
export * from './conflict-policy.js';
export * from './resolve-overlay.js';
export * from './override-manifest.js';
export * from './check-core-contracts.js';
export * from './overlay-runtime.js';
