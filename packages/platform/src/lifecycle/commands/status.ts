import { z } from 'zod';
import type { ModuleListItem } from '@endora-commerce/contracts';
import { buildStaticRegistry } from '../services/static-registry.js';
import { orchestratorFor, type OperatorRuntime } from './operator-runtime.js';

/**
 * `module:status [<module-id>] [--filter=<state>] [--json]` — the body
 * (`specs/115-lifecycle-container-move/`, D115-1).
 *
 * `status` is read-only, so every path exits 0 (feature 018, FR-020): an argv
 * error and an unreadable manifest set both print and return 0. That is the one
 * place the five commands' exit tables differ from each other, and it is
 * preserved by the move (R2.3).
 */

const StatusArgsSchema = z.object({
  id: z.string().regex(/^_?[a-z][a-z0-9_]*$/).optional(),
  filter: z
    .enum(['installing', 'installed', 'disabled', 'uninstalled', 'orphan', 'pending-upgrade'])
    .optional(),
  json: z.boolean().default(false),
});

function parseArgv(
  argv: readonly string[],
): z.infer<typeof StatusArgsSchema> | { error: string } {
  const positional: string[] = [];
  let json = false;
  let filter: string | undefined;
  for (const arg of argv) {
    if (arg === '--json') json = true;
    else if (arg.startsWith('--filter=')) filter = arg.slice('--filter='.length);
    else if (arg.startsWith('--')) return { error: `unknown flag: ${arg}` };
    else positional.push(arg);
  }
  const candidate: Record<string, unknown> = { json };
  if (positional.length > 0) candidate['id'] = positional[0];
  if (filter !== undefined) candidate['filter'] = filter;
  const result = StatusArgsSchema.safeParse(candidate);
  if (!result.success) {
    return { error: result.error.issues.map((i) => i.message).join('; ') };
  }
  return result.data;
}

function applyFilter(
  rows: ModuleListItem[],
  filter: string | undefined,
): ModuleListItem[] {
  if (!filter) return rows;
  if (filter === 'orphan' || filter === 'pending-upgrade') {
    return rows.filter((r) => r.flags.includes(filter));
  }
  return rows.filter((r) => r.state === filter);
}

function formatTable(rows: ModuleListItem[]): string {
  const widths = {
    id: Math.max('ID'.length, ...rows.map((r) => r.id.length)),
    state: 'STATE'.length,
    regVer: Math.max('REG.VER'.length, ...rows.map((r) => (r.version.registered ?? '—').length)),
    dskVer: Math.max('DSK.VER'.length, ...rows.map((r) => (r.version.onDisk ?? '—').length)),
    deps: Math.max('DEPS'.length, ...rows.map((r) => r.dependencies.join(',').length || 1)),
  };
  const pad = (s: string, w: number) => s.padEnd(w);
  const header =
    `${pad('ID', widths.id)}  ${pad('STATE', 11)}  ${pad('REG.VER', widths.regVer)}  ${pad('DSK.VER', widths.dskVer)}  ${pad('DEPS', widths.deps)}  FLAGS`;
  const lines = rows.map(
    (r) =>
      `${pad(r.id, widths.id)}  ${pad(r.state, 11)}  ${pad(r.version.registered ?? '—', widths.regVer)}  ${pad(r.version.onDisk ?? '—', widths.dskVer)}  ${pad(r.dependencies.join(',') || '—', widths.deps)}  ${r.flags.join(',') || ''}`,
  );
  return [header, ...lines].join('\n') + '\n';
}

export async function runStatusCommand(
  argv: readonly string[],
  rt: OperatorRuntime,
): Promise<number> {
  const parsed = parseArgv(argv);
  if ('error' in parsed) {
    rt.err(
      `usage: module:status [<module-id>] [--filter=<state>] [--json]\nerror: ${parsed.error}\n`,
    );
    return 0; // status is read-only; argv errors still print but exit 0 per spec FR-020
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
    return 0;
  }

  const orchestrator = await orchestratorFor(rt, registry);

  try {
    let rows = await orchestrator.status();
    if (args.id) rows = rows.filter((r) => r.id === args.id);
    rows = applyFilter(rows, args.filter);

    if (args.json) {
      rt.out(JSON.stringify({ modules: rows }, null, 2) + '\n');
    } else if (rows.length === 0) {
      rt.out(`(no modules match)\n`);
    } else {
      rt.out(formatTable(rows));
    }
    return 0;
  } catch (err) {
    rt.err(`[status] ${err instanceof Error ? err.message : String(err)}\n`);
    return 0;
  }
}
