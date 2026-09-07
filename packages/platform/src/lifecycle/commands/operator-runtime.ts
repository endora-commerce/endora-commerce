import type { EntityManager, MikroORM } from '@mikro-orm/postgresql';
import type { Redis } from 'ioredis';
import { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import type { RegisteredManifestEntry } from '../manifest-registry.js';
import type { LoadedManifestRegistry } from '../services/manifest-loader.js';
import type { MigrationOwnership } from '../services/migration-ownership.js';
import { ModuleLifecycleOrchestrator } from '../services/orchestrator.js';

/**
 * The three things only the tree that installs the platform can build
 * (`specs/115-lifecycle-container-move/`, D115-6;
 * `contracts/operator-half.md` §2, R2.6).
 *
 * They are handed over as a group because they are opened as a group: an
 * invocation that needs one needs all three, and an invocation that needs none
 * opens none. `em` stays a *factory* rather than an `EntityManager` because
 * forking is the host's decision, taken under its own system scope.
 */
export interface OperatorResources {
  readonly orm: MikroORM;
  readonly em: () => EntityManager;
  readonly redis: Redis;
}

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
 *
 * **R2.6 — {@link OperatorRuntime.resources} is opened on first use** (D115-6).
 * The entry point cannot know whether an invocation needs a database without
 * parsing argv, and under D115-1 argv belongs to the body — so the choice is
 * not "eager or lazy" but which side owns the knowledge of which flags need a
 * connection, and a thunk keeps it with the grammar, where the grammar already
 * is. Three properties follow, and each is the rule rather than a side effect:
 * `specs/018-module-lifecycle/contracts/cli-commands.md` §C-1's own step order
 * (steps 1–2 load the manifests and resolve the id, and answer above step 3's
 * lock); `module:install --dry-run` without a database; and **exit 64 for
 * misuse on a machine whose database is not up** — which is the client instance
 * this interface exists for, and where an eagerly awaited `initOrm()` in an
 * entry point that wraps it in no `try` is an unhandled rejection and exit 1, a
 * code §C-1's table does not contain.
 *
 * **R2.7 — {@link OperatorRuntime.confirm} is a capability, not a read of
 * `process`** (D115-7). A decision that turns on whether a human can answer
 * takes it from the runtime. No file under `packages/platform/` reads
 * `process.stdout.isTTY`, `process.stdin` or `process.env` to decide an operator
 * question: reading a process global for a decision defeats R2.4's two reasons —
 * *testable without a process*, and *an instance may frame the output* — exactly
 * as writing to one does, and the predicate it would freeze here is the mirror
 * of the one `specs/117-instance-bring-up/contracts/input-resolution.md` R3.5
 * has already ruled insufficient.
 */
export interface OperatorRuntime {
  /**
   * The ORM handle, the `EntityManager` factory and the Redis connection,
   * opened on first use (R2.6). No command reaches this before its argv parse,
   * its registry build and its unknown-id refusal, so an invocation that
   * answers out of those alone opens nothing. The entry point memoises the
   * thunk and closes only what it opened.
   */
  readonly resources: () => Promise<OperatorResources>;
  /** The instance-resolved manifest set: core ∪ this deployment's overlay ∪ installed packages. */
  readonly entries: readonly RegisteredManifestEntry[];
  /** `uninstall` only — the migration ownership map, read from the host's generated registry. */
  readonly migrationOwnership?: () => Promise<MigrationOwnership>;
  /**
   * Ask the operator to confirm a destructive step. **Absent means this run
   * cannot ask** (R2.7), and the body refuses rather than proceeding; present
   * means the caller has judged that it can.
   */
  readonly confirm?: (question: string) => Promise<boolean>;
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
 * **This is the one place {@link OperatorResources} is reached** (R2.6), which
 * is what makes those three paths need no connection. The thunk is called at
 * the point in each body where the eager handle used to be read, so a body's
 * own error mapping and a resource failure land exactly where they landed
 * before: no call site moved to make this true, and in particular `status`
 * calls this *outside* its `try`, so a resource failure resolves the way the
 * entry point's `initOrm()` rejection did rather than being newly caught and
 * reported as exit 0.
 *
 * The entries go into that build **whole** (feature 080, T036a): the per-field
 * re-map that used to sit between `resolvedManifestEntries()` and
 * `buildStaticRegistry` was one identity function copied seven times, and the
 * field it would have dropped is the lifecycle participant — the reconcile that
 * keeps `translation_bundles` and `module_actions` aligned with the manifest
 * set. `RegisteredManifestEntry` and `StaticRegistryEntry` are structurally
 * compatible on purpose, so there is nothing to copy.
 */
export async function orchestratorFor(
  rt: OperatorRuntime,
  registry: LoadedManifestRegistry,
  extra: { readonly migrationOwnership?: MigrationOwnership } = {},
): Promise<ModuleLifecycleOrchestrator> {
  const resources = await rt.resources();
  return new ModuleLifecycleOrchestrator({
    orm: resources.orm,
    redis: resources.redis,
    em: resources.em,
    auditLog: new AuditLogService(resources.em),
    registry,
    ...(extra.migrationOwnership ? { migrationOwnership: extra.migrationOwnership } : {}),
  });
}
