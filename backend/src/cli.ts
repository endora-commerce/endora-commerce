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
import {
  DEMO_HOST_COMMANDS,
  demoEntriesFrom,
  demoHelpFor,
  formatHostCommandList,
  isDemoInvocation,
  parseDemoVerb,
} from './cli/demo-command.js';
import type { EntityManager } from '@mikro-orm/postgresql';
import { composeApp } from './composition.js';
import { deploymentRoot } from './overlay/overlay-roots.js';
import { ModuleDisabledError } from './kernel/lifecycle/plugin-helpers.js';
import { effectiveState } from './kernel/lifecycle/effective-state.js';
import { resolvedManifestEntries } from './lifecycle/registered-manifests.js';
import { enterSystemScope } from './kernel/scope.js';
import {
  DEMO_RESET_SCOPE_REASON,
  DEMO_SEED_SCOPE_REASON,
  formatDemoReport,
  mustBeNonProduction,
  runDemo,
  unwrapDemoFailure,
} from './demo/index.js';
import { loadDemoComposition } from './demo/composition-loader.js';
import {
  resetHostModuleResidue,
  seedHostModuleResidue,
} from './seeds/demo-host-residue.js';

const USAGE = `usage: endora <module id> <command> [args…]
       endora <module id> <command> --help
       endora demo seed | endora demo reset
       endora --list

Runs an operator command a module declares in its \`manifest.ts\`. The host
composes the platform once and hands the command its module's own context, so
it resolves the same services — and the same deployment decorations — the
running server does.

\`demo\` is the host's own command rather than any module's: it fans out over
every module that declares demo data in its manifest, in the order the
dependency graph gives, and then applies this instance's composition.

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
/**
 * `endora demo seed` / `endora demo reset` (feature 113 Phase 0, §3.3–§3.4).
 *
 * The order of the first three statements **is** the contract, and nothing else
 * in this file has this property:
 *
 *  1. **The guard, first** — before anything is composed, before a scope is
 *     opened, and outside every `try` (§3.3). A refusal here writes nothing,
 *     which is the whole of FR-012, and it cannot be reached through a `catch`
 *     that decided to continue because there is no `catch` above it.
 *  2. **One composition**, exactly as a module-declared command gets, so a demo
 *     body resolves the same services — and the same deployment decorations —
 *     the running server does.
 *  3. **One system scope for the whole run** (§3.4), so no module's demo body is
 *     its own entry point. That is stricter than `seed:dev`, which is a declared
 *     program in `check:entry-scope`'s population and has to remember
 *     `enterSystemScope` itself.
 *
 * Presence is decided inside `runDemo`, from the declaration and before a
 * context is built (§3.5) — the rule `runModuleCommand` already applies one
 * command at a time, applied here once per declaring module.
 *
 * There is no composition passed yet: Phase 1 replaces `dev-catalog-seed.ts`
 * with one and hands it in here. Until then the run is every declaring module
 * and nothing else, which over zero declaring modules is the state Phase 0 is
 * measured against — it completes and says so.
 */
/**
 * Run the host's own demo residue, and say what it did (feature 113, T213).
 *
 * `demo-host-residue.ts` holds the demo rows whose modules have not taken them
 * back yet. It is not a module and it declares no `demo` manifest field, so
 * `runDemo` cannot reach it — it is run here instead, in a module's place: on
 * the way in before the composition is applied, on the way out after it is
 * withdrawn. Both are `runDemo`'s own order for a module (§5.5), applied to the
 * one pile that is not one.
 *
 * It reports as a line rather than as a module outcome, deliberately: a
 * `DemoModuleOutcome` for a fictitious module would put a name in the report
 * that no manifest carries, and an operator reading `demo-host-residue —
 * seeded` would go looking for a module by that name.
 */
async function hostResidue(verb: 'seed' | 'reset', em: EntityManager): Promise<string> {
  if (verb === 'reset') {
    await resetHostModuleResidue(em);
    return "\nThis instance's remaining host-held demo rows were withdrawn.\n";
  }
  const summary = await seedHostModuleResidue(em);
  return (
    `\nHost-held demo rows (not yet owned by their modules): ` +
    `${summary.products} products in ${summary.categoryNodes} category nodes, ` +
    `plus the identities, methods and warehouses the shop needs.\n`
  );
}

async function runDemoCommand(
  verb: 'seed' | 'reset',
  resolved: Awaited<ReturnType<typeof resolvedManifestEntries>>,
): Promise<number> {
  mustBeNonProduction();

  const entries = demoEntriesFrom(resolved);

  process.env['BACKEND_ROLE'] = 'api';
  const composition = await composeApp({ deploymentRoot: deploymentRoot() });
  try {
    return await enterSystemScope(
      verb === 'seed' ? DEMO_SEED_SCOPE_REASON : DEMO_RESET_SCOPE_REASON,
      async () => {
        // Feature 113 T212 — the parameter Phase 0 left unsupplied. The
        // EntityManager is forked **inside** the scope, so the composition's
        // reads carry the same system scope every module's body does, and the
        // presence oracle handed to it is the composed platform's own: a
        // composition step over a switched-off module is a reported skip
        // (§5.4), decided from the conjunction of both axes and never
        // re-derived.
        const em = composition.orm.em.fork();
        const found = await loadDemoComposition({
          em,
          isPresent: (id) => effectiveState.isPresent(id),
        });
        // Feature 113 T213 — the **host residue**: the demo rows that have not
        // reached their own modules yet. It runs exactly where a module's own
        // body runs, which is what keeps this command and `seed:dev` producing
        // one shop while Phase 2 drains it: before the composition is applied
        // on the way in, after it is withdrawn on the way out (§5.5). It
        // shrinks batch by batch and the calls go with the last block.
        const residue = await hostResidue(verb, em);
        const result = await runDemo({
          mode: verb,
          entries,
          isPresent: (id) => effectiveState.isPresent(id),
          contextFor: composition.contextFor,
          ...(found.found ? { composition: found.composition } : {}),
        });
        process.stdout.write(formatDemoReport(result));
        process.stdout.write(residue);
        // §5.6, once and enumerating nothing.
        if (!found.found) process.stdout.write(`\n${found.notice}\n`);
        return 0;
      },
      { entryPoint: 'cli', container: composition.container },
    );
  } finally {
    await composition.dispose();
  }
}

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
  const resolved = await resolvedManifestEntries();
  const declared = collectModuleCommands(resolved);
  if (argv[0] === '--list') {
    process.stdout.write(formatHostCommandList(DEMO_HOST_COMMANDS));
    process.stdout.write(formatCommandList(declared));
    return 0;
  }
  const [moduleId, name, ...rest] = argv;
  if (isDemoInvocation(moduleId)) {
    if (name === undefined || name === '--help' || name === '-h') {
      process.stdout.write(DEMO_HOST_COMMANDS.map((c) => `${c.address} — ${c.summary}`).join('\n'));
      process.stdout.write('\n');
      return name === undefined ? 1 : 0;
    }
    const verb = parseDemoVerb(name);
    if (rest.includes('--help') || rest.includes('-h')) {
      process.stdout.write(demoHelpFor(verb));
      return 0;
    }
    return await runDemoCommand(verb, resolved);
  }
  if (moduleId === undefined || name === undefined) {
    process.stderr.write(`${USAGE}\nerror: a command is addressed as '<module id> <command>'.\n`);
    return 1;
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    process.stdout.write(`${helpFor(findModuleCommand(declared, moduleId, name))}\n`);
    return 0;
  }

  process.env['BACKEND_ROLE'] = 'api';
  const composition = await composeApp({ deploymentRoot: deploymentRoot() });

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
  .catch((thrown: unknown) => {
    // `unwrapDemoFailure` is not a `catch` and decides nothing: it takes one
    // known wrapper off so the discrimination below sees what it saw before the
    // demo layer existed. `DemoRunFailedError`'s own message — which names the
    // module — is printed by the fallback branch.
    const err = unwrapDemoFailure(thrown);
    if (err instanceof ModuleDisabledError) {
      process.stderr.write(
        `error: module '${err.moduleId}' is switched off in this instance, so its commands ` +
          `do not run. Switch it on under Platform → Modules, or check that it is installed ` +
          `here (\`pnpm --filter backend run module:status\`).\n`,
      );
      process.exit(3);
    }
    process.stderr.write(
      `${thrown instanceof Error ? (thrown.stack ?? thrown.message) : String(thrown)}\n`,
    );
    process.exit(1);
  });
