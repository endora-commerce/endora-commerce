// Overlay layer (feature 057-overlay-pattern-multideploy; feature 103).
//
// A first-party CORE layer (peer of `events/`, `http/`, `db/`) — not a
// lifecycle module. It resolves a per-deployment source set at
// build/composition time, so a client deployment can add client-only modules
// and decorate core registrations WITHOUT editing core or forking. See
// specs/057-overlay-pattern-multideploy/ and, for what a deployment may
// override, docs/docs/architecture/overlay-pattern.md.
//
// It no longer resolves file overrides: the shadowing rule, its unit taxonomy,
// its conflict policy and its three build-time refusals were retired by D-201,
// which measured that no loader for a shadowed `route` or `config` file was
// ever written and that feature 072 deleted the one written for `service`.

export * from './types.js';
export * from './overlay-roots.js';
export * from './resolve-overlay.js';
export * from './override-manifest.js';
export * from './overlay-runtime.js';
