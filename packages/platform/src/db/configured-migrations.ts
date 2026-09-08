import type { MigrationObject } from '@mikro-orm/core';
import {
  discoverPackageSchema,
  type PackageSchemaContribution,
} from '../packages/package-runtime.js';
import { BASELINE_MIGRATIONS } from '../migrations/index.js';
import type { DiscoveredManifestEntry } from '../lifecycle/manifest-registry.js';
import {
  orderMigrations,
  type MigrationOrderDiagnostic,
  type MigrationOrigin,
  type MigrationRegistryEntry,
} from './migration-order.js';

/**
 * The migration order this platform runs, as a value — with no database in it.
 *
 * `mikro-orm.config.ts` computed this inline and nothing else could read it,
 * because reading it meant importing that config, and **the config captures
 * `DATABASE_URL` at import**: whichever database that variable names when the
 * first import happens is the one the process migrates for the rest of its
 * life. The test harness needs the order *before* it knows which database this
 * run will migrate — issue #289 keys the migration template on it — so the
 * ordering lives here, where it depends on the registry and the manifests and
 * on nothing about a connection.
 *
 * ## Why it is a function, and an `async` one (feature 080, T033 / D-155.4)
 *
 * An installed extension package may ship migrations (D-106.2), and which
 * packages an instance installed is a fact about *the process*, not about the
 * tree — so the committed registries stay bare core and the package half is
 * discovered at runtime (D-119, confirmed as D-155). Discovery reads
 * `node_modules` and dynamically `import()`s each package's `./migrations`
 * export, so the merged order can only be a promise.
 *
 * It is an **async factory rather than a promise-valued export**, and the
 * difference is the defect this file was extracted to escape, one axis over: a
 * promise created at import starts that `node_modules` scan in *every* process
 * that touches this module — including one that only wanted `RegisteredMigration`
 * as a type — and turns a discovery failure into an unhandled rejection in any
 * process that imports without awaiting. A factory does nothing until somebody
 * asks.
 *
 * The result is memoised for the process, because an instance's `node_modules`
 * does not change while the platform runs and there are fourteen direct
 * importers of the ORM config; fourteen call sites must not mean fourteen
 * scans. {@link configuredMigrationsFrom} is the same merge with no discovery
 * in it, for a caller that brings its own inputs.
 *
 * `orderMigrations` throws on a duplicate name, a duplicate per-module
 * timestamp, an unscoped class name or an unknown module id — a loud,
 * actionable failure by design, now raised on the first call rather than at
 * import. A dependency *cycle* is a diagnostic instead, and reacting to it
 * belongs to the readers: see the comment on the warning loop in
 * `mikro-orm.config.ts`.
 */

/** A migration this platform runs, and which producer contributed it. */
export interface RegisteredMigration {
  /** The class name — what `mikro_orm_migrations` records. */
  readonly name: string;
  readonly origin: MigrationOrigin;
}

/**
 * Re-exported, declared in `@endora-commerce/platform`.
 *
 * The orchestrator is the one caller that *asks* the question, and it lives in
 * the platform, which may not name a file this application owns (D-52/D-53).
 * So the shape is declared there and the **answer** — the merge of the
 * committed core registry with whatever packages this instance installed — is
 * built here, where the discovery is. One name for it either way.
 */
export type { MigrationOwnership } from '../lifecycle/services/migration-ownership.js';
import type { MigrationOwnership } from '../lifecycle/services/migration-ownership.js';

/** The result of merging every producer's migrations into one execution order. */
export interface ConfiguredMigrations {
  /** Assigned verbatim to `migrations.migrationsList`. */
  readonly migrations: MigrationObject[];
  /** The ordered set with each entry's origin. */
  readonly registered: readonly RegisteredMigration[];
  /** The class names, in execution order — what a migrated database records. */
  readonly names: readonly string[];
  readonly diagnostics: readonly MigrationOrderDiagnostic[];
  /** Who owns what, for the lifecycle orchestrator's uninstall-revert. */
  readonly ownership: MigrationOwnership;
  /** The installed packages this order was merged from. Empty for bare core. */
  readonly packages: readonly PackageSchemaContribution[];
}

/**
 * The cross-cutting pseudo-module owning the platform's own migrations.
 *
 * Exported because three programs outside this file need the same literal — the
 * scaffolder, the registry round-trip and the instance-order guard — and a
 * second spelling of a module id is a second answer waiting to disagree.
 */
export const CORE_MODULE_ID = 'core';

/**
 * The committed core artefacts, **received** rather than imported
 * (`specs/110-instance-repository/` R7.4, FR-014).
 *
 * `migrations-registry.generated.ts` and `manifest-index.generated.ts` are
 * facts about *one repository's tree*, are host-owned (D-160.3, D-104) and stay
 * bare core under every value of `DEPLOYMENT` — so the platform may not name
 * either (D-52/D-53). `backend/src/db/configured-migrations.ts` is the binding
 * that supplies them, and an instance writes the same two lines against its own
 * artefacts.
 */
export interface CoreMigrationSources {
  /** The committed migration registry — `MIGRATION_REGISTRY` in this tree. */
  readonly coreEntries: readonly MigrationRegistryEntry[];
  /**
   * The generated manifest index this build ships — `DISCOVERED_MANIFESTS`.
   *
   * Declared structurally in `../lifecycle/manifest-registry.ts` for the reason
   * given there: `tsc` holds the generated shape and this one together at the
   * binding's call site.
   */
  readonly manifests: readonly DiscoveredManifestEntry[];
}

/**
 * Build an ownership answer over an explicit registry and an explicit set of
 * modules that registry is authoritative for.
 *
 * The covered set is **not** derived from the entries: a module that ships no
 * migration is covered and owns none, and those are the two answers that must
 * not be confused. It comes from the manifests the registry was built
 * alongside, which is the only thing that knows a module exists at all.
 */
export function migrationOwnershipOf(
  entries: readonly MigrationRegistryEntry[],
  coveredModuleIds: Iterable<string>,
): MigrationOwnership {
  const covered = new Set(coveredModuleIds);
  const byModule = new Map<string, string[]>();
  for (const entry of entries) {
    const names = byModule.get(entry.moduleId);
    if (names) names.push(entry.cls.name);
    else byModule.set(entry.moduleId, [entry.cls.name]);
  }
  for (const names of byModule.values()) names.sort();
  return {
    coveredModuleIds: covered,
    migrationNamesFor(moduleId: string): readonly string[] | null {
      if (!covered.has(moduleId)) return null;
      return byModule.get(moduleId) ?? [];
    },
  };
}

/** Every module id the committed core artefacts answer for, plus `core` itself. */
function coreModuleIds(manifests: readonly DiscoveredManifestEntry[]): string[] {
  return [CORE_MODULE_ID, ...manifests.map((entry) => entry.id)];
}

/**
 * Ownership over the **committed core registry alone** — no discovery, no
 * `node_modules`, nothing async.
 *
 * This is what a caller that never merged a package gets, and it is a
 * declaration rather than a fallback: it says *"I was given the core registry,
 * so I answer for core modules and for nothing else"*. Handed a package's
 * module id it returns `null`, which the orchestrator refuses on — the right
 * answer, because a core-only registry genuinely cannot enumerate a package's
 * chain and reverting nothing would leave the package's table behind.
 */
export function committedMigrationOwnership(sources: CoreMigrationSources): MigrationOwnership {
  return migrationOwnershipOf(sources.coreEntries, coreModuleIds(sources.manifests));
}

/**
 * Merge one producer set into an execution order — the whole computation, with
 * no discovery in it.
 *
 * Exported so a test can drive the merge over inputs it built itself, and so
 * the discovery path below has nothing of its own to get wrong.
 */
export function configuredMigrationsFrom(inputs: {
  readonly coreEntries: readonly MigrationRegistryEntry[];
  readonly coreModuleDependencies: ReadonlyMap<string, readonly string[]>;
  readonly packages: readonly PackageSchemaContribution[];
  /**
   * The frozen historical prefix, by identity. Defaults to the list
   * `@endora-commerce/platform` publishes, which is what every real composition
   * uses.
   *
   * It is a parameter for the reason the two inputs above are: so a guard can
   * drive the real merge over a baseline it built itself.
   * `test/unit/db/instance-migration-order.test.ts` computes the *unrepaired*
   * membership predicate as a list and orders the same corpus with it, which is
   * how the defect this feature closed stays measurable after the repair
   * instead of becoming a sentence in a doc block.
   */
  readonly baseline?: readonly string[];
}): ConfiguredMigrations {
  const entries: MigrationRegistryEntry[] = [
    ...inputs.coreEntries,
    ...inputs.packages.flatMap((contribution) => contribution.migrations),
  ];
  const moduleDependencies = new Map(inputs.coreModuleDependencies);
  // A package's own module is a node in the graph like any other, so its chain
  // lands at its topological position. Its `dependencies` are read from the
  // manifest the package published; an id already in the map is a collision
  // `assertNoPackageModuleIdCollisions` refused before anything got here.
  for (const contribution of inputs.packages) {
    if (!moduleDependencies.has(contribution.id)) moduleDependencies.set(contribution.id, []);
  }

  const ordered = orderMigrations({
    entries,
    moduleDependencies,
    baseline: inputs.baseline ?? BASELINE_MIGRATIONS,
  });

  const registryByName = new Map(entries.map((entry) => [entry.cls.name, entry] as const));
  const registered: RegisteredMigration[] = ordered.migrations.map((migration) => {
    const entry = registryByName.get(migration.name);
    if (entry === undefined) {
      throw new Error(
        `[configured-migrations] "${migration.name}" is in the migration order but not in the ` +
          `registry that order was computed from, so nothing here can say which producer it ` +
          `came from. Whoever merges a second producer's migrations into this order must merge ` +
          `their registry entries too — the test harness floors its template digest per origin.`,
      );
    }
    return { name: migration.name, origin: entry.origin ?? 'core' };
  });

  return {
    migrations: ordered.migrations,
    registered,
    names: registered.map((migration) => migration.name),
    diagnostics: ordered.diagnostics,
    ownership: migrationOwnershipOf(entries, [
      ...inputs.coreModuleDependencies.keys(),
      ...inputs.packages.map((contribution) => contribution.id),
    ]),
    packages: inputs.packages,
  };
}

/**
 * The committed core dependency map: `core`, plus every manifest the index
 * holds.
 *
 * This is **the** derivation of the migration ordering graph — the one
 * expression in this platform that turns manifests into the edges
 * `orderMigrations` walks. D-44 §8 singles it out as the site most likely to be
 * broken by a well-meaning later edit, because unioning `nonBindingDependencies`
 * or `acknowledgedDependencies` into it is a two-word change that no type would
 * catch and that buys a cross-module foreign key whose ordering claim lives in
 * an array `fk-dependency-drift.test.ts` does not read.
 *
 * It is exported for the same reason {@link configuredMigrationsFrom} is: so a
 * guard can drive the real derivation instead of reading its source text.
 * `test/contract/_lifecycle/non-binding-dependencies.contract.test.ts` calls it
 * over the live manifests and holds every entry to `manifest.dependencies`
 * exactly, and traces the one `orderMigrations` call back to it through
 * {@link discoverConfiguredMigrations}.
 *
 * That trace, and not a rule about callers, is what refuses a second ordering
 * graph. This sentence used to read *"nothing in `src` calls it but
 * {@link discoverConfiguredMigrations} — a second caller would be a second
 * ordering graph"*, and it was already false when it was written: the host binds
 * this function a second time so that its own tests can drive it over the
 * generated index, and a second **caller** is neither necessary nor sufficient
 * for a second **graph**. What the guard counts is calls of `orderMigrations`;
 * what it follows is the input of the one call there may be.
 */
export function committedModuleDependencies(
  manifests: readonly DiscoveredManifestEntry[],
): Map<string, readonly string[]> {
  return new Map<string, readonly string[]>([
    [CORE_MODULE_ID, []],
    ...manifests.map((entry) => [entry.id, entry.manifest.dependencies ?? []] as const),
  ]);
}

/**
 * This platform's migration order: the committed core registry the host
 * supplies, merged with every installed package's `./migrations` export.
 *
 * `env` selects the `node_modules` roots (`ENDORA_INSTANCE_ROOT`). Memoisation
 * is the binding's, not this file's: how many times one process may ask is a
 * fact about that process, and a memo here would answer a second host's
 * registry with the first one's order.
 */
export async function discoverConfiguredMigrations(
  sources: CoreMigrationSources,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ConfiguredMigrations> {
  return configuredMigrationsFrom({
    coreEntries: sources.coreEntries,
    coreModuleDependencies: committedModuleDependencies(sources.manifests),
    packages: await discoverPackageSchema(env),
  });
}
