/**
 * The migration order's **binding** — two suppliers, and nothing else
 * (`specs/110-instance-repository/` T116; `contracts/instance-repository.md`
 * R7.4, FR-014).
 *
 * The whole computation is `@endora-commerce/platform/db`'s since T116: the
 * merge of the committed core registry with every installed package's
 * `./migrations` export, the ownership answer a hard uninstall reverts against,
 * the one derivation that turns manifests into the edges `orderMigrations`
 * walks, and the order itself.
 *
 * What is left here are its two inputs. `migrations-registry.generated.ts` and
 * `manifest-index.generated.ts` are facts about *this repository's tree*
 * (D-160.3), stay bare core under every value of `DEPLOYMENT` (D-104), and the
 * platform may not name either (D-52/D-53). An instance writes the same two
 * lines against its own artefacts.
 *
 * **The path and every exported name are kept deliberately.** The five
 * `module:*` scripts, the composition root, the test harness's template digest
 * and eight integration tests name them, and moving the file would be a rewrite
 * whose entire content is a path.
 *
 * **The memoisation is the binding's**, for `configured-entities.ts`' reason:
 * how many times one process may scan `node_modules` is a fact about that
 * process. It is an **async factory rather than a promise-valued export** — a
 * promise created at import starts that scan in every process that touches this
 * module, including one that only wanted `RegisteredMigration` as a type, and
 * turns a discovery failure into an unhandled rejection in any process that
 * imports without awaiting.
 *
 * `orderMigrations` throws on a duplicate name, a duplicate per-module
 * timestamp, an unscoped class name or an unknown module id — a loud,
 * actionable failure by design, raised on the first call rather than at import.
 * A dependency *cycle* is a diagnostic instead, and reacting to it belongs to
 * the readers: see the comment on the warning loop in the platform's
 * `mikro-orm.config.ts`.
 */
import {
  committedMigrationOwnership,
  committedModuleDependencies,
  discoverConfiguredMigrations,
  type ConfiguredMigrations,
  type CoreMigrationSources,
} from '@endora-commerce/platform/db';

import { DISCOVERED_MANIFESTS } from '../manifest-index.generated.js';
import { MIGRATION_REGISTRY } from './migrations-registry.generated.js';

/** Re-exported so a caller that already reads this seam has one import. */
export {
  configuredMigrationsFrom,
  migrationOwnershipOf,
  type ConfiguredMigrations,
  type MigrationOwnership,
  type RegisteredMigration,
} from '@endora-commerce/platform/db';

/** The two committed artefacts this build ships, as the platform's input. */
const CORE_SOURCES: CoreMigrationSources = {
  coreEntries: MIGRATION_REGISTRY,
  manifests: DISCOVERED_MANIFESTS,
};

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
export function coreMigrationOwnership(): ReturnType<typeof committedMigrationOwnership> {
  return committedMigrationOwnership(CORE_SOURCES);
}

/**
 * The committed core dependency map: `core`, plus every manifest the index
 * holds.
 *
 * The derivation is the platform's — D-44 §8 singles it out as the site most
 * likely to be broken by a well-meaning later edit, because unioning
 * `nonBindingDependencies` or `acknowledgedDependencies` into it is a two-word
 * change that no type would catch. It is bound here because its input is this
 * build's manifest index, and it stays exported for the reason it always was:
 * so `test/contract/_lifecycle/non-binding-dependencies.contract.test.ts` can
 * drive the real derivation over the live manifests instead of reading its
 * source text.
 */
export function coreModuleDependencies(): Map<string, readonly string[]> {
  return committedModuleDependencies(DISCOVERED_MANIFESTS);
}

let memoised: Promise<ConfiguredMigrations> | undefined;

/**
 * This platform's migration order: the committed core registry merged with
 * every installed package's `./migrations` export.
 *
 * Memoised for the process. `env` is read on the first call only — it selects
 * the `node_modules` roots (`ENDORA_INSTANCE_ROOT`), and an instance does not
 * move underneath a running platform.
 */
export async function configuredMigrations(
  env: NodeJS.ProcessEnv = process.env,
): Promise<ConfiguredMigrations> {
  memoised ??= discoverConfiguredMigrations(CORE_SOURCES, env);
  return memoised;
}
