/**
 * Overlay resolution, at the path its consumers already name.
 *
 * The sources are `@endora-commerce/platform`'s since
 * `specs/110-instance-repository/` T114 (FR-013, R7.1): deciding which modules
 * a deployment adds is the loader's half of the overlay pattern, and a client's
 * copy of it is a copy that diverges the first time we correct ours. It derives
 * no path — the root is a parameter — which is what let it move at all.
 *
 * **The specifier is bare**, so it resolves in a client instance exactly as it
 * does here and is not a `RELATIVE_HOST_REACHES` reach (R7.3). `./overlay` is
 * host-internal (D-160.14): declared by the `exports` map, carried by no
 * published barrel, and named by no module.
 */
export {
  listOverlayModuleDirs,
  resolveOverlay,
  type OverlayResolution,
} from '@endora-commerce/platform/overlay';
