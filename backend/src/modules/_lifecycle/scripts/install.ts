import { z } from 'zod';
import Redis from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import { initOrm, closeOrm } from '../../../db/index.js';
import { AuditLogService } from '../../audit_logs/services/audit-log-service.js';
import { ModuleLifecycleOrchestrator, LifecycleError } from '../services/orchestrator.js';
import { buildStaticRegistry } from '../services/static-registry.js';
import { REGISTERED_MANIFESTS } from '../registered-manifests.js';

/**
 * `pnpm --filter backend run module:install <module-id> [--dry-run] [--json]`
 *
 * Exit codes (per `contracts/cli-commands.md` §C-1):
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

async function main(): Promise<number> {
  const parsed = parseArgv(process.argv.slice(2));
  if ('error' in parsed) {
    process.stderr.write(
      `usage: module:install <module-id> [--dry-run] [--json]\n` +
        `error: ${parsed.error}\n`,
    );
    return 64;
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
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[manifest] ${msg}\n`);
    return 65;
  }

  if (!registry.modules.has(args.id)) {
    process.stderr.write(
      `unknown module "${args.id}". known modules: ${[...registry.modules.keys()].sort().join(', ')}\n`,
    );
    return 64;
  }

  if (args.dryRun) {
    if (args.json) {
      process.stdout.write(
        JSON.stringify({
          id: args.id,
          dryRun: true,
          dependencies: registry.modules.get(args.id)!.manifest.dependencies,
        }) + '\n',
      );
    } else {
      const m = registry.modules.get(args.id)!.manifest;
      process.stdout.write(
        `[install] ${args.id} ${m.version} (DRY RUN — no changes applied)\n` +
          `  dependencies: ${m.dependencies.join(', ') || '(none)'}\n`,
      );
    }
    return 0;
  }

  const orm = await initOrm();
  const redisUrl = process.env['REDIS_URL'] ?? 'redis://localhost:6379';
  const redis = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    lazyConnect: false,
  });
  const em = (): EntityManager => orm.em.fork() as EntityManager;
  const auditLog = new AuditLogService(em);

  const orchestrator = new ModuleLifecycleOrchestrator({
    orm,
    redis,
    em,
    auditLog,
    registry,
  });

  try {
    const result = await orchestrator.install(args.id);
    if (args.json) {
      process.stdout.write(JSON.stringify(result) + '\n');
    } else if (result.state === 'already-installed') {
      process.stdout.write(
        `[install] ${args.id} ${result.version} — already installed (no-op)\n`,
      );
    } else {
      process.stdout.write(
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
    return mapError(err, args.json);
  } finally {
    redis.disconnect();
    await closeOrm();
  }
}

function mapError(err: unknown, asJson: boolean): number {
  if (err instanceof LifecycleError) {
    const payload = {
      error: err.kind,
      message: err.message,
      ...err.details,
    };
    if (asJson) {
      process.stderr.write(JSON.stringify(payload) + '\n');
    } else {
      process.stderr.write(`[install] ${err.message}\n`);
      if (err.kind === 'missing-deps' && Array.isArray(err.details['missing'])) {
        process.stderr.write(
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
  process.stderr.write(`[internal] ${msg}\n`);
  return 70;
}

void main().then((code) => {
  process.exit(code);
});
