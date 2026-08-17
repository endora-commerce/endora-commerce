import { z } from 'zod';
import Redis from 'ioredis';
import type { EntityManager } from '@mikro-orm/postgresql';
import { initOrm, closeOrm } from '../../../db/index.js';
import { AuditLogService } from '../../../kernel/audit/audit-log-service.js';
import { ModuleLifecycleOrchestrator, LifecycleError } from '../services/orchestrator.js';
import { buildStaticRegistry } from '../services/static-registry.js';
import { REGISTERED_MANIFESTS } from '../registered-manifests.js';
import { enterSystemScope } from '../../../kernel/scope.js';

/**
 * `pnpm --filter backend run module:uninstall <module-id> [--hard] [--force] [--json]`
 *
 * Soft uninstall (default): unregisters the module's settings, marks the
 * registry row as `uninstalled`, leaves DB tables / data intact.
 * Hard uninstall (`--hard`): also reverts the module's migrations and
 * deletes the registry row. `--hard` in a non-tty shell additionally
 * requires `--force` to prevent accidental data loss in CI / cron.
 *
 * Exit codes (per `contracts/cli-commands.md` §C-2):
 *   - 0   success (or already uninstalled — no-op)
 *   - 64  misuse: bad argv, --hard without --force in non-tty
 *   - 66  conflict: dependents still installed
 *   - 70  internal error during uninstall
 *   - 75  lock unavailable
 *   - 77  refused: the module declares itself non-deactivatable (D-69)
 */

const UninstallArgsSchema = z.object({
  id: z.string().regex(/^_?[a-z][a-z0-9_]*$/),
  hard: z.boolean().default(false),
  force: z.boolean().default(false),
  json: z.boolean().default(false),
});

type UninstallArgs = z.infer<typeof UninstallArgsSchema>;

function parseArgv(argv: readonly string[]): UninstallArgs | { error: string } {
  const positional: string[] = [];
  let hard = false;
  let force = false;
  let json = false;
  // Backward-compat aliases for the legacy modules:uninstall flags.
  for (const arg of argv) {
    if (arg === '--hard') hard = true;
    else if (arg === '--force') force = true;
    else if (arg === '--json') json = true;
    else if (arg === '--remove-settings') {
      hard = true;
      force = true;
    } else if (arg === '--preserve-settings') {
      // soft default — no-op flag, kept for back-compat
    } else if (arg.startsWith('--')) return { error: `unknown flag: ${arg}` };
    else positional.push(arg);
  }
  if (positional.length === 0) return { error: 'missing module id' };
  if (positional.length > 1) {
    return { error: `extra positional args: ${positional.slice(1).join(' ')}` };
  }
  const result = UninstallArgsSchema.safeParse({
    id: positional[0],
    hard,
    force,
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
      `usage: module:uninstall <module-id> [--hard] [--force] [--json]\n` +
        `error: ${parsed.error}\n`,
    );
    return 64;
  }
  const args = parsed;

  // Hard uninstall in a non-tty shell requires --force as a safety net.
  if (args.hard && !args.force && !process.stdout.isTTY) {
    process.stderr.write(
      `[uninstall] --hard in a non-interactive shell requires --force ` +
        `(refusing to delete data without explicit confirmation).\n`,
    );
    return 64;
  }

  let registry;
  try {
    registry = buildStaticRegistry(
      REGISTERED_MANIFESTS.map((e) => ({
        manifest: e.manifest,
        filePath: e.filePath,
        ...(e.installHook ? { installHook: e.installHook } : {}),
        ...(e.uninstallHook ? { uninstallHook: e.uninstallHook } : {}),
      })),
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[manifest] ${msg}\n`);
    return 65;
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
    const result = await orchestrator.uninstall(args.id, { hard: args.hard });
    if (args.json) {
      process.stdout.write(JSON.stringify(result) + '\n');
    } else if (result.state === 'already-uninstalled') {
      process.stdout.write(`[uninstall] ${args.id} — already uninstalled (no-op)\n`);
    } else if (args.hard) {
      process.stdout.write(
        `[uninstall] ${args.id} --hard (DATA DELETED)\n` +
          `  ✓ uninstall hook completed\n` +
          `  ✓ settings removed: ${result.removedGroups} groups, ${result.removedSettings} settings\n` +
          `  ✓ migrations reverted: ${result.revertedMigrations.length === 0 ? '(none matched filename pattern)' : result.revertedMigrations.join(', ')}\n` +
          `  ✓ registry row deleted\n`,
      );
    } else {
      process.stdout.write(
        `[uninstall] ${args.id} (soft, data preserved)\n` +
          `  ✓ uninstall hook completed\n` +
          `  ✓ settings unregistered: ${result.removedGroups} groups, ${result.removedSettings} settings (rows removed; tables intact)\n` +
          `  ✓ registry updated: state=uninstalled\n` +
          `re-installing re-uses the applied migrations, but not the configuration:\n` +
          `the settings above are gone; a re-install recreates them from the manifest defaults.\n` +
          `Use module:disable to pause a module without losing its configuration.\n`,
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
      process.stderr.write(
        JSON.stringify({
          error: err.kind,
          message: err.message,
          ...err.details,
        }) + '\n',
      );
    } else {
      process.stderr.write(`[uninstall] ${err.message}\n`);
      if (err.kind === 'non-deactivatable') {
        // Same hint the disable path prints, for the same reason: there is no
        // `--force` to suggest. The consequence of removing one of these is a
        // deployment that cannot authenticate the operator who would put it
        // back — and after `--hard` the tables that recovery needs are gone.
        process.stderr.write(
          `hint: this module declares itself non-deactivatable in its manifest, which refuses ` +
            `uninstall as well as disable. If that declaration is wrong, change the manifest — ` +
            `there is no override flag.\n`,
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
      case 'non-deactivatable':
        // EX_NOPERM — the request was well-formed and is not permitted.
        return 77;
    }
  }
  const msg = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  process.stderr.write(`[internal] ${msg}\n`);
  return 70;
}

void enterSystemScope('cli: uninstall a module', main, { entryPoint: 'cli' }).then((code) => {
  process.exit(code);
});
