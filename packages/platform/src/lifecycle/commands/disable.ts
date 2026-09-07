import { z } from 'zod';
import { LifecycleError } from '../services/orchestrator.js';
import { buildStaticRegistry } from '../services/static-registry.js';
import { orchestratorFor, type OperatorRuntime } from './operator-runtime.js';

/**
 * `module:disable <module-id> [--cascade] [--json]` — the body
 * (`specs/115-lifecycle-container-move/`, D115-1).
 *
 * Exit codes are `specs/018-module-lifecycle/contracts/cli-commands.md` §C-1's
 * and are preserved byte-for-byte by the move (R2.3), the `non-deactivatable`
 * refusal at 77 included (D-69).
 */

const DisableArgsSchema = z.object({
  id: z.string().regex(/^_?[a-z][a-z0-9_]*$/),
  cascade: z.boolean().default(false),
  json: z.boolean().default(false),
});

function parseArgv(
  argv: readonly string[],
): z.infer<typeof DisableArgsSchema> | { error: string } {
  const positional: string[] = [];
  let cascade = false;
  let json = false;
  for (const arg of argv) {
    if (arg === '--cascade') cascade = true;
    else if (arg === '--json') json = true;
    else if (arg.startsWith('--')) return { error: `unknown flag: ${arg}` };
    else positional.push(arg);
  }
  if (positional.length === 0) return { error: 'missing module id' };
  if (positional.length > 1) {
    return { error: `extra positional args: ${positional.slice(1).join(' ')}` };
  }
  const result = DisableArgsSchema.safeParse({
    id: positional[0],
    cascade,
    json,
  });
  if (!result.success) {
    return { error: result.error.issues.map((i) => i.message).join('; ') };
  }
  return result.data;
}

export async function runDisableCommand(
  argv: readonly string[],
  rt: OperatorRuntime,
): Promise<number> {
  const parsed = parseArgv(argv);
  if ('error' in parsed) {
    rt.err(`usage: module:disable <module-id> [--cascade] [--json]\nerror: ${parsed.error}\n`);
    return 64;
  }
  const args = parsed;

  let registry;
  try {
    // The entries are the **instance-resolved** set (D-157.6a) — core, this
    // deployment's overlay modules and every installed Endora module package —
    // resolved by the entry point, which is where the collision refusal reaches
    // an operator (R2.2). The runtime carries no container, so a command cannot
    // compose the platform it operates on (D-157.2).
    registry = buildStaticRegistry(rt.entries);
  } catch (err) {
    rt.err(`[manifest] ${err instanceof Error ? err.message : String(err)}\n`);
    return 65;
  }

  const orchestrator = await orchestratorFor(rt, registry);

  try {
    const result = await orchestrator.disable(args.id, { cascade: args.cascade });
    if (args.json) {
      rt.out(JSON.stringify(result) + '\n');
    } else if (result.state === 'already-disabled') {
      rt.out(`[disable] ${args.id} — already disabled (no-op)\n`);
    } else {
      const cascadeNote = result.cascaded.length > 0
        ? `  ✓ cascaded disable: ${result.cascaded.join(', ')}\n`
        : '';
      rt.out(
        `[disable] ${args.id}${args.cascade ? ' --cascade' : ''}\n` +
          cascadeNote +
          `  ✓ registry updated: state=disabled (inactive)\n`,
      );
    }
    return 0;
  } catch (err) {
    return mapError(err, args.json, rt);
  }
}

function mapError(err: unknown, asJson: boolean, rt: OperatorRuntime): number {
  if (err instanceof LifecycleError) {
    if (asJson) {
      rt.err(JSON.stringify({ error: err.kind, message: err.message, ...err.details }) + '\n');
    } else {
      rt.err(`[disable] ${err.message}\n`);
      if (err.kind === 'dependents-block' && Array.isArray(err.details['dependents'])) {
        rt.err(
          `hint: pass --cascade to disable dependents in dependency order, or disable each manually first.\n`,
        );
      }
      if (err.kind === 'non-deactivatable') {
        // No `--force` to suggest, deliberately: the consequence of removing
        // one of these is a deployment that cannot authenticate the operator
        // who would put it back.
        rt.err(
          `hint: this module declares itself non-deactivatable in its manifest. ` +
            `If that declaration is wrong, change the manifest — there is no override flag.\n`,
        );
      }
    }
    switch (err.kind) {
      case 'unknown-module':
      case 'wrong-state':
        return 64;
      case 'dependents-block':
        return 66;
      case 'non-deactivatable':
        // EX_NOPERM — the request was well-formed and is not permitted.
        return 77;
      case 'lock-busy':
        return 75;
      default:
        return 70;
    }
  }
  rt.err(`[internal] ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}\n`);
  return 70;
}
