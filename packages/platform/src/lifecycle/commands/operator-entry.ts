/**
 * The `module:*` entry point of a tree that ships no generated index — the
 * three things an instance's five command files used to spell out for
 * themselves (`contracts/operator-half.md` §2, R2.3/R2.6; R1.4).
 *
 * ## Why this is here and not rendered into a client's tree
 *
 * `operator-runtime.ts`' own header sets the target: *"five ~20-line entry
 * points stay at their application paths and build it"*. The instance's did not
 * come out at twenty. `endora new instance` rendered
 * `backend/src/module-commands/runtime.ts` at **90 lines** — the manifest
 * resolution over three suppliers, a memoised `MikroORM` + `Redis` open, a
 * system scope and an exit code — and that one file was more than a third of
 * R1.4's whole 250-line wiring budget. A14 of the instance acceptance
 * criterion measured 259 lines across fourteen files on pipeline 13835 and
 * refused the tree.
 *
 * Every line of those ninety names a platform symbol or a platform concern.
 * What the instance genuinely owns is **two** values — the directory that holds
 * `apps/`, and its own `mikro-orm.config.js` — so those are the parameters
 * here and nothing else is. R7.1 is the rule the shape follows: *"a client's
 * copy of it is a copy that diverges the first time we correct ours"*.
 *
 * ## It composes nothing, and that is R2.1 rather than an omission
 *
 * No container, no `composeApp`, no `contextFor`. The five bodies take an
 * {@link OperatorRuntime} and this builds one; a command that cannot reach a
 * composition cannot run one, which is what makes D-157.2/.4's failure
 * structurally unreachable rather than remembered. That is also why this file
 * sits under `lifecycle/` and not under `cli/`: `./cli` is the dispatcher for a
 * module-**declared** command, it composes, and its own barrel says in as many
 * words that it *"is also not the `module:*` path and must never become one"*.
 *
 * ## One derivation of the instance-resolved set, not three
 *
 * {@link instanceManifestEntries} is exported because `cli/dispatch.ts` needs
 * the same answer for `endora --list`, and it had its own copy of the same
 * three suppliers. Two spellings of *"core, this deployment's overlay modules
 * and every installed package"* are two answers waiting to disagree about what
 * an instance is composed of (D-100), and the disagreement would show up as a
 * module the terminal can enumerate and not enable, or the reverse — which is
 * D-157.6(a)'s own defect one axis over.
 */
import { MikroORM, type Options } from '@mikro-orm/postgresql';
import type { EntityManager } from '@mikro-orm/postgresql';
import { Redis } from 'ioredis';

import { enterSystemScope } from '../../kernel/scope.js';
import { activeOverlayModulesRoot } from '../../overlay/deployment-roots.js';
import { overlayModulesUnder } from '../../overlay/overlay-runtime.js';
import {
  discoverPackageModuleManifests,
  installedPackageModuleIdClaims,
} from '../../packages/package-runtime.js';
import { nodeModulesRootsFor } from '../../packages/installed-packages.js';
import { resolveManifestEntries, type RegisteredManifestEntry } from '../manifest-registry.js';
import type { OperatorResources, OperatorRuntime } from './operator-runtime.js';

/**
 * The declaration-level manifest set of a tree that ships no generated index:
 * **core empty**, this deployment's overlay modules, and every installed Endora
 * module package.
 *
 * Resolved before anything is opened, which is R2.2's reason rather than an
 * ordering preference: the resolution reads `node_modules` and may refuse a
 * module id claimed twice, and an operator reads that refusal without a
 * database being up.
 */
export async function instanceManifestEntries(
  deploymentRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): Promise<readonly RegisteredManifestEntry[]> {
  const overlayModules = overlayModulesUnder(activeOverlayModulesRoot(deploymentRoot, env), () =>
    installedPackageModuleIdClaims(nodeModulesRootsFor(env)),
  );
  return await resolveManifestEntries({
    core: [],
    overlay: () => overlayModules.manifests(),
    packages: () => discoverPackageModuleManifests(env),
  });
}

/** What an instance supplies, and it is two values plus the ambient environment. */
export interface InstanceOperatorRuntimeOptions {
  /**
   * The absolute path of the directory that holds `apps/` — the one thing no
   * package can derive for itself, for `composeApp`'s own reason.
   */
  readonly deploymentRoot: string;
  /**
   * The instance's own `mikro-orm.config.js` default export.
   *
   * A **function**, not a configuration object: the instance's own file reads
   * `DATABASE_URL` and enumerates its installed entities and migrations when it
   * is called, so calling it eagerly here would open that read on every
   * invocation — including the ones R2.6 exists to keep off a database.
   */
  readonly ormConfig: () => Promise<Options>;
  readonly env?: NodeJS.ProcessEnv;
  readonly out?: (line: string) => void;
  readonly err?: (line: string) => void;
}

/**
 * Build the one {@link OperatorRuntime} an instance's five `module:*` commands
 * share, and the `dispose` that closes only what was opened.
 *
 * `resources` is memoised and lazy (R2.6): an invocation that answers out of
 * argv or the resolved registry alone — `--dry-run`, an unknown id, `--help` —
 * opens neither PostgreSQL nor Redis, and `dispose` on such a run closes
 * nothing. Without the second half the five commands print their answer and
 * then hang forever on a live Redis handle.
 */
export async function instanceOperatorRuntime(
  options: InstanceOperatorRuntimeOptions,
): Promise<{ runtime: OperatorRuntime; dispose: () => Promise<void> }> {
  const env = options.env ?? process.env;
  const out = options.out ?? ((line: string) => void process.stdout.write(line));
  const err = options.err ?? ((line: string) => void process.stderr.write(line));
  const entries = await instanceManifestEntries(options.deploymentRoot, env);
  let opened: OperatorResources | undefined;
  return {
    runtime: {
      resources: async (): Promise<OperatorResources> => {
        if (opened) return opened;
        const orm = await MikroORM.init(await options.ormConfig());
        const redis = new Redis(env['REDIS_URL'] ?? 'redis://localhost:6379', {
          maxRetriesPerRequest: null,
        });
        opened = { orm, em: (): EntityManager => orm.em.fork(), redis };
        return opened;
      },
      entries,
      out,
      err,
    },
    dispose: async (): Promise<void> => {
      if (!opened) return;
      opened.redis.disconnect();
      await opened.orm.close(true);
    },
  };
}

/**
 * Build the runtime, run one command body inside a system scope, close, exit.
 *
 * The scope is opened around the body rather than around the build, for the
 * reason every other `entryPoint: 'cli'` caller opens one: a command's reads
 * and writes are the platform's own and carry no request tenant, so they run
 * under the system scope or they run under none.
 */
export async function runInstanceOperatorCommand(
  options: InstanceOperatorRuntimeOptions & {
    readonly run: (argv: readonly string[], rt: OperatorRuntime) => Promise<number>;
    readonly argv?: readonly string[];
  },
): Promise<never> {
  const { runtime, dispose } = await instanceOperatorRuntime(options);
  const argv = options.argv ?? process.argv.slice(2);
  const code = await enterSystemScope('cli: operator command', () => options.run(argv, runtime), {
    entryPoint: 'cli',
  });
  await dispose();
  process.exit(code);
}
