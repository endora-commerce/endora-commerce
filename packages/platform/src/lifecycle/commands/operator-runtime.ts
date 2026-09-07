import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { RegisteredManifestEntry } from '../manifest-registry.js';
import type { LoadedManifestRegistry } from '../services/manifest-loader.js';
import type { MigrationOwnership } from '../services/migration-ownership.js';
import { ModuleLifecycleOrchestrator } from '../services/orchestrator.js';

/**
 * The seam the five `module:*` command bodies take
 * (`specs/115-lifecycle-container-move/`, D115-1;
 * `contracts/operator-half.md` §2).
 *
 * Of the 827 lines those five scripts held, exactly three things were the
 * host's: the ORM handle, the Redis connection string and the migration
 * ownership map. Everything else — the argv grammar, the exit-code table, the
 * orchestrator wiring and every sentence an operator reads — is platform logic
 * that shipped to nobody, because it lived in `backend/src`, which under D-207
 * a client never receives. This interface is the line between the two: the five
 * bodies live here and take it; five ~20-line entry points stay at their
 * application paths and build it.
 *
 * **R2.1 — there is no container in it, and that is the whole design.** No
 * awilix container, no `composeApp`, no `contextFor`. A command that cannot
 * reach a composition cannot run one, so D-157.2/.4's failure —
 * `reconcileExistingModules` inserting `state='installed'` for every shipped
 * manifest, whereupon `module:install X` returns `already-installed` at exit 0
 * with no migration applied and no install hook run — is structurally
 * unreachable rather than remembered. A task that adds a container field here
 * has broken the contract, whatever it needed one for.
 *
 * **R2.2 — {@link OperatorRuntime.entries} is a value, not a thunk.** The five
 * commands need the *instance-resolved* set (D-157.6a): core, this deployment's
 * overlay modules and every installed Endora module package. Resolving it is
 * asynchronous, reads `node_modules` and may raise the module-id collision
 * refusal — so the entry point resolves it and maps that refusal to its own
 * exit code, which is what puts the refusal where an operator can read it and
 * keeps the body pure with respect to discovery.
 *
 * **R2.4 — output goes through {@link OperatorRuntime.out} and
 * {@link OperatorRuntime.err}, never `process.stdout`.** That is what makes a
 * body testable without a process and what lets an instance frame the output.
 * The entry points pass `(line) => process.stdout.write(line)`.
 */
export interface OperatorRuntime {
  readonly orm: MikroORM;
  readonly em: () => EntityManager;
  readonly redis: Redis;
  /** The instance-resolved manifest set: core ∪ this deployment's overlay ∪ installed packages. */
  readonly entries: readonly RegisteredManifestEntry[];
  /** `uninstall` only — the migration ownership map, read from the host's generated registry. */
  readonly migrationOwnership?: () => Promise<MigrationOwnership>;
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

/**
 * The orchestrator every command builds, over the registry it built first.
 *
 * The registry is the caller's argument rather than this function's own build,
 * because three of the five commands answer out of it *before* they touch the
 * database — `install --dry-run` prints a plan, `install` refuses an unknown
 * id, `status` filters rows — and a helper that hid the build would make those
 * paths reach for an orchestrator they do not need.
 *
 * The entries go into that build **whole** (feature 080, T036a): the per-field
 * re-map that used to sit between `resolvedManifestEntries()` and
 * `buildStaticRegistry` was one identity function copied seven times, and the
 * field it would have dropped is the lifecycle participant — the reconcile that
 * keeps `translation_bundles` and `module_actions` aligned with the manifest
 * set. `RegisteredManifestEntry` and `StaticRegistryEntry` are structurally
 * compatible on purpose, so there is nothing to copy.
 */
export function orchestratorFor(
  rt: OperatorRuntime,
  registry: LoadedManifestRegistry,
  extra: { readonly migrationOwnership?: MigrationOwnership } = {},
): ModuleLifecycleOrchestrator {
  return new ModuleLifecycleOrchestrator({
    orm: rt.orm,
    redis: rt.redis,
    em: rt.em,
    auditLog: new AuditLogService(rt.em),
    registry,
    ...(extra.migrationOwnership ? { migrationOwnership: extra.migrationOwnership } : {}),
  });
}
