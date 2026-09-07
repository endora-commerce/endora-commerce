import { z } from 'zod';
import { LifecycleError } from '../services/orchestrator.js';
import { buildStaticRegistry } from '../services/static-registry.js';
import { orchestratorFor, type OperatorRuntime } from './operator-runtime.js';

/**
 * `module:enable <module-id> [--json]` — the body
 * (`specs/115-lifecycle-container-move/`, D115-1).
 *
 * Exit codes are `specs/018-module-lifecycle/contracts/cli-commands.md` §C-1's
 * and are preserved byte-for-byte by the move (R2.3).
 */

const EnableArgsSchema = z.object({
  id: z.string().regex(/^_?[a-z][a-z0-9_]*$/),
  json: z.boolean().default(false),
});

function parseArgv(
  argv: readonly string[],
): z.infer<typeof EnableArgsSchema> | { error: string } {
  const positional: string[] = [];
  let json = false;
  for (const arg of argv) {
    if (arg === '--json') json = true;
    else if (arg.startsWith('--')) return { error: `unknown flag: ${arg}` };
    else positional.push(arg);
  }
  if (positional.length === 0) return { error: 'missing module id' };
  if (positional.length > 1) {
    return { error: `extra positional args: ${positional.slice(1).join(' ')}` };
  }
  const result = EnableArgsSchema.safeParse({ id: positional[0], json });
  if (!result.success) {
    return { error: result.error.issues.map((i) => i.message).join('; ') };
  }
  return result.data;
}

export async function runEnableCommand(
  argv: readonly string[],
  rt: OperatorRuntime,
): Promise<number> {
  const parsed = parseArgv(argv);
  if ('error' in parsed) {
    rt.err(`usage: module:enable <module-id> [--json]\nerror: ${parsed.error}\n`);
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
    const result = await orchestrator.enable(args.id);
    if (args.json) {
      rt.out(JSON.stringify(result) + '\n');
    } else if (result.state === 'already-enabled') {
      rt.out(`[enable] ${args.id} — already enabled (no-op)\n`);
    } else {
      rt.out(
        `[enable] ${args.id}\n` +
          `  ✓ dependencies satisfied\n` +
          `  ✓ registry updated: state=installed (active)\n`,
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
      rt.err(`[enable] ${err.message}\n`);
    }
    switch (err.kind) {
      case 'unknown-module':
      case 'wrong-state':
        return 64;
      case 'missing-deps':
      case 'dependents-block':
        return 66;
      case 'lock-busy':
        return 75;
      default:
        return 70;
    }
  }
  rt.err(`[internal] ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}\n`);
  return 70;
}
