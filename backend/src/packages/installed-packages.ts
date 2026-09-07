/**
 * Installed-package discovery, at the path its consumers already name.
 *
 * The sources are `@endora-commerce/platform`'s since
 * `specs/110-instance-repository/` T113 (FR-013, R7.1): finding the module
 * packages an operator installed is the mechanism an instance depends on most,
 * and a client's copy of it is a copy that diverges the first time we correct
 * ours.
 *
 * **The specifier is bare**, so it resolves in a client instance exactly as it
 * does here and is not a `RELATIVE_HOST_REACHES` reach — R7.3's line between a
 * shim that is progress and one that is the defect renamed. `./packages` is
 * host-internal (D-160.14): declared by the `exports` map, carried by no
 * published barrel, and named by no module.
 */
export {
  INSTANCE_ROOT_ENV,
  nodeModulesRootsFor,
  scanNodeModulesRoots,
  type InstalledPackage,
  type InstalledPackageScan,
  type SkippedPackage,
} from '@endora-commerce/platform/packages';
