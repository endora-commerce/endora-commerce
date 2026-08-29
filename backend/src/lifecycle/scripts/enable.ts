import { z } from 'zod';
import { Redis } from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import { initOrm, closeOrm } from '../../db/index.js';
import { AuditLogService } from '../../kernel/audit/audit-log-service.js';
import { ModuleLifecycleOrchestrator, LifecycleError } from '../services/orchestrator.js';
import { buildStaticRegistry } from '../services/static-registry.js';
import { resolvedManifestEntries } from '../registered-manifests.js';
import { enterSystemScope } from '../../kernel/scope.js';

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

async function main(): Promise<number> {
  const parsed = parseArgv(process.argv.slice(2));
  if ('error' in parsed) {
    process.stderr.write(
      `usage: module:enable <module-id> [--json]\nerror: ${parsed.error}\n`,
    );
    return 64;
  }
  const args = parsed;

  let registry;
  try {
    // D-157.6(a) — the **instance-resolved** set: core, this deployment's
    // overlay modules and every installed Endora module package. This read
    // bare-core `REGISTERED_MANIFESTS`, so `module:install <package id>`
    // answered `unknown module` while `/platform/modules`, fed the resolved
    // set, installed the same module. Resolved directly rather than through a
    // composition: a platform command must not compose (D-157.2), because
    // composition's own reconciler would mark the module installed first and
    // turn this command into a no-op.
    registry = buildStaticRegistry(await resolvedManifestEntries());
  } catch (err) {
    process.stderr.write(`[manifest] ${err instanceof Error ? err.message : String(err)}\n`);
    return 65;
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
    const result = await orchestrator.enable(args.id);
    if (args.json) {
      process.stdout.write(JSON.stringify(result) + '\n');
    } else if (result.state === 'already-enabled') {
      process.stdout.write(`[enable] ${args.id} — already enabled (no-op)\n`);
    } else {
      process.stdout.write(
        `[enable] ${args.id}\n` +
          `  ✓ dependencies satisfied\n` +
          `  ✓ registry updated: state=installed (active)\n`,
      );
    }
    return 0;
  } catch (err) {
    return mapError(err, args.json);
  } finally {
    redis.disconnect();
    await closeOrm();
  }
}

function mapError(err: unknown, asJson: boolean): number {
  if (err instanceof LifecycleError) {
    if (asJson) {
      process.stderr.write(JSON.stringify({ error: err.kind, message: err.message, ...err.details }) + '\n');
    } else {
      process.stderr.write(`[enable] ${err.message}\n`);
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
  process.stderr.write(`[internal] ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}\n`);
  return 70;
}

void enterSystemScope('cli: enable a module', main, { entryPoint: 'cli' }).then((code) => process.exit(code));
