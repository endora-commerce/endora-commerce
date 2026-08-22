/**
 * `audit_logs read` — the audit trail, read from the host (D-102).
 *
 * ## Why this exists at all
 *
 * `GET /api/v1/admin/audit-log` is guarded by `requireAdmin`, whose permission
 * check reads `adminUserReadPort` since feature 075 Phase C. So on a deployment
 * that does not ship `admin_users` — or during an incident that *is* the admin
 * identity subsystem — the one surface for reading the trail is authorised by
 * the thing under investigation. That is not a degraded surface, it is a
 * circular one. A shell on the box is a different authority, and that is the
 * property an investigation needs.
 *
 * ## What it costs, stated rather than discovered
 *
 * Host access is the credential. Anyone with a shell on this machine and the
 * database credentials already reads these rows through `psql`; this tool adds
 * legibility and filtering, not authority. The consequence is that **a read
 * performed here leaves no record in the trail it reads** — nobody should meet
 * that for the first time while asking "who looked at this?". The same sentence
 * is in the first paragraph of `--help` and in the ruling
 * (`specs/079-stale-claims-and-overlay-path/rulings.md`, D-102).
 *
 * ## What this must not grow into
 *
 * The owner's approval is **conditional**: it holds only while this tool's reach
 * is exactly `psql`'s. Each of the following makes host access stop being a
 * sufficient credential, so any one of them **re-opens the decision** rather
 * than being a follow-up ticket:
 *
 *   - **No writes.** Not a correction, not a retention sweep, not a backfill.
 *     The trail is append-only and the Command Bus is its one writer; a CLI that
 *     writes is a second writer with no actor.
 *   - **No redaction, and no filtering-for-others.** The moment output is shaped
 *     for a recipient who is not at the shell, the shell has stopped being the
 *     credential.
 *   - **No export that leaves the host.** No upload, no e-mail, no object-store
 *     target. `>` to a local file is the boundary.
 *   - **No network surface.** No `--listen`, no daemon mode, no socket. A
 *     network surface has callers, and callers need authorisation.
 *
 * Usage: `pnpm --filter backend run audit:read -- [filters]`. Exit 0 on a read,
 * 1 on argv this tool does not understand — a read that did not happen must not
 * look like an empty one.
 *
 * ## What the host running it changed (feature 080, T042b)
 *
 * Only the plumbing: the `EntityManager` comes off the composition's `emFactory`
 * instead of an `initOrm()` this file owned and closed. The reach is unchanged —
 * one `em.find` over `AuditLogEntry`, which is a **kernel** entity, so it
 * crosses no module boundary and never appeared in a ledger.
 */
import type { EntityManager } from '@mikro-orm/postgresql';
import { z } from 'zod';
import type { ModuleCliCommandContext } from '@b2b/contracts';
import { AuditLogEntry } from '../../../kernel/audit/audit-log-entry.entity.js';
import type { ModuleContext } from '../../../kernel/index.js';

/**
 * The full `--help` text is the command's `help` declaration in `manifest.ts`,
 * printed by the host before it composes (D-102 — the credential is host
 * access, not a working connection string). This is the one line the error path
 * needs, so a refused argument still says where to look.
 */
const USAGE_LINE =
  'usage: audit_logs read [--actor] [--action] [--object-type] [--object-id] ' +
  '[--limit] [--json] — run with --help for the filters';

const ArgsSchema = z.object({
  actor: z.string().uuid().optional(),
  action: z.string().min(1).optional(),
  objectType: z.string().min(1).optional(),
  objectId: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(500).default(100),
  json: z.boolean().default(false),
});

type Args = z.infer<typeof ArgsSchema>;

const FLAGS: Readonly<Record<string, keyof Args>> = {
  '--actor': 'actor',
  '--action': 'action',
  '--object-type': 'objectType',
  '--object-id': 'objectId',
};

export function parseArgv(argv: readonly string[]): Args | { error: string } {
  const candidate: Record<string, unknown> = {};
  for (const arg of argv) {
    if (arg === '--json') {
      candidate['json'] = true;
      continue;
    }
    const eq = arg.indexOf('=');
    const [flag, value] = eq === -1 ? [arg, undefined] : [arg.slice(0, eq), arg.slice(eq + 1)];
    const key = FLAGS[flag];
    if (key !== undefined) {
      if (value === undefined) return { error: `${flag} needs a value` };
      candidate[key] = value;
      continue;
    }
    if (flag === '--limit') {
      if (value === undefined) return { error: '--limit needs a value' };
      candidate['limit'] = Number.parseInt(value, 10);
      continue;
    }
    return { error: `unknown argument: ${arg}` };
  }
  const parsed = ArgsSchema.safeParse(candidate);
  if (!parsed.success) {
    return { error: parsed.error.issues.map((issue) => issue.message).join('; ') };
  }
  return parsed.data;
}

export function formatTable(rows: readonly AuditLogEntry[]): string {
  if (rows.length === 0) return '(no entries match)';
  const width = (pick: (row: AuditLogEntry) => string, header: string): number =>
    Math.max(header.length, ...rows.map((row) => pick(row).length));
  const actor = (row: AuditLogEntry): string => row.actorAdminUserId ?? '—';
  const object = (row: AuditLogEntry): string => `${row.objectType}/${row.objectId}`;
  const widths = {
    at: 24,
    actor: width(actor, 'ACTOR'),
    action: width((row) => row.action, 'ACTION'),
    object: width(object, 'OBJECT'),
  };
  const pad = (value: string, to: number): string => value.padEnd(to);
  const lines = [
    `${pad('ACTED AT', widths.at)}  ${pad('ACTOR', widths.actor)}  ` +
      `${pad('ACTION', widths.action)}  ${pad('OBJECT', widths.object)}`,
    ...rows.map(
      (row) =>
        `${pad(row.actedAt.toISOString(), widths.at)}  ${pad(actor(row), widths.actor)}  ` +
        `${pad(row.action, widths.action)}  ${pad(object(row), widths.object)}`,
    ),
  ];
  return lines.join('\n');
}

/** The EntityManager factory every composition supplies. */
interface AuditReadCradle {
  readonly emFactory: () => EntityManager;
}

export async function read({
  ctx,
  argv,
  out,
  err,
}: ModuleCliCommandContext<ModuleContext>): Promise<number> {
  const parsed = parseArgv(argv);
  if ('error' in parsed) {
    err(`${USAGE_LINE}\n\nerror: ${parsed.error}`);
    return 1;
  }

  const em = ctx.cradle<AuditReadCradle>().emFactory();
  // A read, and only a read: no `em.create`, no `persist`, no `flush`. The
  // trail is append-only and the Command Bus is its one writer.
  const rows = await em.find(
    AuditLogEntry,
    {
      ...(parsed.actor ? { actorAdminUserId: parsed.actor } : {}),
      ...(parsed.action ? { action: parsed.action } : {}),
      ...(parsed.objectType ? { objectType: parsed.objectType } : {}),
      ...(parsed.objectId ? { objectId: parsed.objectId } : {}),
    },
    { orderBy: { actedAt: 'desc' }, limit: parsed.limit },
  );
  out(parsed.json ? JSON.stringify(rows, null, 2) : formatTable(rows));
  return 0;
}
