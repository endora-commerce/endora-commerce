// Installed extension packages (feature 080, T031).
//
// A first-party CORE layer, peer of `overlay/`, `events/`, `http/` and `db/` —
// not a lifecycle module and not a platform root (it may name a module id, but
// imports none). It answers one question at composition time: which Endora
// module packages are installed in this instance's `node_modules`, and what do
// they compose to?
//
// The directory is called `packages/` after the thing it discovers — an npm
// package installed into an instance. It has nothing to do with the
// repository's own `packages/` workspace, and by construction cannot see it:
// every workspace member is linked out of `node_modules` and is refused for
// that reason (`installed-packages.ts`).

export * from './installed-packages.js';
export * from './module-id-claims.js';
export * from './package-runtime.js';
