/**
 * The operator CLI, whole: argv in, an exit code out
 * (`specs/123-oss-install-experience/` G2, T2-B).
 *
 * ## Why the process moved here, when `./cli`'s own header said it would not
 *
 * That header — and `HOST_INTERNAL_SUBPATHS`' entry beside it — said *"the
 * process around it — argv, the composition, the system scope and the exit code
 * — stays in the application at `backend/src/cli.ts`"*. It was written when this
 * repository was the only application there was, and it was measured wrong the
 * moment a second one existed: `endora new instance` reported
 * `backend/src/cli.ts` as an **omission**, so a scaffolded instance could run no
 * command its modules declared — no `admin_users create`, and therefore nobody
 * to log in to the admin bundle A5 and A13 prove is built and styled.
 *
 * The alternative was rendering ~170 lines of dispatch into a client's tree,
 * which is the copy `contracts/operator-half.md` R7.1 refuses in as many words:
 * *"a client's copy of it is a copy that diverges the first time we correct
 * ours"*. D-207 is the same rule from the other side — an instance takes the
 * platform as a dependency and receives none of the host's sources.
 *
 * **What is left in an application is genuinely the application's**, and it is
 * the four suppliers below rather than nothing: which manifests this build ships
 * as core, which composition it composes, where its own demo composition lives,
 * and the one directory holding `apps/`. This repository supplies all four; a
 * scaffolded instance supplies the last one and takes the defaults, which is why
 * its entry point is five lines.
 *
 * ## `./cli` is still host-internal, and this changes nothing about that
 *
 * D-160.14's third state is unmoved: `./cli` is declared by the `exports` map,
 * carried by no published barrel, and a **module** naming it is
 * `host-internal-subpath` — refused. The consumer here is an application's entry
 * point, which is not a module, and which already names `./composition`,
 * `./db`, `./lifecycle`, `./overlay`, `./packages` and `./kernel` in the six
 * wiring files `endora new instance` renders. No subpath is added and
 * `PUBLISHED_SUBPATHS` stays at five.
 */
import type { EntityManager } from '@mikro-orm/postgresql';

import type { KernelContainer } from '../kernel/container.js';
import { effectiveState } from '../kernel/lifecycle/effective-state.js';
import { ModuleDisabledError } from '../kernel/lifecycle/plugin-helpers.js';
import { enterSystemScope } from '../kernel/scope.js';
import {
  instanceManifestEntries,
  type RegisteredManifestEntry,
} from '../lifecycle/index.js';
import {
  DEMO_HOST_COMMANDS,
  NO_DEMO_COMPOSITION_NOTICE,
  demoEntriesFrom,
  demoHelpFor,
  formatHostCommandList,
  isDemoInvocation,
  parseDemoVerb,
  type DemoCompositionLoader,
} from '../demo/host-command.js';
import { formatDemoReport } from '../demo/report.js';
import { mustBeNonProduction } from '../demo/guard.js';
import { runDemo, unwrapDemoFailure } from '../demo/runner.js';
import { DEMO_RESET_SCOPE_REASON, DEMO_SEED_SCOPE_REASON } from '../demo/scope.js';

import {
  collectModuleCommands,
  findModuleCommand,
  formatCommandList,
  helpFor,
  runModuleCommand,
  type RunModuleCommandOptions,
} from './module-commands.js';

export const CLI_USAGE = `usage: endora <module id> <command> [args…]
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
 * The composed platform, as this file reads it.
 *
 * Structurally a `ComposeAppHandle` and deliberately *not* that type by name:
 * naming it would put a runtime edge from `./cli` to `./composition`, and the
 * whole of the composition graph would load for a `--list` that composes
 * nothing. The default supplier imports it dynamically, one function down.
 */
export interface CliComposition {
  readonly container: KernelContainer;
  readonly contextFor: RunModuleCommandOptions['contextFor'];
  readonly resolvedModules: readonly RegisteredManifestEntry[];
  readonly orm: { readonly em: { fork(): EntityManager } };
  dispose(): Promise<void>;
}

export interface RunCliOptions {
  /**
   * The absolute path of the directory that holds `apps/` — the one thing no
   * package can derive for itself, for `composeApp`'s own reason.
   */
  readonly deploymentRoot: string;
  /** Defaults to `process.argv.slice(2)`. */
  readonly argv?: readonly string[];
  /**
   * The manifest set, answered **before** anything is opened.
   *
   * `resolvedManifestEntries()` in this repository, because its core half is a
   * generated index this build ships. An instance ships none, so the default
   * below is the instance's answer: its overlay modules and every installed
   * package.
   */
  readonly resolveEntries?: () => Promise<readonly RegisteredManifestEntry[]>;
  /**
   * The composition. This repository's own `composeApp`, which carries its
   * generated composition; an instance takes `@endora-commerce/platform`'s.
   */
  readonly compose?: () => Promise<CliComposition>;
  /** Where this tree keeps its demo composition, if it has one (§5.6). */
  readonly demoComposition?: DemoCompositionLoader;
  readonly out?: (chunk: string) => void;
  readonly err?: (chunk: string) => void;
  readonly env?: NodeJS.ProcessEnv;
}

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
 *     its own entry point, and no module's body has to remember to open one.
 *
 * Presence is decided inside `runDemo`, from the declaration and before a
 * context is built (§3.5) — the rule `runModuleCommand` already applies one
 * command at a time, applied here once per declaring module.
 *
 * The composition is loaded from the calling tree and handed in (§5.2). A tree
 * that has none is an ordinary tree: every present module still seeds its own
 * rows and the notice below says so once (§5.6).
 */
async function runDemoCommand(
  verb: 'seed' | 'reset',
  resolved: readonly RegisteredManifestEntry[],
  compose: () => Promise<CliComposition>,
  loadComposition: DemoCompositionLoader | undefined,
  out: (chunk: string) => void,
): Promise<number> {
  mustBeNonProduction();

  const entries = demoEntriesFrom(resolved);

  const composition = await compose();
  try {
    return await enterSystemScope(
      verb === 'seed' ? DEMO_SEED_SCOPE_REASON : DEMO_RESET_SCOPE_REASON,
      async () => {
        // Feature 113 T212 — the EntityManager is forked **inside** the scope,
        // so the composition's reads carry the same system scope every module's
        // body does, and the presence oracle handed to it is the composed
        // platform's own: a composition step over a switched-off module is a
        // reported skip (§5.4), decided from the conjunction of both axes and
        // never re-derived.
        const em = composition.orm.em.fork();
        const found =
          loadComposition === undefined
            ? ({ found: false, notice: NO_DEMO_COMPOSITION_NOTICE } as const)
            : await loadComposition({
                em,
                isPresent: (id) => effectiveState.isPresent(id),
              });
        // Feature 113 T226 — there is no host residue left to run. Every demo
        // row this repository seeds is now either a module's own (its
        // `manifest.ts` declares it) or the composition's.
        const result = await runDemo({
          mode: verb,
          entries,
          isPresent: (id) => effectiveState.isPresent(id),
          contextFor: composition.contextFor,
          ...(found.found ? { composition: found.composition } : {}),
        });
        out(formatDemoReport(result));
        // §5.6, once and enumerating nothing.
        if (!found.found) out(`\n${found.notice}\n`);
        return 0;
      },
      { entryPoint: 'cli', container: composition.container },
    );
  } finally {
    await composition.dispose();
  }
}

/**
 * Composition preconditions become CLI preconditions, deliberately (D-157.3d):
 * `assertPublicApiBaseUrlConfigured()` and a reachable PostgreSQL are now
 * required for every command that composes. That is the property being bought —
 * a command that runs on the deployment's own graph needs the deployment's
 * environment — rather than a cost to be worked around.
 *
 * One line suppresses the single Redis write a composition performs:
 * `product_feeds`' boot hook re-asserts its BullMQ Job Schedulers when
 * `runWorkers` is true, and `runWorkers` is `BACKEND_ROLE !== 'api'`. Nothing
 * else in a composition issues a Redis command, and `registryCache.watch()` is
 * not reached, so this keeps Redis off a one-shot command's critical path.
 *
 * What composing does **not** do, contrary to a belief three shard comments
 * recorded: it starts no BullMQ worker and arms no timer (D-157.2, measured
 * three ways).
 */
async function defaultCompose(deploymentRoot: string): Promise<CliComposition> {
  process.env['BACKEND_ROLE'] = 'api';
  const { composeApp } = await import('../composition/compose-app.js');
  return (await composeApp({ deploymentRoot })) as unknown as CliComposition;
}

/**
 * Decide and run, and return the exit code. It opens no process concern of its
 * own, which is what lets a test drive it.
 */
export async function dispatchCli(options: RunCliOptions): Promise<number> {
  const argv = options.argv ?? process.argv.slice(2);
  const env = options.env ?? process.env;
  const out = options.out ?? ((chunk: string) => void process.stdout.write(chunk));
  const err = options.err ?? ((chunk: string) => void process.stderr.write(chunk));
  const compose = options.compose ?? (() => defaultCompose(options.deploymentRoot));

  if (argv.length === 0 || argv[0] === '--help' || argv[0] === '-h') {
    out(CLI_USAGE);
    return argv.length === 0 ? 1 : 0;
  }

  // The two **declaration-level** questions, answered before anything is
  // opened. Resolving manifests reads `node_modules` and touches no database,
  // which is the property D-102 attached as a condition to `audit_logs read`:
  // its credential is host access, not a working connection string, so it has to
  // be able to say what it does before it can do it. It is also the property
  // D-157.8 rejected path-convention dispatch for, since nothing can list a
  // convention.
  const resolved = await (options.resolveEntries ??
    (() => instanceManifestEntries(options.deploymentRoot, env)))();
  const declared = collectModuleCommands(resolved);
  if (argv[0] === '--list') {
    out(formatHostCommandList(DEMO_HOST_COMMANDS));
    out(formatCommandList(declared));
    return 0;
  }
  const [moduleId, name, ...rest] = argv;
  if (isDemoInvocation(moduleId)) {
    if (name === undefined || name === '--help' || name === '-h') {
      out(DEMO_HOST_COMMANDS.map((command) => `${command.address} — ${command.summary}`).join('\n'));
      out('\n');
      return name === undefined ? 1 : 0;
    }
    const verb = parseDemoVerb(name);
    if (rest.includes('--help') || rest.includes('-h')) {
      out(demoHelpFor(verb));
      return 0;
    }
    return await runDemoCommand(verb, resolved, compose, options.demoComposition, out);
  }
  if (moduleId === undefined || name === undefined) {
    err(`${CLI_USAGE}\nerror: a command is addressed as '<module id> <command>'.\n`);
    return 1;
  }
  if (rest.includes('--help') || rest.includes('-h')) {
    out(`${helpFor(findModuleCommand(declared, moduleId, name))}\n`);
    return 0;
  }

  const composition = await compose();

  try {
    // The scope opens over **this composition's** container. `composeApp`
    // deliberately never calls `setRootContainer`, so a scope with no
    // `container` would branch off a process-wide root with nothing in it and
    // every `ctx.cradle()` read inside a command would fail to resolve
    // (D-157.7).
    return await enterSystemScope(
      `cli: ${argv.join(' ')}`,
      async () =>
        // The set the composition was **actually built from**, not the one read
        // above: `contextFor` answers for exactly those ids, so reading the
        // command off the same array is what makes "found a command" and "can
        // build its context" one question rather than two.
        await runModuleCommand({
          entries: composition.resolvedModules,
          moduleId,
          name,
          argv: rest,
          contextFor: composition.contextFor,
          out: (line) => out(`${line}\n`),
          err: (line) => err(`${line}\n`),
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

/**
 * The exit code a thrown failure earns, with the sentence an operator reads.
 *
 * The one discrimination here is not a conditional re-throw: both branches exit
 * non-zero and neither lets the command's work proceed. It exists because a
 * stack trace is the wrong answer to "this module is switched off" — the
 * operator needs the sentence and the module id, which the error already
 * carries.
 */
export function cliFailureExitCode(thrown: unknown, err: (chunk: string) => void): number {
  // `unwrapDemoFailure` is not a `catch` and decides nothing: it takes one known
  // wrapper off so the discrimination below sees what it saw before the demo
  // layer existed. `DemoRunFailedError`'s own message — which names the module —
  // is printed by the fallback branch.
  const error = unwrapDemoFailure(thrown);
  if (error instanceof ModuleDisabledError) {
    err(
      `error: module '${error.moduleId}' is switched off in this instance, so its commands ` +
        `do not run. Switch it on under Platform → Modules, or check that it is installed ` +
        `here (\`module:status\`).\n`,
    );
    return 3;
  }
  err(`${thrown instanceof Error ? (thrown.stack ?? thrown.message) : String(thrown)}\n`);
  return 1;
}

/**
 * The whole of an operator CLI entry point: dispatch, then exit.
 *
 * No `try`/`catch` anywhere above a command's body, and this is why: a `catch`
 * around a port call swallows `ModuleDisabledError` and turns fail-closed into
 * fail-open, which is what `check:port-catches` refuses. A `.catch()` **method**
 * on the entry promise is outside that check's population by construction
 * (D-157.3), and it is the right place for a CLI to turn a throw into an exit
 * code.
 */
export function runCli(options: RunCliOptions): Promise<never> {
  const err = options.err ?? ((chunk: string) => void process.stderr.write(chunk));
  return dispatchCli(options)
    .then((code) => process.exit(code))
    .catch((thrown: unknown) => process.exit(cliFailureExitCode(thrown, err)));
}
