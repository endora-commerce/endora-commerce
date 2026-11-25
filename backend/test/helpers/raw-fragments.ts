/**
 * The registry MikroORM 7 keeps a `raw()` fragment's back-reference in
 * (issue #1866): `globalThis[Symbol.for('@mikro-orm/core/RawQueryFragment.references')]`,
 * shared across copies of `@mikro-orm/core`. It is a `WeakMap` keyed by the
 * fragment's symbol, so a fragment no statement consumed is collected with its
 * key — the process-wide cache MikroORM 6 counted with
 * `RawQueryFragment.checkCacheSize()` does not exist any more. A test that held
 * that cache's size now holds this registry's weakness instead.
 */
export function rawFragmentReferences(): unknown {
  return (globalThis as Record<symbol, unknown>)[Symbol.for('@mikro-orm/core/RawQueryFragment.references')];
}
