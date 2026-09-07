/**
 * `./packages` — installed extension-package discovery, and the platform's
 * tenth subpath (`specs/110-instance-repository/` T113, FR-013).
 *
 * ## What is on it
 *
 * The answer to *"which Endora module packages did an operator install in this
 * instance, and what do they compose to?"* — the `node_modules` scan, the
 * classification that tells a tarball install from a workspace link, the
 * manifest and `ModuleEntry` readers a composition root appends to its one
 * `composeModules([...MODULES, ...overlay, ...packages], …)` call, the schema
 * contribution the ORM configuration merges, and the entity lookup a host
 * program uses to reach a class it may not import.
 *
 * It reads a package; it configures nothing. Merging what it finds into the
 * execution order and into the ORM configuration is the host's
 * (`backend/src/db/configured-migrations.ts`, `configured-entities.ts`), so the
 * merge keeps exactly one implementation and this directory still knows nothing
 * about a database.
 *
 * ## Why the platform carries it, and why an instance cannot
 *
 * This is *the* mechanism an instance depends on most (`research.md` §3.1): a
 * client's whole tree is a composition of packages, and the code that finds them
 * is not code a client may edit. It lived in `backend/src/packages/` while the
 * application *was* the platform; an instance's application is a member the CLI
 * scaffolds, and a scan it holds is a scan that diverges from ours the first
 * time we correct it.
 *
 * ## Why no module may name it
 *
 * D-160.14's third state, for `./composition`'s own reason one surface over:
 * this is the code that decides which packages are composed at all, so a module
 * that could name it could enumerate — and eventually judge — its siblings. It
 * is declared by the `exports` map and carried by no published barrel, so `node`
 * and `tsc` resolve it for the host and the test kit, and
 * `check:platform-surface` answers a module's reach into it with
 * `host-internal-subpath`.
 *
 * ## What stays in the application, and why
 *
 * `backend/src/packages/claimed-module-ids.ts`. It reads the **generated**
 * manifest index, which is a fact about one repository's tree (D-104, D-160.3),
 * so R7.4 keeps it out of the package: a relocated platform file may not import
 * a generated registry, it receives one. That file is a binding of eight lines
 * over this directory's `installedPackageModuleIdClaims`, and an instance writes
 * the same eight against its own index.
 *
 * The barrel names every symbol explicitly rather than re-exporting a directory:
 * `check:platform-surface` exits 2 on an `export *`, because a wildcard makes
 * the published set a property of whatever the files happen to declare rather
 * than of a decision anybody took.
 */

export {
  INSTANCE_ROOT_ENV,
  nodeModulesRootsFor,
  scanNodeModulesRoots,
  type InstalledPackage,
  type InstalledPackageScan,
  type SkippedPackage,
} from './installed-packages.js';

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
} from './package-runtime.js';

export {
  entityNamed,
  type EntityRowTypeIsRequired,
} from './package-entity-lookup.js';
