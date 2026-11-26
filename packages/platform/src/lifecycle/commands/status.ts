import { z } from 'zod';
import type { ModuleListItem } from '@endora-commerce/contracts';
import type { MigrationOrigin } from '../../db/migration-order.js';
import { buildStaticRegistry } from '../services/static-registry.js';
import { orchestratorFor, type MigrationCatalogue, type OperatorRuntime } from './operator-runtime.js';

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

/** One migration a module owns, as `module:status` lists it (190, FR-045). */
export interface ModuleMigrationStatus {
  /** The class name — what `mikro_orm_migrations` records. */
  readonly name: string;
  /** Which producer contributed it: `core`, `external` (a package), `overlay`, `generated`. */
  readonly origin: MigrationOrigin;
  readonly state: 'applied' | 'pending';
}

/** A status row, with its migrations when the host supplied a catalogue. */
export type ModuleStatusRow = ModuleListItem & {
  readonly migrations?: readonly ModuleMigrationStatus[] | null;
};

/**
 * The migrations `moduleId` owns, in execution order, each with its origin and
 * whether `executed` holds it.
 *
 * `null` when the catalogue's ownership does not cover the module — *"cannot
 * answer"*, which the listing must not render as *"owns none"* (`[]`), for the
 * reason {@link MigrationCatalogue.ownership}'s own type keeps the two apart.
 * Order is the merged order's, not the ownership answer's (which is by class
 * name), so the list reads as `migrate` applies it.
 */
export function moduleMigrationsOf(
  catalogue: MigrationCatalogue,
  moduleId: string,
  executed: ReadonlySet<string>,
): ModuleMigrationStatus[] | null {
  const owned = catalogue.ownership.migrationNamesFor(moduleId);
  if (owned === null) return null;
  const mine = new Set(owned);
  return catalogue.registered
    .filter((entry) => mine.has(entry.name))
    .map((entry) => ({
      name: entry.name,
      origin: entry.origin,
      state: executed.has(entry.name) ? ('applied' as const) : ('pending' as const),
    }));
}

function formatMigrations(row: ModuleStatusRow): string {
  if (row.migrations === undefined) return '';
  if (row.migrations === null) return `\nMIGRATIONS  (not known to this platform's migration order)\n`;
  if (row.migrations.length === 0) return `\nMIGRATIONS  (no migrations)\n`;
  const width = Math.max('MIGRATION'.length, ...row.migrations.map((m) => m.name.length));
  const originWidth = Math.max('ORIGIN'.length, ...row.migrations.map((m) => m.origin.length));
  const lines = row.migrations.map(
    (m) => `${m.name.padEnd(width)}  ${m.origin.padEnd(originWidth)}  ${m.state}`,
  );
  return `\n${'MIGRATION'.padEnd(width)}  ${'ORIGIN'.padEnd(originWidth)}  STATE\n${lines.join('\n')}\n`;
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

/**
 * Each row with its migrations (190, FR-045), when the host supplied a
 * catalogue; the rows unchanged otherwise. The applied set is the migrator's
 * own executed list — read once, through the resources `orchestratorFor`
 * already opened.
 */
async function withMigrations(
  rt: OperatorRuntime,
  rows: readonly ModuleListItem[],
): Promise<ModuleStatusRow[]> {
  if (rt.migrations === undefined || rows.length === 0) return [...rows];
  const [catalogue, resources] = await Promise.all([rt.migrations(), rt.resources()]);
  const executed = new Set((await resources.orm.migrator.getExecuted()).map((row) => row.name));
  return rows.map((row) => ({ ...row, migrations: moduleMigrationsOf(catalogue, row.id, executed) }));
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
    let listed = await orchestrator.status();
    if (args.id) listed = listed.filter((r) => r.id === args.id);
    listed = applyFilter(listed, args.filter);
    const rows = await withMigrations(rt, listed);

    if (args.json) {
      rt.out(JSON.stringify({ modules: rows }, null, 2) + '\n');
    } else if (rows.length === 0) {
      rt.out(`(no modules match)\n`);
    } else {
      // One module asked for by id gets its migrations listed under the row;
      // the whole table does not, because core alone owns hundreds of them.
      rt.out(formatTable(rows) + (args.id && rows.length === 1 ? formatMigrations(rows[0]!) : ''));
    }
    return 0;
  } catch (err) {
    rt.err(`[status] ${err instanceof Error ? err.message : String(err)}\n`);
    return 0;
  }
}
