import { z } from 'zod';
import Redis from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import type { ModuleListItem } from '@b2b/contracts';
import { initOrm, closeOrm } from '../../../db/index.js';
import { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import { ModuleLifecycleOrchestrator } from '../services/orchestrator.js';
import { buildStaticRegistry } from '../services/static-registry.js';
import { REGISTERED_MANIFESTS } from '../registered-manifests.js';

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

async function main(): Promise<number> {
  const parsed = parseArgv(process.argv.slice(2));
  if ('error' in parsed) {
    process.stderr.write(
      `usage: module:status [<module-id>] [--filter=<state>] [--json]\nerror: ${parsed.error}\n`,
    );
    return 0; // status is read-only; argv errors still print but exit 0 per spec FR-020
  }
  const args = parsed;

  let registry;
  try {
    registry = buildStaticRegistry(
      REGISTERED_MANIFESTS.map((e) => ({
        manifest: e.manifest,
        ...(e.installHook ? { installHook: e.installHook } : {}),
        ...(e.uninstallHook ? { uninstallHook: e.uninstallHook } : {}),
      })),
    );
  } catch (err) {
    process.stderr.write(`[manifest] ${err instanceof Error ? err.message : String(err)}\n`);
    return 0;
  }

  const orm = await initOrm();
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null, lazyConnect: false });
  const em = (): EntityManager => orm.em.fork() as EntityManager;
  const auditLog = new AuditLogService(em);

  const orchestrator = new ModuleLifecycleOrchestrator({
    orm, redis, em, auditLog, registry,
  });

  try {
    let rows = await orchestrator.status();
    if (args.id) rows = rows.filter((r) => r.id === args.id);
    rows = applyFilter(rows, args.filter);

    if (args.json) {
      process.stdout.write(JSON.stringify({ modules: rows }, null, 2) + '\n');
    } else if (rows.length === 0) {
      process.stdout.write(`(no modules match)\n`);
    } else {
      process.stdout.write(formatTable(rows));
    }
    return 0;
  } catch (err) {
    process.stderr.write(`[status] ${err instanceof Error ? err.message : String(err)}\n`);
    return 0;
  } finally {
    redis.disconnect();
    await closeOrm();
  }
}

void main().then((code) => process.exit(code));
