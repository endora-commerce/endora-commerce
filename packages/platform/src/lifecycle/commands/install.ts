import { z } from 'zod';
import { LifecycleError } from '../services/orchestrator.js';
import { buildStaticRegistry } from '../services/static-registry.js';
import { orchestratorFor, type OperatorRuntime } from './operator-runtime.js';

/**
 * `module:install <module-id> [--dry-run] [--json]` — the body
 * (`specs/115-lifecycle-container-move/`, D115-1).
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
  id: z.string().regex(/^_?[a-z][a-z0-9_]*$/),
  dryRun: z.boolean().default(false),
  json: z.boolean().default(false),
});

type InstallArgs = z.infer<typeof InstallArgsSchema>;

function parseArgv(argv: readonly string[]): InstallArgs | { error: string } {
  const positional: string[] = [];
  let dryRun = false;
  let json = false;
  for (const arg of argv) {
    if (arg === '--dry-run') dryRun = true;
    else if (arg === '--json') json = true;
    else if (arg.startsWith('--')) return { error: `unknown flag: ${arg}` };
    else positional.push(arg);
  }
  if (positional.length === 0) {
    return { error: 'missing module id' };
  }
  if (positional.length > 1) {
    return { error: `extra positional args: ${positional.slice(1).join(' ')}` };
  }
  const result = InstallArgsSchema.safeParse({
    id: positional[0],
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
      `usage: module:install <module-id> [--dry-run] [--json]\n` +
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

  if (!registry.modules.has(args.id)) {
    rt.err(
      `unknown module "${args.id}". known modules: ${[...registry.modules.keys()].sort().join(', ')}\n`,
    );
    return 64;
  }

  if (args.dryRun) {
    if (args.json) {
      rt.out(
        JSON.stringify({
          id: args.id,
          dryRun: true,
          dependencies: registry.modules.get(args.id)!.manifest.dependencies,
        }) + '\n',
      );
    } else {
      const m = registry.modules.get(args.id)!.manifest;
      rt.out(
        `[install] ${args.id} ${m.version} (DRY RUN — no changes applied)\n` +
          `  dependencies: ${m.dependencies.join(', ') || '(none)'}\n`,
      );
    }
    return 0;
  }

  const orchestrator = await orchestratorFor(rt, registry);

  try {
    const result = await orchestrator.install(args.id);
    if (args.json) {
      rt.out(JSON.stringify(result) + '\n');
    } else if (result.state === 'already-installed') {
      rt.out(`[install] ${args.id} ${result.version} — already installed (no-op)\n`);
    } else {
      rt.out(
        `[install] ${args.id} ${result.version}\n` +
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
