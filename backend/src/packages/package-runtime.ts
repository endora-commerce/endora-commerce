/**
 * The composition half of installed-package discovery, at the path its
 * consumers already name.
 *
 * The sources are `@endora-commerce/platform`'s since
 * `specs/110-instance-repository/` T113 (FR-013, R7.1). See
 * `installed-packages.ts` beside this file for why the specifier is bare rather
 * than a reach into the package's build output.
 */
export {
  discoverPackageModuleManifests,
  discoverPackageSchema,
  installedPackageModuleIdClaims,
  loadPackageModuleEntries,
  packageModuleEntriesUnder,
  packageModuleManifestsUnder,
  packageSchemaContributionsUnder,
  type EntityClassLike,
  type MigrationRegistryEntry,
  type PackageModuleManifest,
  type PackageSchemaContribution,
} from '@endora-commerce/platform/packages';
