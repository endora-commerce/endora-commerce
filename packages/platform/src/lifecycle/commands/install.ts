import { z } from 'zod';
import { LifecycleError } from '../services/orchestrator.js';
import { buildStaticRegistry } from '../services/static-registry.js';
import { orchestratorFor, type OperatorRuntime } from './operator-runtime.js';

/**
 * `module:install <module-id> | --all [--dry-run] [--json]` — the body
 * (`specs/115-lifecycle-container-move/`, D115-1).
 *
 * ## `--all`, and why it is a command rather than a boot (T141)
 *
 * In this repository every module is compiled in, so the boot reconciler
 * converges the registry — which is not the same as nobody needing this command,
 * and that sentence used to say it was. Convergence runs no `installHook`: it
 * stamps `bootConvergedAt` and warns, and `install` completes a row carrying that
 * marker instead of answering `already-installed`. So `--all` is **also the
 * repair for a boot-first database**, which is what `pnpm run setup` runs after
 * `db:fresh` and what this repository's dev flow lacked until 2026-09-19.
 * In an **instance** every
 * module is an installed package, and `firstBootInsertPopulation` deliberately
 * excludes those (D-157.6(b)) — a package is converged by `install`, which is
 * also what applies its migrations, reconciles its settings and runs its install
 * hook. So an instance's first boot refuses with `RequiredModuleAbsentError` over
 * every locked module it ships, and the only remedy the platform offered was this
 * command, one module at a time, **in dependency order**, which it refuses to
 * compute for you (`missing-deps`, exit 66) and which nothing tells a client.
 * Measured on the first end-to-end run of `endora new instance` (T140): 23
 * required modules absent, and a next-steps block that does not mention this
 * command at all.
 *
 * `--all` is that remedy made performable: every registered module that is not
 * already installed, in `ModuleDepGraph.topologicalOrder()` — the order the
 * orchestrator's own `missing-deps` refusal implies. It changes nothing about
 * what installing *one* module does, and it is deliberately **not** a boot
 * convergence: D-157.6(b)'s reasoning is untouched, because this is an operator
 * asking, once, for the set they declared in their own manifest.
 *
 * Exit codes (per `specs/018-module-lifecycle/contracts/cli-commands.md` §C-1),
 * preserved byte-for-byte by the move (R2.3):
 *   - 0   success (or already installed — no-op)
 *   - 64  misuse: unknown id, bad argv, target module is `disabled` not absent
 *   - 65  manifest invalid (Zod fail), duplicate-id, cycle
 *   - 66  conflict: missing dependencies
 *   - 70  internal error during install (migration / settings / hook failure)
 *   - 75  lock unavailable, or stale `installing` row
 */

const InstallArgsSchema = z.object({
  /** The one module to install, or `null` when `--all` names the whole set. */
  id: z.string().regex(/^_?[a-z][a-z0-9_]*$/).nullable(),
  all: z.boolean().default(false),
  dryRun: z.boolean().default(false),
  json: z.boolean().default(false),
});

type InstallArgs = z.infer<typeof InstallArgsSchema>;

function parseArgv(argv: readonly string[]): InstallArgs | { error: string } {
  const positional: string[] = [];
  let all = false;
  let dryRun = false;
  let json = false;
  for (const arg of argv) {
    if (arg === '--all') all = true;
    else if (arg === '--dry-run') dryRun = true;
    else if (arg === '--json') json = true;
    else if (arg.startsWith('--')) return { error: `unknown flag: ${arg}` };
    else positional.push(arg);
  }
  // A module id beside `--all` is refused rather than one of them silently
  // winning: the two say different things about what this invocation is for,
  // and guessing which the operator meant is how a bulk install gets run by
  // somebody who asked for one module.
  if (all && positional.length > 0) {
    return { error: `--all takes no module id, and this run names ${positional.join(' ')}` };
  }
  if (!all && positional.length === 0) {
    return { error: 'missing module id' };
  }
  if (positional.length > 1) {
    return { error: `extra positional args: ${positional.slice(1).join(' ')}` };
  }
  const result = InstallArgsSchema.safeParse({
    id: all ? null : positional[0],
    all,
    dryRun,
    json,
  });
  if (!result.success) {
    return {
      error: `invalid argument: ${result.error.issues.map((i) => i.message).join('; ')}`,
    };
  }
  return result.data;
}

export async function runInstallCommand(
  argv: readonly string[],
  rt: OperatorRuntime,
): Promise<number> {
  const parsed = parseArgv(argv);
  if ('error' in parsed) {
    rt.err(
      `usage: module:install <module-id> | --all [--dry-run] [--json]\n` +
        `error: ${parsed.error}\n`,
    );
    return 64;
  }
  const args = parsed;

  let registry;
  try {
    // The entries are the **instance-resolved** set (D-157.6a) — core, this
    // deployment's overlay modules and every installed Endora module package —
    // resolved by the entry point, which is where the collision refusal reaches
    // an operator (R2.2). The runtime carries no container, so a command cannot
    // compose the platform it operates on (D-157.2): composition's own
    // reconciler would mark the module installed first and turn this command
    // into a no-op.
    registry = buildStaticRegistry(rt.entries);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    rt.err(`[manifest] ${msg}\n`);
    return 65;
  }

  if (args.all) return runInstallAll(args, rt, registry);

  if (!registry.modules.has(args.id!)) {
    rt.err(
      `unknown module "${args.id!}". known modules: ${[...registry.modules.keys()].sort().join(', ')}\n`,
    );
    return 64;
  }

  if (args.dryRun) {
    if (args.json) {
      rt.out(
        JSON.stringify({
          id: args.id!,
          dryRun: true,
          dependencies: registry.modules.get(args.id!)!.manifest.dependencies,
        }) + '\n',
      );
    } else {
      const m = registry.modules.get(args.id!)!.manifest;
      rt.out(
        `[install] ${args.id!} ${m.version} (DRY RUN — no changes applied)\n` +
          `  dependencies: ${m.dependencies.join(', ') || '(none)'}\n`,
      );
    }
    return 0;
  }

  const orchestrator = await orchestratorFor(rt, registry);

  try {
    const result = await orchestrator.install(args.id!);
    if (args.json) {
      rt.out(JSON.stringify(result) + '\n');
    } else if (result.state === 'already-installed') {
      rt.out(`[install] ${args.id!} ${result.version} — already installed (no-op)\n`);
    } else {
      rt.out(
        `[install] ${args.id!} ${result.version}\n` +
          `  ✓ dependencies satisfied\n` +
          `  ✓ migrations applied: ${result.appliedMigrations.length === 0 ? '(none)' : result.appliedMigrations.join(', ')}\n` +
          `  ✓ settings reconciled: +${result.settings.addedGroups} groups, +${result.settings.addedSettings} settings (~${result.settings.updatedGroups + result.settings.updatedSettings} updated)\n` +
          `  ✓ install hook completed (${result.hookDurationMs} ms)\n` +
          `  ✓ registry updated: state=installed\n` +
          `done in ${result.totalDurationMs} ms\n`,
      );
    }
    return 0;
  } catch (err) {
    return mapError(err, args.json, rt);
  }
}

/**
 * `module:install --all` — every registered module that is not already
 * installed, in dependency order (T141).
 *
 * The order is `ModuleDepGraph.topologicalOrder()`, which is the same graph the
 * single-module path's `missing-deps` refusal is computed from, so this cannot
 * disagree with it. A cycle throws there and is mapped to exit 65 like every
 * other manifest cycle.
 *
 * It stops at the first failure and returns that module's exit code, rather than
 * carrying on: every module after it in this order either depends on the one
 * that failed or is behind it in a chain that does, so continuing would replace
 * one actionable failure with a page of `missing-deps`.
 */
async function runInstallAll(
  args: InstallArgs,
  rt: OperatorRuntime,
  registry: Awaited<ReturnType<typeof buildStaticRegistry>>,
): Promise<number> {
  let order: string[];
  try {
    order = registry.graph.topologicalOrder();
  } catch (err) {
    return mapError(new LifecycleError('manifest-cycle', String(err)), args.json, rt);
  }
  // The graph is built from the manifests the registry loaded, so every id it
  // yields is one of them; the filter is a statement of that rather than a
  // defence, and it keeps the printed plan and the loop reading one list.
  const plan = order.filter((id) => registry.modules.has(id));

  if (args.dryRun) {
    if (args.json) rt.out(JSON.stringify({ all: true, dryRun: true, order: plan }) + '\n');
    else
      rt.out(
        `[install] --all (DRY RUN — no changes applied)\n` +
          `  ${String(plan.length)} modules, in dependency order:\n` +
          `  ${plan.join(', ')}\n`,
      );
    return 0;
  }

  const orchestrator = await orchestratorFor(rt, registry);
  const results: Array<{ id: string; version: string; state: string }> = [];
  for (const id of plan) {
    try {
      const result = await orchestrator.install(id);
      results.push({ id, version: result.version, state: result.state });
      if (!args.json) {
        rt.out(
          result.state === 'already-installed'
            ? `[install] ${id} ${result.version} — already installed (no-op)\n`
            : `[install] ${id} ${result.version} — installed in ${result.totalDurationMs} ms\n`,
        );
      }
    } catch (err) {
      if (!args.json) rt.err(`[install] --all stopped at ${id}\n`);
      return mapError(err, args.json, rt);
    }
  }
  if (args.json) rt.out(JSON.stringify({ all: true, results }) + '\n');
  else {
    const installed = results.filter((r) => r.state !== 'already-installed').length;
    rt.out(
      `[install] --all done: ${String(installed)} installed, ` +
        `${String(results.length - installed)} already installed\n`,
    );
  }
  return 0;
}

function mapError(err: unknown, asJson: boolean, rt: OperatorRuntime): number {
  if (err instanceof LifecycleError) {
    const payload = {
      error: err.kind,
      message: err.message,
      ...err.details,
    };
    if (asJson) {
      rt.err(JSON.stringify(payload) + '\n');
    } else {
      rt.err(`[install] ${err.message}\n`);
      if (err.kind === 'missing-deps' && Array.isArray(err.details['missing'])) {
        rt.err(
          `hint: run \`module:install\` for ${(err.details['missing'] as string[]).join(', ')} first\n`,
        );
      }
    }
    switch (err.kind) {
      case 'unknown-module':
      case 'wrong-state':
        return 64;
      case 'manifest-cycle':
        return 65;
      case 'missing-deps':
      case 'dependents-block':
        return 66;
      case 'install-failed':
      case 'uninstall-failed':
        return 70;
      case 'lock-busy':
        return 75;
    }
  }
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  rt.err(`[internal] ${msg}\n`);
  return 70;
}
