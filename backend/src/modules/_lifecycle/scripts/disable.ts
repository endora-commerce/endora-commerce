import { z } from 'zod';
import Redis from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import { initOrm, closeOrm } from '../../../db/index.js';
import { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import { ModuleLifecycleOrchestrator, LifecycleError } from '../services/orchestrator.js';
import { buildStaticRegistry } from '../services/static-registry.js';
import { resolvedManifestEntries } from '../registered-manifests.js';
import { enterSystemScope } from '../../../kernel/scope.js';

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

async function main(): Promise<number> {
  const parsed = parseArgv(process.argv.slice(2));
  if ('error' in parsed) {
    process.stderr.write(
      `usage: module:disable <module-id> [--cascade] [--json]\nerror: ${parsed.error}\n`,
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
    const result = await orchestrator.disable(args.id, { cascade: args.cascade });
    if (args.json) {
      process.stdout.write(JSON.stringify(result) + '\n');
    } else if (result.state === 'already-disabled') {
      process.stdout.write(`[disable] ${args.id} — already disabled (no-op)\n`);
    } else {
      const cascadeNote = result.cascaded.length > 0
        ? `  ✓ cascaded disable: ${result.cascaded.join(', ')}\n`
        : '';
      process.stdout.write(
        `[disable] ${args.id}${args.cascade ? ' --cascade' : ''}\n` +
          cascadeNote +
          `  ✓ registry updated: state=disabled (inactive)\n`,
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
      process.stderr.write(`[disable] ${err.message}\n`);
      if (err.kind === 'dependents-block' && Array.isArray(err.details['dependents'])) {
        process.stderr.write(
          `hint: pass --cascade to disable dependents in dependency order, or disable each manually first.\n`,
        );
      }
      if (err.kind === 'non-deactivatable') {
        // No `--force` to suggest, deliberately: the consequence of removing
        // one of these is a deployment that cannot authenticate the operator
        // who would put it back.
        process.stderr.write(
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
  process.stderr.write(`[internal] ${err instanceof Error ? `${err.name}: ${err.message}` : String(err)}\n`);
  return 70;
}

void enterSystemScope('cli: disable a module', main, { entryPoint: 'cli' }).then((code) => process.exit(code));
