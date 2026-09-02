/**
 * `endora` — the host binary that runs a module's declared commands
 * (feature 080, T042b / D-160.9, D-157.8).
 *
 * ## What changed, and why the invocation inverted
 *
 * A module's operator command used to be a script that bootstrapped the host:
 * it called `initOrm()`, hand-built the services it needed and exited. Three
 * things were wrong with that, and only the first is a matter of taste.
 *
 *  1. A hand-built service is not the composition's service, so a **deployment
 *     decoration** over it never reached the command — a client not getting an
 *     override they paid for. The cart abandonment sweep said so in writing,
 *     under a heading of its own reading *"What it still does not do"*; its
 *     body is now `modules/carts/cli/abandonment-sweep.ts`.
 *  2. A script with no container has nothing to resolve another module's port
 *     from, so it imported that module's service class instead. Seven of the
 *     eighteen draining `check:module-boundary` keys were this one shape.
 *  3. A **package** cannot do it at all. A file under `node_modules` can name
 *     no specifier that resolves to this instance's `src/composition.ts`, and a
 *     core script that names it is a module → root → module cycle.
 *
 * So the host composes once and calls the module, which is exactly how install
 * hooks already work (D-46) and one-to-one with Magento 2's
 * `CommandListInterface` — a module ships the command, `bin/magento` bootstraps
 * the application and constructs it with its dependencies injected. One shape
 * covers core, an overlay module and an installed package, because all three
 * arrive as entries of the same resolved manifest set.
 *
 * ## Usage
 *
 *   pnpm --filter backend run cli -- --list
 *   pnpm --filter backend run cli -- <module id> <command> [args…]
 *
 * The named aliases in `backend/package.json` — `search:reindex`,
 * `admin:create`, `i18n:reload` and the rest — are thin wrappers over this, so
 * no operator's muscle memory and no runbook changes.
 *
 * ## What this is not
 *
 * It is not the path a `module:*` command takes, and must never become one.
 * `module:install|uninstall|enable|disable|status` operate **on** the platform
 * rather than with it, and composing runs `reconcileExistingModules`, which
 * inserts `state='installed'` for every shipped manifest with no row — so a
 * composing `module:install X` would find `X` already installed and return
 * `already-installed`, applying no migration and running no install hook, at
 * exit code 0 (D-157.2/.4). Those five stay hand-built scripts.
 */
import {
  collectModuleCommands,
  findModuleCommand,
  formatCommandList,
  helpFor,
  runModuleCommand,
} from './cli/module-commands.js';
import { composeApp } from './composition.js';
import { ModuleDisabledError } from './kernel/lifecycle/plugin-helpers.js';
import { resolvedManifestEntries } from './lifecycle/registered-manifests.js';
import { enterSystemScope } from './kernel/scope.js';

const USAGE = `usage: endora <module id> <command> [args…]
       endora <module id> <command> --help
       endora --list

Runs an operator command a module declares in its \`manifest.ts\`. The host
composes the platform once and hands the command its module's own context, so
it resolves the same services — and the same deployment decorations — the
running server does.

  --list        every command this instance offers, including an overlay
                module's and an installed package's
`;

/**
 * Composition preconditions become CLI preconditions, deliberately (D-157.3d):
 * `assertPublicApiBaseUrlConfigured()` and a reachable PostgreSQL are now
 * required for every command. That is the property being bought — a command
 * that runs on the deployment's own graph needs the deployment's environment —
 * rather than a cost to be worked around.
 *
 * One line suppresses the single Redis write a composition performs:
 * `product_feeds`' boot hook re-asserts its BullMQ Job Schedulers when
 * `runWorkers` is true, and `runWorkers` is `BACKEND_ROLE !== 'api'`. Nothing
 * else in a composition issues a Redis command, and `registryCache.watch()` is
 * not reached, so this keeps Redis off a one-shot command's critical path.
 *
 * What composing does **not** do, contrary to a belief three shard comments
 * recorded: it starts no BullMQ worker and arms no timer. All three
 * `ctx.worker(` call sites and both module timers sit inside `ctx.routes(…)`
 * bodies that run only at Fastify registration, and this process never builds a
 * server (D-157.2, measured three ways).
 */
async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    process.stdout.write(USAGE);
    return argv.length === 0 ? 1 : 0;
  }

  // The two **declaration-level** questions, answered before anything is
  // opened. `resolvedManifestEntries()` reads manifests — core, this
  // deployment's overlay modules and every installed package — and touches no
  // database, which is the property D-102 attached as a condition to
  // `audit_logs read`: its credential is host access, not a working connection
  // string, so it has to be able to say what it does before it can do it. It is
  // also the property D-157.8 rejected path-convention dispatch for, since
  // nothing can list a convention.
  const declared = collectModuleCommands(await resolvedManifestEntries());
  if (argv[0] === '--list') {
    process.stdout.write(formatCommandList(declared));
    return 0;
  }
  const [moduleId, name, ...rest] = argv;
  if (moduleId === undefined || name === undefined) {
    process.stderr.write(`${USAGE}\nerror: a command is addressed as '<module id> <command>'.\n`);
    return 1;
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    process.stdout.write(`${helpFor(findModuleCommand(declared, moduleId, name))}\n`);
    return 0;
  }

  process.env['BACKEND_ROLE'] = 'api';
  const composition = await composeApp();

  try {
    // The scope opens over **this composition's** container. `composeApp`
    // deliberately never calls `setRootContainer`, so a scope with no
    // `container` would branch off a process-wide root with nothing in it and
    // every `ctx.cradle()` read inside a command would fail to resolve
    // (D-157.7). `composeApp` itself runs above this line and opens its own
    // scopes for each step that touches the database, which is exactly what
    // `index.ts` and `worker.ts` do.
    return await enterSystemScope(
      `cli: ${argv.join(' ')}`,
      async () =>
        // The set the composition was **actually built from**, not the one read
        // above: `contextFor` answers for exactly those ids, so reading the
        // command off the same array is what makes "found a command" and "can
        // build its context" one question rather than two.
        runModuleCommand({
          entries: composition.resolvedModules,
          moduleId,
          name,
          argv: rest,
          contextFor: composition.contextFor,
          out: (line) => process.stdout.write(`${line}\n`),
          err: (line) => process.stderr.write(`${line}\n`),
        }),
      { entryPoint: 'cli', container: composition.container },
    );
  } finally {
    // Every command shares one disposal, which is the other thing a per-script
    // entry point kept getting wrong: `closeOrm()` in a `finally` around a
    // `return promise` tore the pool down under the query it was still running.
    await composition.dispose();
  }
}

// No `try`/`catch` anywhere above a command's body, and this is why: a `catch`
// around a port call swallows `ModuleDisabledError` and turns fail-closed into
// fail-open, which is what `check:port-catches` refuses. A `.catch()` **method**
// on the entry promise is outside that check's population by construction
// (D-157.3), and it is the right place for a CLI to turn a throw into an exit
// code.
//
// The one discrimination below is not a conditional re-throw: both branches
// exit non-zero and neither lets the command's work proceed. It exists because
// a stack trace is the wrong answer to "this module is switched off" — the
// operator needs the sentence and the module id, which the error already
// carries.
//
// The scope this file's top-level execution establishes is the one `main` opens
// over the composed container, one hop down — which is where it has to be, since
// there is no container to open it against until `composeApp()` has returned.
void main()
  .then((code) => process.exit(code))
  .catch((err: unknown) => {
    if (err instanceof ModuleDisabledError) {
      process.stderr.write(
        `error: module '${err.moduleId}' is switched off in this instance, so its commands ` +
          `do not run. Switch it on under Platform → Modules, or check that it is installed ` +
          `here (\`pnpm --filter backend run module:status\`).\n`,
      );
      process.exit(3);
    }
    process.stderr.write(
      `${err instanceof Error ? (err.stack ?? err.message) : String(err)}\n`,
    );
    process.exit(1);
  });
